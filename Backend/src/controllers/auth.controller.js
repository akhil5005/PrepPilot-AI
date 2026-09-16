const bcrypt = require("bcryptjs");

const userModel = require("../models/user.model");
const tokenService = require("../services/token.service");
const ApiError = require("../utils/apiError");
const asyncHandler = require("../utils/asyncHandler");

/*
 * A pre-computed bcrypt hash of a value nobody will ever submit.
 *
 * When login is attempted for an address that does not exist we still run a
 * bcrypt comparison against this hash. Without it the "no such user" path
 * returns in microseconds while the "wrong password" path takes ~100ms, and
 * that difference is measurable over the network — it lets an attacker
 * enumerate which email addresses have accounts before trying any passwords.
 */
const DUMMY_HASH =
  "$2b$12$CJvTPn7U/GLCWpuCFTd7Luy5MtStIdTf/LdQwqx4vb2uVT/WuLPLi";

/**
 * @description Details about the caller, stored with the session so a user can
 * later be shown where they are signed in from.
 */
function requestContext(req) {
  return {
    userAgent: req.get("user-agent") || null,
    ip: req.ip || null,
  };
}

/**
 * @route   POST /api/auth/register
 * @desc    Create a new account and start a session.
 * @access  Public
 *
 * Input is already validated and normalised by validateBody(registerSchema),
 * so this only has to deal with uniqueness and session creation.
 */
const registerUserController = asyncHandler(async (req, res) => {
  const { username, email, password } = req.body;

  /*
   * A friendly pre-check. It is NOT the thing that guarantees uniqueness —
   * two simultaneous requests can both pass it. The unique indexes on the
   * collection are the real guarantee, and the duplicate-key error they raise
   * is translated into a 409 by the error middleware.
   */
  /*
   * Case-insensitive collation so this also catches accounts stored before
   * emails were normalised. Without it, an existing "Akhil@Gmail.com" would not
   * block a signup for "akhil@gmail.com", and the two would coexist.
   */
  const existing = await userModel
    .findOne({ $or: [{ username }, { email }] })
    .collation({ locale: "en", strength: 2 })
    .lean();

  if (existing) {
    throw ApiError.conflict(
      existing.email === email
        ? "An account already exists with this email address"
        : "That username is already taken",
      {
        fields:
          existing.email === email
            ? { email: "An account already exists with this email address" }
            : { username: "That username is already taken" },
      },
    );
  }

  /* The pre('save') hook hashes the password; it is never stored in plaintext. */
  const user = await userModel.create({ username, email, password });

  await tokenService.issueSession(res, user, requestContext(req));

  res.status(201).json({
    success: true,
    message: "Account created successfully",
    user: user.toPublicJSON(),
  });
});

/**
 * @route   POST /api/auth/login
 * @desc    Verify credentials and start a session.
 * @access  Public (rate limited)
 */
const loginUserController = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  /*
   * `password` is select:false on the schema, so ask for it explicitly.
   * findByEmail also matches accounts stored before emails were normalised to
   * lowercase; a plain findOne would lock those users out permanently.
   */
  const user = await userModel.findByEmail(email, "+password");

  if (!user) {
    /* Equalise timing, then fail with the same message as a bad password. */
    await bcrypt.compare(password, DUMMY_HASH);

    throw ApiError.unauthorized("Invalid email or password", {
      code: "INVALID_CREDENTIALS",
    });
  }

  const isPasswordValid = await user.comparePassword(password);

  if (!isPasswordValid) {
    /*
     * Identical message and status for "unknown email" and "wrong password".
     * Distinguishing them would confirm to an attacker which addresses are
     * registered.
     */
    throw ApiError.unauthorized("Invalid email or password", {
      code: "INVALID_CREDENTIALS",
    });
  }

  user.lastLoginAt = new Date();

  /*
   * Self-healing migration: if this account was stored with a non-lowercase
   * email, normalise it now that we know the credentials are valid. Over time
   * this drains the legacy set without a manual migration script, and each
   * account only takes the slower collation lookup once.
   */
  if (user.email !== email) {
    user.email = email;
  }

  await user.save({ validateBeforeSave: false });

  await tokenService.issueSession(res, user, requestContext(req));

  res.status(200).json({
    success: true,
    message: "Logged in successfully",
    user: user.toPublicJSON(),
  });
});

/**
 * @route   POST /api/auth/refresh
 * @desc    Exchange a refresh token for a new access + refresh pair.
 * @access  Public (requires the refresh cookie)
 *
 * This is what makes the short access-token lifetime practical: the client
 * calls it transparently when a request comes back 401, and the user stays
 * signed in without any long lived credential sitting in the browser.
 */
const refreshTokenController = asyncHandler(async (req, res) => {
  const presented = req.cookies?.[tokenService.REFRESH_COOKIE];

  if (!presented) {
    throw ApiError.unauthorized("No active session", { code: "NO_REFRESH" });
  }

  let decoded;

  try {
    decoded = tokenService.verifyRefreshToken(presented);
  } catch (err) {
    /* A dead refresh token is useless; clear it so the browser stops sending it. */
    tokenService.clearAuthCookies(res);
    throw err;
  }

  const user = await userModel.findById(decoded.id);

  if (!user) {
    tokenService.clearAuthCookies(res);
    throw ApiError.unauthorized("Account no longer exists", {
      code: "USER_NOT_FOUND",
    });
  }

  if (decoded.tokenVersion !== user.tokenVersion) {
    tokenService.clearAuthCookies(res);
    throw ApiError.unauthorized("Session is no longer valid", {
      code: "TOKEN_STALE",
    });
  }

  let rotated;

  try {
    rotated = await tokenService.rotateRefreshToken(
      presented,
      user,
      decoded,
      requestContext(req),
    );
  } catch (err) {
    tokenService.clearAuthCookies(res);
    throw err;
  }

  const access = tokenService.signAccessToken(user);
  tokenService.setAuthCookies(res, access.token, rotated.token);

  res.status(200).json({
    success: true,
    message: "Session refreshed",
    user: user.toPublicJSON(),
  });
});

/**
 * @route   POST /api/auth/logout
 * @desc    End the current session only.
 * @access  Public (safe to call without a session)
 *
 * Three things happen, and all three are needed:
 *   - the refresh token's session row is revoked, so it can never be rotated;
 *   - the access token's jti is denylisted for its remaining lifetime;
 *   - both cookies are cleared.
 */
const logoutUserController = asyncHandler(async (req, res) => {
  const accessToken = req.cookies?.[tokenService.ACCESS_COOKIE];
  const refreshToken = req.cookies?.[tokenService.REFRESH_COOKIE];

  if (refreshToken) {
    try {
      const decoded = tokenService.verifyRefreshToken(refreshToken);
      await tokenService.revokeRefreshToken(decoded.jti);
    } catch {
      /* Already invalid: nothing left to revoke. */
    }
  }

  if (accessToken) {
    await tokenService.blacklistAccessToken(accessToken);
  }

  tokenService.clearAuthCookies(res);

  /* Always 200: logging out should never fail, even with no session. */
  res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
});

/**
 * @route   POST /api/auth/logout-all
 * @desc    End every session for the current user, on every device.
 * @access  Private
 */
const logoutAllController = asyncHandler(async (req, res) => {
  const user = req.user;

  /*
   * Bumping tokenVersion invalidates every access token already issued, without
   * having to enumerate them; revoking the sessions stops the refresh tokens.
   */
  user.tokenVersion += 1;
  await user.save({ validateBeforeSave: false });

  await tokenService.revokeAllUserSessions(user._id);
  tokenService.clearAuthCookies(res);

  res.status(200).json({
    success: true,
    message: "Logged out from all devices",
  });
});

/**
 * @route   POST /api/auth/change-password
 * @desc    Change the password and invalidate every other session.
 * @access  Private (rate limited)
 */
const changePasswordController = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await userModel.findById(req.user._id).select("+password");

  if (!user) {
    throw ApiError.unauthorized("Account no longer exists");
  }

  const isCurrentValid = await user.comparePassword(currentPassword);

  if (!isCurrentValid) {
    throw ApiError.unauthorized("Current password is incorrect", {
      fields: { currentPassword: "Current password is incorrect" },
    });
  }

  user.password = newPassword; /* hashed by the pre('save') hook */

  /*
   * A password change must log out anyone else holding a token for this
   * account — that is the entire point of changing it after a suspected
   * compromise.
   */
  user.tokenVersion += 1;
  await user.save();

  await tokenService.revokeAllUserSessions(user._id);

  /* Keep the caller signed in on this device with a brand new session. */
  await tokenService.issueSession(res, user, requestContext(req));

  res.status(200).json({
    success: true,
    message: "Password changed successfully. Other devices were signed out.",
  });
});

/**
 * @route   GET /api/auth/get-me
 * @desc    Return the signed in user.
 * @access  Private
 *
 * The middleware has already loaded and validated the user, so there is no
 * second database round trip here and no possibility of the null dereference
 * the previous version had when the account had been deleted.
 */
const getMeController = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    message: "User details fetched successfully",
    user: req.user.toPublicJSON(),
  });
});

module.exports = {
  registerUserController,
  loginUserController,
  refreshTokenController,
  logoutUserController,
  logoutAllController,
  changePasswordController,
  getMeController,
};
