const { z } = require("zod");

/*
 * Input validation lives here rather than inside the controllers so that the
 * rules are stated once, in one place, and the controllers can assume they are
 * working with well formed data.
 *
 * zod is already a dependency of this project (it is used for the AI service
 * schemas), so this adds no new package.
 */

const usernameSchema = z
  .string({ error: "Username is required" })
  .trim()
  .min(3, "Username must be at least 3 characters long")
  .max(30, "Username must be at most 30 characters long")
  .regex(
    /^[a-zA-Z0-9_.-]+$/,
    "Username may only contain letters, numbers, underscore, dot and hyphen",
  );

const emailSchema = z
  .string({ error: "Email is required" })
  .trim()
  .toLowerCase()
  .email("Please provide a valid email address")
  .max(254, "Email address is too long");

/*
 * Password rules: long enough to resist offline cracking, mixed enough to rule
 * out the obvious dictionary entries, and capped at 72 bytes because bcrypt
 * silently ignores everything past that. Without the cap, a user with a 100
 * character password would have only the first 72 bytes checked, which is
 * surprising and makes the extra length a false sense of security.
 */
const passwordSchema = z
  .string({ error: "Password is required" })
  .min(8, "Password must be at least 8 characters long")
  .max(72, "Password must be at most 72 characters long")
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[0-9]/, "Password must contain a number");

const registerSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
});

const loginSchema = z.object({
  email: emailSchema,
  /*
   * Deliberately NOT passwordSchema. Applying the strength rules at login would
   * reject legacy passwords that predate the rules, and would tell an attacker
   * which guesses are even worth submitting.
   */
  password: z
    .string({ error: "Password is required" })
    .min(1, "Password is required")
    .max(72, "Password must be at most 72 characters long"),
});

const changePasswordSchema = z
  .object({
    currentPassword: z
      .string({ error: "Current password is required" })
      .min(1, "Current password is required"),
    newPassword: passwordSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must be different from the current password",
    path: ["newPassword"],
  });

module.exports = {
  registerSchema,
  loginSchema,
  changePasswordSchema,
};
