/**
 * Wrap an async route handler so that a rejected promise is forwarded to the
 * Express error middleware instead of becoming an unhandled rejection.
 *
 * Express 5 already forwards rejections from async handlers, but wrapping
 * explicitly keeps the behaviour obvious and keeps the handlers working if the
 * app is ever downgraded or a handler is reused outside a router.
 *
 * @param {Function} handler async (req, res, next) => any
 * @returns {Function} an express compatible handler
 */
function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
