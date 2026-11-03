module.exports = (err, req, res, _next) => {
  console.error('Unhandled error:', err.message);
  const status = err.status || 500;
  res.status(status).json({ error: status < 500 ? err.message : 'Redis operation failed; check server logs and service access' });
};
