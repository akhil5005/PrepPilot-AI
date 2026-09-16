/**
 * Centralised, validated environment configuration.
 *
 * Everything that reads process.env should read it from here instead, so that
 * a missing or malformed variable fails loudly at boot instead of producing a
 * confusing runtime error on the first request (for example `jwt.sign` throwing
 * "secretOrPrivateKey must have a value" when JWT_SECRET is undefined).
 */

const isProduction = process.env.NODE_ENV === "production";

/**
 * @description Read a required variable, collecting the name if it is missing.
 */
const missing = [];

function required(name) {
  const value = process.env[name];

  if (!value || !value.trim()) {
    missing.push(name);
    return "";
  }

  return value.trim();
}

function optional(name, fallback) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

const config = {
  isProduction,
  nodeEnv: optional("NODE_ENV", "development"),
  port: Number(optional("PORT", "3000")),
  mongoUri: required("MONGO_URI"),

  jwt: {
    /*
     * Access and refresh tokens are signed with different secrets so that a
     * leaked access-token secret cannot be used to mint refresh tokens.
     * JWT_REFRESH_SECRET is optional for backwards compatibility; when it is
     * absent we derive a distinct secret from JWT_SECRET.
     */
    accessSecret: required("JWT_SECRET"),
    refreshSecret: optional("JWT_REFRESH_SECRET", null),
    accessTtl: optional("JWT_ACCESS_TTL", "15m"),
    refreshTtl: optional("JWT_REFRESH_TTL", "7d"),
    issuer: optional("JWT_ISSUER", "genaiapp"),
    audience: optional("JWT_AUDIENCE", "genaiapp-client"),
  },

  /*
   * FRONTEND_URL may hold a comma separated list so that a preview deployment
   * and the production domain can both be allowed.
   */
  allowedOrigins: optional("FRONTEND_URL", "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),

  bcryptRounds: Number(optional("BCRYPT_ROUNDS", "12")),
};

if (!config.jwt.refreshSecret) {
  config.jwt.refreshSecret = `${config.jwt.accessSecret}:refresh`;
}

if (missing.length) {
  throw new Error(
    `Missing required environment variables: ${missing.join(", ")}`,
  );
}

if (isProduction && config.jwt.accessSecret.length < 32) {
  throw new Error(
    "JWT_SECRET must be at least 32 characters long in production",
  );
}

if (!Number.isFinite(config.port)) {
  throw new Error("PORT must be a number");
}

if (!Number.isFinite(config.bcryptRounds) || config.bcryptRounds < 10) {
  throw new Error("BCRYPT_ROUNDS must be a number greater than or equal to 10");
}

module.exports = config;
