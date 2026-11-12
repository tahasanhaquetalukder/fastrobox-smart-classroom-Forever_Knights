function notFound(req, res) {
  res.status(404).json({ error: 'not found' });
}

function errorHandler(err, req, res, next) {
  console.error('[error]', err.message);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || 'internal error' });
}

module.exports = { notFound, errorHandler };