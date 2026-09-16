const userModel = require("../models/user.model");
const tokenService = require("../services/token.service");
const ApiError = require("../utils/apiError");
const asyncHandler = require("../utils/asyncHandler");

/**
 * @description Pull the access token out of the request.
 *
 * The cookie is the primary channel (httpOnly, set by the server). The
 * Authorization header is accepted as well so that non-browser clients — a
 * mobile app, curl, an integration test — can authenticate without cookies.
 */
function extractAccessToken(req) {
  if (req.cookies && req.cookies[tokenService.ACCESS_COOKIE]) {
    return req.cookies[tokenService.ACCESS_COOKIE];
  }

  /* Backwards compatibility with the single-cookie scheme this replaced. */
  if (req.cookies && req.cookies.token) {
    return req.cookies.token;
  }

  const header = req.headers.authorization;

  if (header && header.startsWith("Bearer ")) {
    return header.slice(7).trim();
  }

  return null;
}

/**
 * Require a valid, current session.
 *
 * Every check below exists for a reason the previous version missed:
 *
 *   1. signature + expiry  - the token is genuine and still valid.
 *   2. denylist by jti     - the token was explicitly revoked by a logout.
 *   3. user still exists   - a deleted account cannot keep using its token
 *                            (previously this crashed getMe with a TypeError).
 *   4. tokenVersion match  - "log out everywhere" and password changes
 *                            invalidate every token already issued.
 *
 * On success `req.user` holds the loaded user document, so controllers no
 * longer have to refetch it, and `req.auth` holds the raw token claims.
 */
const authUser = asyncHandler(async (req, res, next) => {
  const token = extractAccessToken(req);

  if (!token) {
    throw ApiError.unauthorized("Authentication required", {
      code: "NO_TOKEN",
    });
  }

  const decoded = tokenService.verifyAccessToken(token);

  if (await tokenService.isAccessTokenRevoked(decoded.jti)) {
    throw ApiError.unauthorized("Session has been ended", {
      code: "TOKEN_REVOKED",
    });
  }

  const user = await userModel.findById(decoded.id);

  if (!user) {
    throw ApiError.unauthorized("Account no longer exists", {
      code: "USER_NOT_FOUND",
    });
  }

  if (typeof decoded.tokenVersion === "number") {
    if (decoded.tokenVersion !== user.tokenVersion) {
      throw ApiError.unauthorized("Session is no longer valid", {
        code: "TOKEN_STALE",
      });
    }
  }

  req.user = user;
  req.auth = decoded;
  /* Kept so existing controllers that read `req.user.id` keep working. */
  req.userId = user._id;

  next();
});

/**
 * Attach the user when a valid token is present, but never reject.
 * Useful for endpoints that render differently for signed in visitors.
 */
const optionalAuth = asyncHandler(async (req, res, next) => {
  const token = extractAccessToken(req);

  if (!token) {
    return next();
  }

  try {
    const decoded = tokenService.verifyAccessToken(token);

    if (await tokenService.isAccessTokenRevoked(decoded.jti)) {
      return next();
    }

    const user = await userModel.findById(decoded.id);

    if (user && decoded.tokenVersion === user.tokenVersion) {
      req.user = user;
      req.auth = decoded;
      req.userId = user._id;
    }
  } catch {
    /* An invalid token is simply treated as "not signed in" here. */
  }

  return next();
});

module.exports = { authUser, optionalAuth, extractAccessToken };
