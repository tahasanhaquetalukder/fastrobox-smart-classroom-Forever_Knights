const config = require('../config');

function notFound(req, res) {
  res.status(404).json({ error: 'not found' });
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = err.status || 500;
  if (status >= 500) console.error(`[error] ${config.redact(err.stack || err.message)}`);
  const message = status >= 500 ? 'internal error' : err.message;
  res.status(status).json({ error: message });
}

module.exports = { notFound, errorHandler };
