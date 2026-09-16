const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const config = require("../config/env");
const refreshTokenModel = require("../models/refreshToken.model");
const tokenBlacklistModel = require("../models/blacklist.model");
const ApiError = require("../utils/apiError");

const ACCESS_COOKIE = "accessToken";
const REFRESH_COOKIE = "refreshToken";

/*
 * The refresh cookie is scoped to /api/auth so the browser only ever sends it
 * to the endpoints that need it (refresh / logout). It is therefore not
 * attached to ordinary API calls, which shrinks its exposure considerably.
 */
const REFRESH_COOKIE_PATH = "/api/auth";

/**
 * @description Base cookie attributes shared by both tokens.
 *
 * httpOnly  - unreadable from JavaScript, so XSS cannot exfiltrate the token.
 * secure    - HTTPS only in production.
 * sameSite  - "none" in production because the SPA is on a different origin
 *             (and "none" requires secure); "lax" locally where both run on
 *             localhost, which keeps CSRF protection during development.
 */
function baseCookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: config.isProduction ? "none" : "lax",
  };
}

/**
 * @description Convert a JWT style duration ("15m", "7d") to milliseconds.
 * Used to give the cookie the same lifetime as the token inside it, so the
 * browser stops sending a token the server would only reject.
 * @param {string} ttl
 * @returns {number} milliseconds
 */
function ttlToMs(ttl) {
  const match = /^(\d+)([smhd])$/.exec(String(ttl).trim());

  if (!match) {
    throw new Error(`Invalid token TTL: ${ttl}`);
  }

  const amount = Number(match[1]);
  const unit = match[2];

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return amount * multipliers[unit];
}

/**
 * @description Hash a token for storage. SHA-256 is right here (unlike bcrypt
 * for passwords) because the input is already 200+ bits of unguessable entropy,
 * so there is nothing to brute force and we want the lookup to be fast.
 * @param {string} token
 * @returns {string} hex digest
 */
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function newId() {
  return crypto.randomUUID();
}

/**
 * @description Sign a short lived access token.
 * @param {object} user mongoose user document
 * @returns {{ token: string, jti: string, expiresAt: Date }}
 */
function signAccessToken(user) {
  const jti = newId();

  const token = jwt.sign(
    {
      id: user._id.toString(),
      username: user.username,
      tokenVersion: user.tokenVersion,
    },
    config.jwt.accessSecret,
    {
      expiresIn: config.jwt.accessTtl,
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
      subject: user._id.toString(),
      jwtid: jti,
    },
  );

  return {
    token,
    jti,
    expiresAt: new Date(Date.now() + ttlToMs(config.jwt.accessTtl)),
  };
}

/**
 * @description Sign a refresh token and persist the session that owns it.
 * @param {object} user mongoose user document
 * @param {object} [context] { family, userAgent, ip }
 * @returns {Promise<{ token: string, jti: string, family: string, expiresAt: Date }>}
 */
async function issueRefreshToken(user, context = {}) {
  const jti = newId();
  const family = context.family || newId();
  const expiresAt = new Date(Date.now() + ttlToMs(config.jwt.refreshTtl));

  const token = jwt.sign(
    {
      id: user._id.toString(),
      tokenVersion: user.tokenVersion,
      family,
    },
    config.jwt.refreshSecret,
    {
      expiresIn: config.jwt.refreshTtl,
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
      subject: user._id.toString(),
      jwtid: jti,
    },
  );

  await refreshTokenModel.create({
    jti,
    tokenHash: hashToken(token),
    user: user._id,
    family,
    expiresAt,
    userAgent: context.userAgent || null,
    ip: context.ip || null,
  });

  return { token, jti, family, expiresAt };
}

/**
 * @description Verify an access token's signature and claims.
 * @param {string} token
 * @returns {object} decoded payload
 * @throws {ApiError} 401 when the token is expired, tampered with, or foreign
 */
function verifyAccessToken(token) {
  try {
    return jwt.verify(token, config.jwt.accessSecret, {
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    });
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      throw ApiError.unauthorized("Access token expired", {
        code: "TOKEN_EXPIRED",
      });
    }

    throw ApiError.unauthorized("Invalid access token", {
      code: "TOKEN_INVALID",
    });
  }
}

/**
 * @description Verify a refresh token's signature and claims.
 */
function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, config.jwt.refreshSecret, {
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    });
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      throw ApiError.unauthorized("Session expired, please log in again", {
        code: "REFRESH_EXPIRED",
      });
    }

    throw ApiError.unauthorized("Invalid session", {
      code: "REFRESH_INVALID",
    });
  }
}

/**
 * @description Revoke a single access token until it would expire on its own.
 * Cheap because the TTL index removes the row automatically.
 */
async function blacklistAccessToken(token) {
  let decoded;

  try {
    /* Decode without verifying: an already expired token needs no denylisting. */
    decoded = jwt.verify(token, config.jwt.accessSecret, {
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    });
  } catch {
    return;
  }

  if (!decoded.jti || !decoded.exp) {
    return;
  }

  await tokenBlacklistModel.updateOne(
    { jti: decoded.jti },
    {
      $setOnInsert: {
        jti: decoded.jti,
        user: decoded.id,
        expiresAt: new Date(decoded.exp * 1000),
      },
    },
    { upsert: true },
  );
}

/**
 * @description Is this access token id on the denylist?
 */
async function isAccessTokenRevoked(jti) {
  if (!jti) {
    return false;
  }

  const found = await tokenBlacklistModel.exists({ jti });
  return Boolean(found);
}

/**
 * @description Rotate a refresh token.
 *
 * The presented token is validated against the stored session. If it was
 * already rotated or revoked, we assume it was stolen and revoke the entire
 * family, which logs out both the attacker and the legitimate user rather than
 * letting the attacker ride along silently.
 *
 * @param {string} presentedToken
 * @param {object} user mongoose user document (already loaded and checked)
 * @param {object} decoded verified payload of the presented token
 * @param {object} [context] { userAgent, ip }
 * @returns {Promise<{ token: string, jti: string, family: string, expiresAt: Date }>}
 */
async function rotateRefreshToken(presentedToken, user, decoded, context = {}) {
  const stored = await refreshTokenModel.findOne({ jti: decoded.jti });

  if (!stored) {
    throw ApiError.unauthorized("Session not recognised", {
      code: "REFRESH_UNKNOWN",
    });
  }

  /* Guard against a forged jti pointing at somebody else's session. */
  if (stored.tokenHash !== hashToken(presentedToken)) {
    await revokeFamily(stored.family);
    throw ApiError.unauthorized("Session mismatch, please log in again", {
      code: "REFRESH_MISMATCH",
    });
  }

  if (stored.revokedAt) {
    /* Reuse of a rotated token: treat the whole family as compromised. */
    await revokeFamily(stored.family);

    throw ApiError.unauthorized(
      "Session reuse detected, all sessions have been ended",
      { code: "REFRESH_REUSED" },
    );
  }

  const next = await issueRefreshToken(user, {
    family: stored.family,
    userAgent: context.userAgent,
    ip: context.ip,
  });

  stored.revokedAt = new Date();
  stored.replacedBy = next.jti;
  await stored.save();

  return next;
}

/**
 * @description Revoke every token in a session family.
 */
async function revokeFamily(family) {
  await refreshTokenModel.updateMany(
    { family, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

/**
 * @description Revoke a single session (used by logout).
 */
async function revokeRefreshToken(jti) {
  if (!jti) {
    return;
  }

  await refreshTokenModel.updateOne(
    { jti, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

/**
 * @description Revoke every session belonging to a user.
 */
async function revokeAllUserSessions(userId) {
  await refreshTokenModel.updateMany(
    { user: userId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

/**
 * @description Write both cookies onto the response.
 */
function setAuthCookies(res, accessToken, refreshToken) {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...baseCookieOptions(),
    maxAge: ttlToMs(config.jwt.accessTtl),
    path: "/",
  });

  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...baseCookieOptions(),
    maxAge: ttlToMs(config.jwt.refreshTtl),
    path: REFRESH_COOKIE_PATH,
  });
}

/**
 * @description Clear both cookies. The attributes must match the ones used when
 * setting them or the browser silently keeps the cookie.
 */
function clearAuthCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { ...baseCookieOptions(), path: "/" });
  res.clearCookie(REFRESH_COOKIE, {
    ...baseCookieOptions(),
    path: REFRESH_COOKIE_PATH,
  });

  /*
   * The pre-rotation version of this app used a single cookie named "token".
   * Clearing it too means existing visitors are not left with a stale cookie
   * that can never be used again.
   */
  res.clearCookie("token", { ...baseCookieOptions(), path: "/" });
}

/**
 * @description Issue a fresh access + refresh pair and set both cookies.
 * @returns {Promise<void>}
 */
async function issueSession(res, user, context = {}) {
  const access = signAccessToken(user);
  const refresh = await issueRefreshToken(user, context);

  setAuthCookies(res, access.token, refresh.token);
}

module.exports = {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  ttlToMs,
  hashToken,
  signAccessToken,
  issueRefreshToken,
  issueSession,
  verifyAccessToken,
  verifyRefreshToken,
  blacklistAccessToken,
  isAccessTokenRevoked,
  rotateRefreshToken,
  revokeFamily,
  revokeRefreshToken,
  revokeAllUserSessions,
  setAuthCookies,
  clearAuthCookies,
};
