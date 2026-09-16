const express = require("express");

const authController = require("../controllers/auth.controller");
const { authUser } = require("../middlewares/auth.middleware");
const { validateBody } = require("../middlewares/validate.middleware");
const {
  loginLimiter,
  registerLimiter,
  refreshLimiter,
  changePasswordLimiter,
} = require("../middlewares/rateLimit.middleware");
const {
  registerSchema,
  loginSchema,
  changePasswordSchema,
} = require("../validators/auth.validator");

const authRouter = express.Router();

/*
 * Each route reads as: throttle -> validate -> authenticate -> handle.
 * Keeping that order matters: throttling first means a flood of junk never
 * reaches the (bcrypt-expensive) handler, and validating before authenticating
 * means malformed input is rejected with a clear 400 rather than a vague 401.
 */

/**
 * @route   POST /api/auth/register
 * @desc    Create a new account and sign in
 * @access  Public
 */
authRouter.post(
  "/register",
  registerLimiter,
  validateBody(registerSchema),
  authController.registerUserController,
);

/**
 * @route   POST /api/auth/login
 * @desc    Sign in with email and password
 * @access  Public
 */
authRouter.post(
  "/login",
  validateBody(loginSchema),
  loginLimiter,
  authController.loginUserController,
);

/**
 * @route   POST /api/auth/refresh
 * @desc    Rotate the refresh token and mint a new access token
 * @access  Public (requires the refresh cookie)
 */
authRouter.post(
  "/refresh",
  refreshLimiter,
  authController.refreshTokenController,
);

/**
 * @route   POST /api/auth/logout
 * @desc    End the current session
 * @access  Public
 *
 * POST rather than GET: logout changes server state, and a GET endpoint that
 * mutates state can be triggered by any page that embeds it as an image or a
 * link prefetch. The GET route below is kept only so older clients that have
 * not been redeployed do not break.
 */
authRouter.post("/logout", authController.logoutUserController);
authRouter.get("/logout", authController.logoutUserController);

/**
 * @route   POST /api/auth/logout-all
 * @desc    End every session for this account, on every device
 * @access  Private
 */
authRouter.post("/logout-all", authUser, authController.logoutAllController);

/**
 * @route   POST /api/auth/change-password
 * @desc    Change the password and sign out every other device
 * @access  Private
 */
authRouter.post(
  "/change-password",
  changePasswordLimiter,
  authUser,
  validateBody(changePasswordSchema),
  authController.changePasswordController,
);

/**
 * @route   GET /api/auth/get-me
 * @desc    Return the signed in user
 * @access  Private
 */
authRouter.get("/get-me", authUser, authController.getMeController);

module.exports = authRouter;
