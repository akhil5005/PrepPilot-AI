/* End-to-end exercise of the new auth flow against a scratch database. */
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/genaiapp_authtest";
process.env.JWT_SECRET = "t".repeat(48);
process.env.JWT_REFRESH_SECRET = "r".repeat(48);
process.env.NODE_ENV = "development";
process.env.FRONTEND_URL = "http://localhost:5173";
process.env.JWT_ACCESS_TTL = "15m";
process.env.BCRYPT_ROUNDS = "10";

const mongoose = require("mongoose");
const app = require("../src/app");
const connectToDB = require("../src/config/database");

let pass = 0,
  fail = 0;
function check(label, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}`, extra === undefined ? "" : extra);
  }
}

function makeClient(base) {
  const jar = new Map();
  return {
    jar,
    cookieHeader(path) {
      const out = [];
      for (const [name, c] of jar) {
        if (path.startsWith(c.path)) out.push(`${name}=${c.value}`);
      }
      return out.join("; ");
    },
    async req(method, path, body) {
      const headers = { "Content-Type": "application/json" };
      const cookie = this.cookieHeader(path);
      if (cookie) headers.Cookie = cookie;
      const res = await fetch(base + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      for (const sc of res.headers.getSetCookie?.() || []) {
        const [pair, ...attrs] = sc.split(";").map((s) => s.trim());
        const eq = pair.indexOf("=");
        const name = pair.slice(0, eq);
        const value = pair.slice(eq + 1);
        const pathAttr =
          attrs.find((a) => a.toLowerCase().startsWith("path="))?.slice(5) ||
          "/";
        if (!value || attrs.some((a) => /expires=thu, 01 jan 1970/i.test(a))) {
          jar.delete(name);
        } else {
          jar.set(name, { value, path: pathAttr });
        }
      }
      let json = null;
      try {
        json = await res.json();
      } catch {}
      return { status: res.status, body: json };
    },
  };
}

(async () => {
  await connectToDB();
  await mongoose.connection.dropDatabase();
  await Promise.all([
    require("../src/models/user.model").syncIndexes(),
    require("../src/models/refreshToken.model").syncIndexes(),
    require("../src/models/blacklist.model").syncIndexes(),
  ]);

  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const c = makeClient(base);

  console.log("\n-- validation --");
  let r = await c.req("POST", "/api/auth/register", {
    username: "a",
    email: "bad",
    password: "weak",
  });
  check("weak input rejected with 400", r.status === 400, r.body);
  check(
    "field errors returned",
    r.body?.details?.fields?.password && r.body?.details?.fields?.email,
    r.body?.details,
  );

  console.log("\n-- register --");
  r = await c.req("POST", "/api/auth/register", {
    username: "alice",
    email: "  ALICE@Example.COM ",
    password: "Str0ngPass1",
  });
  check("register 201", r.status === 201, r.body);
  check("email normalised to lowercase", r.body?.user?.email === "alice@example.com", r.body?.user);
  check("password not in response", !JSON.stringify(r.body).includes("Str0ngPass1"));
  check("access cookie set", c.jar.has("accessToken"));
  check("refresh cookie set", c.jar.has("refreshToken"));
  check("refresh cookie scoped to /api/auth", c.jar.get("refreshToken")?.path === "/api/auth");

  console.log("\n-- duplicate registration --");
  const c2 = makeClient(base);
  r = await c2.req("POST", "/api/auth/register", {
    username: "alice2",
    email: "alice@example.com",
    password: "Str0ngPass1",
  });
  check("duplicate email -> 409", r.status === 409, r.body);

  console.log("\n-- get-me --");
  r = await c.req("GET", "/api/auth/get-me");
  check("get-me 200", r.status === 200, r.body);
  check("returns the user", r.body?.user?.username === "alice");
  check("no tokenVersion leaked", !("tokenVersion" in (r.body?.user || {})));

  console.log("\n-- mass assignment --");
  const c3 = makeClient(base);
  r = await c3.req("POST", "/api/auth/register", {
    username: "mallory",
    email: "m@example.com",
    password: "Str0ngPass1",
    tokenVersion: 999,
    isAdmin: true,
  });
  const mallory = await require("../src/models/user.model").findOne({ email: "m@example.com" });
  check("extra body fields stripped", mallory.tokenVersion === 0 && mallory.isAdmin === undefined, {
    tv: mallory.tokenVersion,
  });

  console.log("\n-- login --");
  const c4 = makeClient(base);
  r = await c4.req("POST", "/api/auth/login", {
    email: "alice@example.com",
    password: "wrongpass",
  });
  check("bad password -> 401", r.status === 401, r.body);
  const badPassMsg = r.body?.message;
  r = await c4.req("POST", "/api/auth/login", {
    email: "nobody@example.com",
    password: "wrongpass",
  });
  check("unknown email -> 401 with identical message", r.status === 401 && r.body?.message === badPassMsg, r.body);

  r = await c4.req("POST", "/api/auth/login", {
    email: "AlIcE@example.com",
    password: "Str0ngPass1",
  });
  check("login succeeds (case-insensitive email)", r.status === 200, r.body);
  check("login sets cookies", c4.jar.has("accessToken") && c4.jar.has("refreshToken"));

  console.log("\n-- refresh rotation --");
  const oldRefresh = c4.jar.get("refreshToken").value;
  const oldAccess = c4.jar.get("accessToken").value;
  r = await c4.req("POST", "/api/auth/refresh");
  check("refresh 200", r.status === 200, r.body);
  const newRefresh = c4.jar.get("refreshToken").value;
  check("refresh token rotated", newRefresh !== oldRefresh);
  check("access token rotated", c4.jar.get("accessToken").value !== oldAccess);
  r = await c4.req("GET", "/api/auth/get-me");
  check("new access token works", r.status === 200, r.body);

  console.log("\n-- refresh reuse detection --");
  const stolen = makeClient(base);
  stolen.jar.set("refreshToken", { value: oldRefresh, path: "/api/auth" });
  r = await stolen.req("POST", "/api/auth/refresh");
  check("replayed old refresh token -> 401", r.status === 401, r.body);
  check("reported as reuse", r.body?.details?.code === "REFRESH_REUSED", r.body?.details);
  r = await c4.req("POST", "/api/auth/refresh");
  check("victim's session family also revoked", r.status === 401, r.body);

  console.log("\n-- logout --");
  const c5 = makeClient(base);
  await c5.req("POST", "/api/auth/login", {
    email: "alice@example.com",
    password: "Str0ngPass1",
  });
  const accessBeforeLogout = c5.jar.get("accessToken").value;
  const refreshBeforeLogout = c5.jar.get("refreshToken").value;
  r = await c5.req("POST", "/api/auth/logout");
  check("logout 200", r.status === 200, r.body);
  check("cookies cleared", !c5.jar.has("accessToken") && !c5.jar.has("refreshToken"));

  const replay = makeClient(base);
  replay.jar.set("accessToken", { value: accessBeforeLogout, path: "/" });
  r = await replay.req("GET", "/api/auth/get-me");
  check("access token denylisted after logout", r.status === 401, r.body);
  replay.jar.set("refreshToken", { value: refreshBeforeLogout, path: "/api/auth" });
  r = await replay.req("POST", "/api/auth/refresh");
  check("refresh token revoked after logout", r.status === 401, r.body);
  r = await c5.req("POST", "/api/auth/logout");
  check("logout with no session still 200", r.status === 200, r.body);

  console.log("\n-- change password --");
  const c6 = makeClient(base);
  await c6.req("POST", "/api/auth/login", {
    email: "alice@example.com",
    password: "Str0ngPass1",
  });
  const otherDevice = makeClient(base);
  await otherDevice.req("POST", "/api/auth/login", {
    email: "alice@example.com",
    password: "Str0ngPass1",
  });
  r = await c6.req("POST", "/api/auth/change-password", {
    currentPassword: "nope",
    newPassword: "An0therPass",
  });
  check("wrong current password -> 401", r.status === 401, r.body);
  r = await c6.req("POST", "/api/auth/change-password", {
    currentPassword: "Str0ngPass1",
    newPassword: "An0therPass",
  });
  check("change password 200", r.status === 200, r.body);
  r = await c6.req("GET", "/api/auth/get-me");
  check("this device stays signed in", r.status === 200, r.body);
  r = await otherDevice.req("GET", "/api/auth/get-me");
  check("other device signed out (tokenVersion bump)", r.status === 401, r.body);
  const c7 = makeClient(base);
  r = await c7.req("POST", "/api/auth/login", {
    email: "alice@example.com",
    password: "An0therPass",
  });
  check("login with new password works", r.status === 200, r.body);
  r = await c7.req("POST", "/api/auth/login", {
    email: "alice@example.com",
    password: "Str0ngPass1",
  });
  check("old password rejected", r.status === 401, r.body);

  console.log("\n-- logout-all --");
  const d1 = makeClient(base);
  const d2 = makeClient(base);
  await d1.req("POST", "/api/auth/login", { email: "alice@example.com", password: "An0therPass" });
  await d2.req("POST", "/api/auth/login", { email: "alice@example.com", password: "An0therPass" });
  r = await d1.req("POST", "/api/auth/logout-all");
  check("logout-all 200", r.status === 200, r.body);
  r = await d2.req("GET", "/api/auth/get-me");
  check("second device invalidated", r.status === 401, r.body);

  console.log("\n-- auth guard --");
  const anon = makeClient(base);
  r = await anon.req("GET", "/api/auth/get-me");
  check("no token -> 401", r.status === 401, r.body);
  anon.jar.set("accessToken", { value: "not.a.jwt", path: "/" });
  r = await anon.req("GET", "/api/auth/get-me");
  check("garbage token -> 401", r.status === 401, r.body);
  const jwt = require("jsonwebtoken");
  const foreign = jwt.sign({ id: "507f1f77bcf86cd799439011" }, "some-other-secret", {
    expiresIn: "1h",
    issuer: "genaiapp",
    audience: "genaiapp-client",
    jwtid: "x",
  });
  anon.jar.set("accessToken", { value: foreign, path: "/" });
  r = await anon.req("GET", "/api/auth/get-me");
  check("token signed with a different secret -> 401", r.status === 401, r.body);

  const expired = jwt.sign({ id: "507f1f77bcf86cd799439011", tokenVersion: 0 }, process.env.JWT_SECRET, {
    expiresIn: "-10s",
    issuer: "genaiapp",
    audience: "genaiapp-client",
    jwtid: "y",
  });
  anon.jar.set("accessToken", { value: expired, path: "/" });
  r = await anon.req("GET", "/api/auth/get-me");
  check("expired token -> 401 TOKEN_EXPIRED", r.status === 401 && r.body?.details?.code === "TOKEN_EXPIRED", r.body);

  console.log("\n-- deleted account --");
  const ghost = makeClient(base);
  await ghost.req("POST", "/api/auth/register", { username: "ghost", email: "g@example.com", password: "Str0ngPass1" });
  await require("../src/models/user.model").deleteOne({ email: "g@example.com" });
  r = await ghost.req("GET", "/api/auth/get-me");
  check("deleted user -> 401 not a crash", r.status === 401, r.body);

  console.log("\n-- rate limiting --");
  const rl = makeClient(base);
  let limited = null;
  for (let i = 0; i < 14; i++) {
    const res = await rl.req("POST", "/api/auth/login", { email: "rl@example.com", password: "Wrong1Pass" });
    if (res.status === 429) {
      limited = i;
      break;
    }
  }
  check("login throttled after repeated failures", limited !== null && limited <= 11, `at attempt ${limited}`);
  const other = makeClient(base);
  r = await other.req("POST", "/api/auth/login", { email: "alice@example.com", password: "An0therPass" });
  check("different account on same IP not locked out", r.status === 200, r.body);

  console.log("\n-- malformed / unknown --");
  r = await c.req("GET", "/api/auth/does-not-exist");
  check("unknown route -> JSON 404", r.status === 404 && r.body?.success === false, r.body);
  const bad = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not json",
  });
  check("malformed JSON -> 400 not 500", bad.status === 400, bad.status);
  r = await fetch(base + "/health").then((x) => x.json());
  check("health endpoint", r.status === "ok", r);

  console.log("\n-- storage --");
  const stored = await require("../src/models/user.model").findOne({ email: "alice@example.com" }).select("+password");
  check("password stored as a bcrypt hash", /^\$2[aby]\$\d{2}\$/.test(stored.password), stored.password?.slice(0, 7));
  const plainQuery = await require("../src/models/user.model").findOne({ email: "alice@example.com" });
  check("password not selected by default", plainQuery.password === undefined);
  const sessions = await require("../src/models/refreshToken.model").find({});
  check("refresh tokens stored hashed only", sessions.every((s) => /^[a-f0-9]{64}$/.test(s.tokenHash) && !s.token), sessions[0]);
  const idx = await require("../src/models/refreshToken.model").collection.indexes();
  check("refresh TTL index exists", idx.some((i) => i.expireAfterSeconds === 0), idx.map((i) => i.name));
  const bidx = await require("../src/models/blacklist.model").collection.indexes();
  check("blacklist TTL index exists", bidx.some((i) => i.expireAfterSeconds === 0), bidx.map((i) => i.name));

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("HARNESS ERROR", e);
  process.exit(1);
});
