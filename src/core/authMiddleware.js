const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'vidyarthicompanion_dev_secret_change_me';

/**
 * Signs a short-lived access token for a user.
 * Kept here so the auth controller and middleware share one source of truth.
 */
const signToken = (user) =>
  jwt.sign({ sub: user.userId, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

/**
 * Protect middleware: verifies the Bearer token and attaches req.user.
 * Downstream controllers should ALWAYS trust req.user.userId, never a
 * client-supplied userId, for any write scoped to "the current user".
 */
const protect = (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = { userId: decoded.sub, role: decoded.role };
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
};

/**
 * Role guard. Usage: router.post('/x', protect, requireRole('cr', 'admin'), handler)
 */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Insufficient permissions.' });
  }
  return next();
};

module.exports = { protect, requireRole, signToken, JWT_SECRET };
