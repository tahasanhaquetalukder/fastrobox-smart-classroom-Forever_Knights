function notFound(req, res) {
  res.status(404).json({ error: 'not found' });
}

const config = require('../config');

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = err.status || 500;
  if (status >= 500) console.error(`[error] ${config.redact(err.message)}`);
  res.status(status).json({ error: status >= 500 ? 'internal error' : err.message });
}

module.exports = { notFound, errorHandler };