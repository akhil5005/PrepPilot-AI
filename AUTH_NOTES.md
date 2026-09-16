# Authentication Overhaul — Working Notes

Notes on everything changed in the authentication system, why each change was
made, and how it was verified. Plain JavaScript throughout; **no new npm
packages were added** — `zod` was already a dependency and the rate limiter is
hand written.

---

## 1. What the system looked like before

A single JWT in one cookie:

- `POST /register` / `POST /login` signed a 1-day JWT and set it as `token`.
- `authUser` middleware verified it and set `req.user = decoded`.
- `GET /logout` inserted the whole token string into a `blacklistTokens`
  collection.

It worked, but it had the following concrete problems.

### Security

| # | Problem | Consequence |
|---|---------|-------------|
| 1 | No input validation anywhere | Any string was accepted as an email; a 1-character password was fine |
| 2 | No rate limiting on `/login` | Unlimited online password guessing. bcrypt is deliberately slow, so this was also a cheap way to pin the CPU |
| 3 | 1-day access token, never rotated | A stolen token was valid for a full day with no way to cut it short |
| 4 | `password` field returned by every query | One `res.json(user)` anywhere would have leaked the hashes |
| 5 | Login distinguished "no such user" from "wrong password" by timing | An attacker could enumerate which email addresses have accounts |
| 6 | Blacklist stored the full token, with no TTL | A database leak handed over usable credentials, and the collection grew forever — every authenticated request scanned a table that only ever got bigger |
| 7 | Email stored verbatim | `Bob@x.com` and `bob@x.com` were two different accounts; login was case sensitive |
| 8 | `JWT_SECRET` never checked at boot | If unset, every login failed at runtime with `secretOrPrivateKey must have a value` |
| 9 | No `maxAge` on the cookie | It was a session cookie that vanished on browser close, contradicting the 1-day token |
| 10 | No way to revoke sessions | No "log out everywhere"; a password change left old sessions alive |
| 11 | Request body passed straight to `userModel.create` | Extra fields in the JSON body were written to the document (mass assignment) |

### Correctness

| # | Problem | Consequence |
|---|---------|-------------|
| 12 | No `try/catch` and no error middleware | A database hiccup became an unhandled rejection and a request that just hung |
| 13 | `getMeController` didn't null-check | A deleted account whose cookie was still valid crashed the handler |
| 14 | `registerUserController` checked `findOne` then `create` | Two simultaneous signups could both pass the check; nothing enforced uniqueness (the `unique: [true, "msg"]` syntax was not valid Mongoose) |
| 15 | Typo `mesaage` in a login response | The client saw `undefined` for that error |
| 16 | **Frontend swallowed every error** | `catch (err) { console.log(err) }` returned `undefined`, so `data.user` threw a `TypeError` — and `navigate('/')` ran regardless, so a *failed* login navigated to the home page, which bounced back to `/login` with no explanation |
| 17 | `getMe` ran inside the `useAuth` hook | Every component calling the hook fired its own request. `Protected`, `Login` and `Register` each did one, and each flipped the same shared `loading` flag |
| 18 | `loading` was a boolean | "Not loading and no user" was indistinguishable from "haven't checked yet", so a refresh could bounce a signed in user to `/login` |
| 19 | `GET /logout` | A state-changing GET can be triggered by any page that embeds it as an image |

---

## 2. The new design

### Two tokens instead of one

| | Access token | Refresh token |
|---|---|---|
| Cookie | `accessToken` | `refreshToken` |
| Lifetime | 15 min (`JWT_ACCESS_TTL`) | 7 days (`JWT_REFRESH_TTL`) |
| Cookie path | `/` | `/api/auth` |
| Secret | `JWT_SECRET` | `JWT_REFRESH_SECRET` |
| Stored server side? | No (only its `jti`, and only when revoked) | Yes — one row per session |

The access token is short lived, so a stolen one is useful for minutes rather
than a day. The refresh token keeps the user signed in without that long lived
credential being attached to every ordinary API request — its cookie `path` is
`/api/auth`, so the browser only ever sends it to the endpoints that need it.

Two **different** secrets means a leaked access-token secret still cannot mint
refresh tokens. `JWT_REFRESH_SECRET` is optional; if unset, a distinct secret is
derived from `JWT_SECRET`, so existing `.env` files keep working.

### Refresh token rotation with reuse detection

Every call to `POST /api/auth/refresh` issues a brand new refresh token and
revokes the old one. All tokens descended from a single login share a **family**
id.

If an **already-rotated** token is presented, that means two parties hold the
same token — the normal signal that one was stolen. The response is to revoke
the **entire family**, logging out both the attacker and the legitimate user.
That is the intended behaviour: an unexpected re-login is a far better outcome
than an attacker silently riding along.

Refresh tokens are stored as a **SHA-256 hash**, never in plaintext. (SHA-256
rather than bcrypt is correct here: the input is already 200+ bits of
unguessable randomness, so there is nothing to brute force, and lookups need to
be fast. Passwords are the opposite case and still use bcrypt.)

### Three independent revocation mechanisms

1. **Access-token denylist by `jti`** — kills a specific access token for its
   remaining ≤15 minutes. TTL index removes the row automatically.
2. **Session revocation** — marks one refresh-token row revoked (logout).
3. **`user.tokenVersion`** — an integer on the user. Access tokens carry the
   version they were minted with; bumping it invalidates *every* token already
   in the wild with no denylist lookup at all. Used by "log out everywhere",
   by password changes, and by reuse detection.

---

## 3. Files

### Backend — new

| File | Purpose |
|------|---------|
| `src/config/env.js` | Validates every required env var **at boot** and throws with a clear list of what's missing. Enforces a 32-char minimum secret in production. |
| `src/utils/apiError.js` | `ApiError` with a status code + helper constructors. Anything *not* an `ApiError` is treated as unexpected and reported as a generic 500. |
| `src/utils/asyncHandler.js` | Wraps async handlers so rejections reach the error middleware. |
| `src/middlewares/error.middleware.js` | Central error handler + JSON 404. Translates duplicate-key (`11000`), Mongoose `ValidationError`, `CastError` and malformed-JSON into proper status codes. Logs real errors server side, returns a generic message to the client. |
| `src/middlewares/rateLimit.middleware.js` | Dependency-free fixed-window limiter. |
| `src/middlewares/validate.middleware.js` | `validateBody(schema)` — validates and **replaces** `req.body` with the parsed result. |
| `src/validators/auth.validator.js` | zod schemas for register / login / change-password. |
| `src/models/refreshToken.model.js` | One row per session: `jti`, `tokenHash`, `family`, `revokedAt`, `replacedBy`, `userAgent`, `ip`, TTL on `expiresAt`. |
| `src/services/token.service.js` | All token logic in one place: signing, verification, rotation, revocation, cookie handling. |
| `.env.example` | Documents every variable. |
| `tests/auth.e2e.test.js` | 52 end-to-end assertions (`npm run test:auth`). |

### Backend — rewritten

**`src/models/user.model.js`**
- `password` is `select: false` — must be asked for explicitly with
  `.select("+password")`. *(fixes #4)*
- `email` is `lowercase: true` + `trim` *(fixes #7)*
- A `pre("save")` hook hashes the password, so **no call site can ever store a
  plaintext password by forgetting to hash it**.
- `comparePassword()` and `toPublicJSON()` methods.
- `toJSON` transform strips `password`, `tokenVersion`, `__v` as defence in depth.
- Added `tokenVersion`, `lastLoginAt`, `timestamps`.
- Real unique indexes *(fixes #14)*.

**`src/middlewares/auth.middleware.js`** — now performs four checks, each
covering something the old version missed:
1. signature + expiry
2. `jti` not on the denylist
3. **user still exists** *(fixes #13)*
4. **`tokenVersion` matches** *(enables #10)*

It also loads the full user document into `req.user`, so controllers no longer
refetch. `req.user.id` still works (Mongoose's virtual), so
`interview.controller.js` needed **no changes**.

**`src/controllers/auth.controller.js`** — all handlers wrapped in
`asyncHandler`. Login runs a bcrypt comparison against a dummy hash when the
email is unknown, so both failure paths take the same time and return the same
message *(fixes #5)*.

**`src/app.js`**
- `trust proxy = 1` — required on Render for correct `req.ip` (otherwise every
  visitor shares one rate-limit bucket) and for `secure` cookies. `1` rather
  than `true`, because trusting every hop lets a client spoof its own IP.
- CORS origin **allowlist** (comma-separated `FRONTEND_URL`), rejected origins
  get 403 not 500.
- Security headers: `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, HSTS in production, and `Cache-Control: no-store` on all
  `/api/auth` responses.
- `express.json({ limit: "100kb" })`, `x-powered-by` disabled, `/health` endpoint.

**`server.js`** — connects to the database **before** listening, plus graceful
shutdown on SIGTERM/SIGINT and handlers for `unhandledRejection` /
`uncaughtException`.

**`src/config/database.js`** — no longer swallows connection errors *(the old
version would happily start with no database behind it)*. Calls `syncIndexes()`
so the unique and TTL indexes exist even where `autoIndex` is off in production.

### Frontend — new

| File | Purpose |
|------|---------|
| `src/lib/api.js` | The **single** axios instance, with the silent-refresh interceptor and a normalised `ApiError` (`.message`, `.status`, `.fields`, `.code`). |
| `src/features/auth/authContext.js` | The context object, in its own module so Fast Refresh works. |
| `src/features/auth/components/publicOnly.jsx` | Keeps a signed in user off `/login` and `/register`. |

### Frontend — rewritten

- **`auth.context.jsx`** — the bootstrap `getMe` now lives here and runs
  **exactly once** *(fixes #17)*. Status is a three-state
  `loading | authenticated | anonymous` *(fixes #18)*.
- **`useAuth.js`** — a plain consumer with no side effects. Throws a clear error
  if used outside the provider.
- **`auth.api.js`** — errors **propagate** instead of being swallowed *(fixes #16)*.
- **`Login.jsx` / `Register.jsx`** — show server error messages and per-field
  errors, disable the button while submitting, and **navigate only on success**.
  Register shows a live password-rule checklist. Correct `autoComplete`
  attributes (`current-password` vs `new-password`) so password managers behave.
- **`protected.jsx`** — waits for `loading` to resolve, and remembers the
  intended destination so login returns you there.
- **`interview.api.js`** — switched to the shared client, so interview calls get
  the same silent refresh. Without this, a page open longer than 15 minutes
  would start failing with 401s.

---

## 4. API surface

| Method | Route | Access | Notes |
|--------|-------|--------|-------|
| POST | `/api/auth/register` | Public | 5/hour per IP |
| POST | `/api/auth/login` | Public | 10 **failed**/15min per IP+email |
| POST | `/api/auth/refresh` | Cookie | Rotates; 60/15min per IP |
| POST | `/api/auth/logout` | Public | `GET` still accepted for compatibility |
| POST | `/api/auth/logout-all` | Private | **new** |
| POST | `/api/auth/change-password` | Private | **new** — signs out other devices |
| GET | `/api/auth/get-me` | Private | |

Route order is deliberate: **throttle → validate → authenticate → handle**.
Throttling first means junk never reaches the bcrypt-expensive handler.

The login limiter is keyed on **IP + email**, so a shared office IP cannot lock
out an unrelated colleague, and it counts **only failed attempts**, so a busy
legitimate user never locks themselves out.

All errors share one shape:

```json
{ "success": false, "message": "...", "details": { "fields": {...}, "code": "..." } }
```

---

## 5. Verification

### Backend — `npm run test:auth` → **52 passed, 0 failed**

Covers: validation, registration, duplicate/409, mass assignment, login
(including identical responses for unknown-email vs wrong-password), refresh
rotation, **reuse detection**, logout (token denylisted *and* session revoked),
change-password (other devices signed out, old password rejected), logout-all,
the auth guard (no token / garbage / foreign secret / expired), deleted
accounts, rate limiting, malformed JSON, and storage invariants (bcrypt hash
format, `password` not selected by default, refresh tokens hashed, TTL indexes
present).

### Frontend — verified live in Chrome against the running stack

- Registration with a bad email + weak password → blocked with clear messages
- Live password-rule checklist updates as you type
- Registered with `Akhil@Example.COM`, later signed in as `akhil@example.com` → **case-insensitive login confirmed**
- `document.cookie` is **empty**, `localStorage` and `sessionStorage` empty → **tokens are unreachable from JavaScript, so an XSS bug cannot steal them**
- Session survives a page reload; `/login` redirects to `/` when already signed in; `/` redirects to `/login` after logout
- **Silent refresh proven** with a 1-minute access TTL. Network log after expiry:
  ```
  GET  /api/auth/get-me   401   <- access token expired
  POST /api/auth/refresh  200   <- rotated automatically
  GET  /api/auth/get-me   200   <- original request replayed
  ```
  The user was never shown a login screen.
- **Wrong password → "Invalid email or password" displayed, stays on `/login`.**
  This is the old crash (#16): previously it threw a `TypeError` and navigated
  to `/` anyway.

`npm run build` passes. `npm run lint` reports **no issues in any auth file**
(the 7 remaining are pre-existing, in `features/interview/*` and `Home.jsx`).

### One bug found and fixed *because* of the browser test

The first version of `AuthProvider` combined a once-only `useRef` guard with a
`cancelled` flag in the effect cleanup. Under React StrictMode, which mounts
every effect twice in development, these deadlock: the first mount's cleanup
sets `cancelled = true` and suppresses its own state update, while the ref guard
makes the second mount return early without re-fetching. Nothing ever set the
status and **the app froze on "Loading....." forever**.

The fix was to drop the `cancelled` flag — the ref guard alone already
guarantees exactly one request, and setting state after unmount is a harmless
no-op in React 18+. No backend test could have caught this; it only appears in a
real browser.

---

## 6. Deploying this

### Backward compatibility

- **`.env` needs no changes to work.** Every new variable has a default, and
  `JWT_REFRESH_SECRET` is derived from `JWT_SECRET` if absent.
- The old `token` cookie is still read and is explicitly cleared on logout, so
  nobody is left holding a stale cookie. Old tokens themselves will **not**
  validate (they lack the new issuer/audience claims), so **everyone currently
  signed in will be signed out once and must log in again.** This is a one-time
  event.
- `interview.controller.js` was **not modified** — `req.user.id` still resolves.

### Recommended before/at deploy

1. **Set `JWT_REFRESH_SECRET`** to its own random value:
   ```
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
2. Confirm `JWT_SECRET` is at least 32 characters — **the server now refuses to
   start in production if it isn't.**
3. Existing `blacklistTokens` documents use the old `{ token }` shape and are
   now inert; the collection can be dropped.
4. **Check for existing duplicate emails that differ only by case** before
   deploying. The new unique index cannot be built if any exist — `syncIndexes()`
   logs `[db] index sync failed` rather than crashing, so watch the boot logs:
   ```js
   db.users.aggregate([
     { $group: { _id: { $toLower: "$email" }, n: { $sum: 1 } } },
     { $match: { n: { $gt: 1 } } }
   ])
   ```

### Known limitations

- **The rate limiter keeps its counters in process memory.** That is correct for
  a single instance, but if the backend is ever scaled to multiple instances the
  effective limit multiplies by the instance count. The fix is to swap the `Map`
  for Redis; the middleware interface is designed to stay the same.
- **No CSRF token.** In production `sameSite: "none"` is required (the SPA is on
  a different origin), which means `SameSite` alone is not providing CSRF
  protection. The CORS allowlist blocks cross-origin *reads*, but a
  state-changing POST from a malicious page is not fully covered. Adding a
  double-submit CSRF token would be the natural next step.
- Not implemented, and worth considering later: email verification, password
  reset, and a UI for `logout-all` / `change-password` (the endpoints and the
  `useAuth` methods exist, but no page calls them yet).

---

## 7. Running locally

**Start the backend first** — the frontend calls `/api/auth/get-me` as soon as
it loads, and if the backend isn't listening yet the app drops to the signed out
state, which looks like a broken login.

```bash
cd Backend  && npm run dev     # wait for "Server is running on port ..."
cd Frontend && npm run dev
```

Run the auth test suite (needs a reachable MongoDB; it uses its own
`genaiapp_authtest` database and drops it at both ends):

```bash
cd Backend && npm run test:auth
```
