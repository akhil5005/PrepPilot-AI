const config = require("../config/env");
const ApiError = require("../utils/apiError");

/**
 * 404 handler. Mounted after every route so any unmatched path produces a JSON
 * body in the same shape as every other error, instead of Express's HTML page.
 */
function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}

/**
 * Central error handler.
 *
 * The original controllers had no try/catch at all, which meant a database
 * hiccup produced an unhandled rejection and a request that simply hung. This
 * catches everything, normalises known failure shapes, and guarantees that
 * internal details never reach the client in production.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies the error handler by arity (4 args)
function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || 500;
  let message = err.message || "Something went wrong";
  let details = err.details;

  /* Duplicate key from a unique index (concurrent registration, mainly). */
  if (err.code === 11000) {
    statusCode = 409;

    const field = Object.keys(err.keyPattern || err.keyValue || {})[0];

    message =
      field === "email"
        ? "An account already exists with this email address"
        : field === "username"
          ? "That username is already taken"
          : "That record already exists";

    details = field ? { fields: { [field]: message } } : undefined;
  }

  /* Mongoose schema validation. */
  if (err.name === "ValidationError" && err.errors) {
    statusCode = 400;
    message = "Validation failed";
    details = {
      fields: Object.fromEntries(
        Object.entries(err.errors).map(([field, issue]) => [
          field,
          issue.message,
        ]),
      ),
    };
  }

  /* Malformed ObjectId etc. */
  if (err.name === "CastError") {
    statusCode = 400;
    message = "Invalid identifier";
    details = undefined;
  }

  /* Body parser rejected malformed JSON. */
  if (err.type === "entity.parse.failed") {
    statusCode = 400;
    message = "Request body is not valid JSON";
  }

  const isUnexpected = statusCode >= 500 && !(err instanceof ApiError);

  if (isUnexpected) {
    /*
     * Log the real error server side, return a generic one to the client. A
     * stack trace or a Mongo error string in a response body is free
     * reconnaissance for an attacker.
     */
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    message = "Something went wrong, please try again";
    details = undefined;
  }

  const body = { success: false, message };

  if (details) {
    body.details = details;
  }

  if (!config.isProduction && isUnexpected) {
    body.stack = err.stack;
  }

  res.status(statusCode).json(body);
}

module.exports = { notFoundHandler, errorHandler };
