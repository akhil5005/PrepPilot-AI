const ApiError = require("../utils/apiError");

/**
 * A small dependency-free rate limiter.
 *
 * Why this exists: without it, /login and /register accept unlimited attempts,
 * which makes offline-quality password guessing possible online and lets anyone
 * fill the users collection. bcrypt makes each attempt expensive for the SERVER
 * too, so an unlimited login endpoint is also a cheap denial of service.
 *
 * Implementation notes and limits:
 *
 *   - It uses a fixed window counter held in process memory. That is the right
 *     trade-off for a single instance deployment and costs no new package.
 *   - State is per process. If this app is ever scaled to several instances or
 *     a serverless platform, each instance keeps its own counters and the
 *     effective limit multiplies by the instance count. At that point swap the
 *     Map for Redis (or the `rate-limit-redis` store) and keep this interface.
 *   - Expired buckets are swept lazily on access plus on a slow interval timer,
 *     so memory does not grow with the number of distinct IPs seen.
 */

/**
 * @param {object} options
 * @param {number} options.windowMs Size of the window in milliseconds.
 * @param {number} options.max Maximum number of requests allowed per window.
 * @param {string} [options.message] Message returned on rejection.
 * @param {(req: object) => string} [options.keyGenerator] How to bucket requests.
 * @param {boolean} [options.skipSuccessfulRequests] Only count failed responses
 *        (status >= 400). Used for login so that a busy, legitimate user is
 *        never locked out by their own successful requests.
 * @returns {Function} express middleware
 */
function createRateLimiter(options) {
  const {
    windowMs,
    max,
    message = "Too many requests, please try again later",
    keyGenerator = (req) => req.ip || "unknown",
    skipSuccessfulRequests = false,
  } = options;

  /** @type {Map<string, { count: number, resetAt: number }>} */
  const buckets = new Map();

  /*
   * Periodic sweep. unref() so this timer never keeps the process alive during
   * a graceful shutdown or a test run.
   */
  const sweep = setInterval(() => {
    const now = Date.now();

    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
      }
    }
  }, windowMs).unref();

  function middleware(req, res, next) {
    const key = keyGenerator(req);
    const now = Date.now();

    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    if (bucket.count >= max) {
      const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1000);

      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.setHeader("RateLimit-Limit", String(max));
      res.setHeader("RateLimit-Remaining", "0");
      res.setHeader("RateLimit-Reset", String(retryAfterSeconds));

      return next(
        ApiError.tooManyRequests(message, { retryAfter: retryAfterSeconds }),
      );
    }

    if (skipSuccessfulRequests) {
      /*
       * Count the request only once we know the outcome, and only if it failed.
       * "finish" fires after the response has been sent, so this never delays
       * the reply.
       */
      res.on("finish", () => {
        if (res.statusCode >= 400) {
          bucket.count += 1;
        }
      });
    } else {
      bucket.count += 1;
    }

    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader(
      "RateLimit-Remaining",
      String(Math.max(0, max - bucket.count)),
    );

    return next();
  }

  /* Exposed for tests and for resetting a bucket after a successful login. */
  middleware.reset = (key) => buckets.delete(key);
  middleware.stop = () => clearInterval(sweep);

  return middleware;
}

/* ------------------------------------------------------------------ */
/* Preconfigured limiters used by the auth routes                      */
/* ------------------------------------------------------------------ */

/**
 * Login: keyed by IP *and* the email being attempted. Keying by both means a
 * shared office IP cannot lock out an unrelated colleague, while an attacker
 * spraying one account from one address still gets stopped quickly.
 */
const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  message:
    "Too many failed login attempts. Please wait a few minutes and try again.",
  keyGenerator: (req) => {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    return `login:${req.ip}:${email}`;
  },
});

const registerLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Too many accounts created from this address. Try again later.",
  keyGenerator: (req) => `register:${req.ip}`,
});

/*
 * Refresh is called automatically by the client on every access-token
 * expiry, so its ceiling is higher; it exists to stop a loop or a script
 * hammering the endpoint rather than to throttle a normal user.
 */
const refreshLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: "Too many session refresh attempts, please log in again.",
  keyGenerator: (req) => `refresh:${req.ip}`,
});

const changePasswordLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  message: "Too many password change attempts, please try again later.",
  keyGenerator: (req) => `change-password:${req.ip}`,
});

module.exports = {
  createRateLimiter,
  loginLimiter,
  registerLimiter,
  refreshLimiter,
  changePasswordLimiter,
};
