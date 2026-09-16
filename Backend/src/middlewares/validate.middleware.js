const ApiError = require("../utils/apiError");

/**
 * Build a middleware that validates `req.body` against a zod schema.
 *
 * On success `req.body` is REPLACED by the parsed result, so downstream code
 * gets the trimmed / lowercased values and, importantly, only the fields the
 * schema declares. That strips any extra properties a caller tried to smuggle
 * in (for example `tokenVersion` or `role`), which is what makes mass
 * assignment attacks impossible here.
 *
 * @param {import("zod").ZodType} schema
 * @returns {Function} express middleware
 */
function validateBody(schema) {
  return function validateBodyMiddleware(req, res, next) {
    const result = schema.safeParse(req.body ?? {});

    if (!result.success) {
      /* Collapse zod's issue list into { field: "first message" }. */
      const fieldErrors = {};

      for (const issue of result.error.issues) {
        const field = issue.path.join(".") || "_";

        if (!fieldErrors[field]) {
          fieldErrors[field] = issue.message;
        }
      }

      return next(
        ApiError.badRequest("Validation failed", { fields: fieldErrors }),
      );
    }

    req.body = result.data;
    return next();
  };
}

module.exports = { validateBody };
