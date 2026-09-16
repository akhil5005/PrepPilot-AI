/**
 * An error that carries an HTTP status code and is safe to show to a client.
 *
 * Anything thrown that is NOT an ApiError is treated by the error middleware as
 * an unexpected failure and reported as a generic 500, so that stack traces and
 * database messages never leak to the caller.
 */
class ApiError extends Error {
  /**
   * @param {number} statusCode HTTP status code to send.
   * @param {string} message Client safe message.
   * @param {object} [details] Optional structured details (e.g. field errors).
   */
  constructor(statusCode, message, details) {
    super(message);

    this.name = "ApiError";
    this.statusCode = statusCode;
    this.expected = true;

    if (details) {
      this.details = details;
    }

    Error.captureStackTrace(this, ApiError);
  }

  static badRequest(message, details) {
    return new ApiError(400, message, details);
  }

  static unauthorized(message = "Authentication required", details) {
    return new ApiError(401, message, details);
  }

  static forbidden(message = "You are not allowed to do that", details) {
    return new ApiError(403, message, details);
  }

  static notFound(message = "Resource not found", details) {
    return new ApiError(404, message, details);
  }

  static conflict(message, details) {
    return new ApiError(409, message, details);
  }

  static tooManyRequests(message = "Too many requests", details) {
    return new ApiError(429, message, details);
  }
}

module.exports = ApiError;
