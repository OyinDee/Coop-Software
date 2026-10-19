const jwt = require('jsonwebtoken');

module.exports = function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role === 'payroll') {
      const pathname = req.originalUrl.split('?')[0].replace(/\/$/, '') || '/';
      const allowed = (
        (req.method === 'GET' && pathname === '/api/auth/me') ||
        (req.method === 'GET' && pathname === '/api/deductions') ||
        (req.method === 'GET' && pathname === '/api/deductions/reconciliation') ||
        (req.method === 'POST' && pathname === '/api/deductions/reconciliation-upload') ||
        (req.method === 'POST' && pathname === '/api/members/reports/email-monthly')
      );
      if (!allowed) {
        return res.status(403).json({ error: 'This account does not have access to this resource' });
      }
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};
