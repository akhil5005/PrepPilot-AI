const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");

const config = require("./config/env");
const ApiError = require("./utils/apiError");
const {
  notFoundHandler,
  errorHandler,
} = require("./middlewares/error.middleware");

const app = express();

/*
 * Render / Vercel / any reverse proxy terminates TLS and forwards the real
 * client address in X-Forwarded-For. Without trusting the proxy, `req.ip` is
 * the proxy's address, which would put every visitor in the same rate-limit
 * bucket, and `secure` cookies would not be recognised as sent over HTTPS.
 * `1` (trust one hop) rather than `true`, because trusting every hop lets a
 * client spoof its own IP by sending the header itself.
 */
app.set("trust proxy", 1);

/* Do not advertise the server technology. */
app.disable("x-powered-by");

/*
 * A body size cap. The default is already 100kb, but stating it makes the
 * intent explicit and keeps auth endpoints from being fed megabytes of JSON.
 */
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));
app.use(cookieParser());

/*
 * CORS. `credentials: true` is required for the browser to send the auth
 * cookies cross-origin, and it is only safe alongside an explicit origin
 * allowlist — a wildcard origin with credentials is rejected by browsers and
 * reflecting whatever origin asked would defeat the point entirely.
 */
app.use(
  cors({
    origin(origin, callback) {
      /* Same-origin requests and tools like curl send no Origin header. */
      if (!origin) {
        return callback(null, true);
      }

      if (config.allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      /* A rejected origin is a client mistake (403), not a server fault (500). */
      return callback(
        ApiError.forbidden(`Origin ${origin} is not allowed by CORS`),
      );
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

/*
 * A minimal set of security headers, hand written so no new dependency is
 * needed. If `helmet` is ever added, it supersedes this block.
 */
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");

  if (config.isProduction) {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }

  /* Auth responses must never be cached by a browser or an intermediary. */
  if (req.path.startsWith("/api/auth")) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
  }

  next();
});

/* require all the routes here */
const authRouter = require("./routes/auth.routes");
const interviewRouter = require("./routes/interview.routes");

/* Liveness probe, useful for the hosting platform. */
app.get("/health", (req, res) => {
  res.status(200).json({ success: true, status: "ok" });
});

/*Using all the routes here */
app.use("/api/auth", authRouter);
app.use("/api/interview", interviewRouter);

/* These two must stay last, and in this order. */
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
