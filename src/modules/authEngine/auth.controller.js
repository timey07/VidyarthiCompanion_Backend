const bcrypt = require('bcryptjs');
const User = require('../../sharedModels/User.model');
const { signToken } = require('../../core/authMiddleware');

/**
 * Generate a stable, human-readable userId handle from a name/email.
 * Falls back to a random suffix to guarantee uniqueness under contention.
 */
const buildUserId = (name) => {
  const base = String(name || 'student')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20) || 'student';
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base}_${suffix}`;
};

/** Normalize a user-chosen handle into a safe, lowercase username. */
const normalizeUsername = (username) =>
  String(username || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);

// POST /api/v1/auth/register
exports.register = async (req, res) => {
  try {
    const { name, email, password, role, username } = req.body;

    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ success: false, message: 'Name, email, and password are required.' });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Email is already registered.' });
    }

    // Resolve a unique username (falls back to a slug of the name).
    let handle = normalizeUsername(username) || normalizeUsername(name);
    if (handle.length < 3) {
      return res
        .status(400)
        .json({ success: false, message: 'Username must be at least 3 characters (letters, numbers, _).' });
    }
    if (await User.findOne({ username: handle })) {
      return res.status(409).json({ success: false, message: 'That username is already taken.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Only allow 'student' or 'cr' on self-signup; 'admin' is provisioned internally.
    const safeRole = ['student', 'cr'].includes(role) ? role : 'student';

    const user = await User.create({
      userId: buildUserId(handle),
      name: name.trim(),
      username: handle,
      email: normalizedEmail,
      passwordHash,
      role: safeRole,
      // CRs carry more consensus weight out of the box.
      trustScore: safeRole === 'cr' ? 3.0 : 1.0,
    });

    const token = signToken(user);

    return res.status(201).json({
      success: true,
      message: 'Account created.',
      data: { token, user: user.toPublicJSON() },
    });
  } catch (error) {
    console.error('Register Error:', error);
    return res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
};

// POST /api/v1/auth/login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    // passwordHash is select:false, so explicitly request it here.
    const user = await User.findOne({ email: String(email).toLowerCase().trim() }).select(
      '+passwordHash'
    );

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const token = signToken(user);

    return res.status(200).json({
      success: true,
      message: 'Logged in.',
      data: { token, user: user.toPublicJSON() },
    });
  } catch (error) {
    console.error('Login Error:', error);
    return res.status(500).json({ success: false, message: 'Server error during login.' });
  }
};

// GET /api/v1/auth/me  (protected)
exports.me = async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.user.userId });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    return res.status(200).json({ success: true, data: { user: user.toPublicJSON() } });
  } catch (error) {
    console.error('Me Error:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching profile.' });
  }
};
