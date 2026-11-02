const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

async function login(req, res) {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  try {
    const result = await db.query('SELECT id, username, password_hash, full_name, role FROM admins WHERE username = $1', [username]);
    const admin = result.rows[0];

    if (admin) {
      const valid = await bcrypt.compare(password, admin.password_hash);
      if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

      const token = jwt.sign(
        { id: admin.id, username: admin.username, fullName: admin.full_name, role: admin.role || 'admin' },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
      );

      return res.json({ token, admin: { id: admin.id, username: admin.username, fullName: admin.full_name, role: admin.role || 'admin' } });
    }

    // Members sign in with their ledger number, staff number or email.
    const memberResult = await db.query(
      `SELECT m.id, m.ledger_no, m.staff_no, m.full_name, m.email, a.password_hash
       FROM members m
       JOIN member_accounts a ON a.member_id = m.id
       WHERE m.is_active = TRUE
         AND (
           LOWER(BTRIM(m.ledger_no)) = LOWER(BTRIM($1))
           OR LOWER(BTRIM(m.staff_no)) = LOWER(BTRIM($1))
           OR LOWER(BTRIM(m.email)) = LOWER(BTRIM($1))
         )
       LIMIT 1`,
      [username]
    );
    const member = memberResult.rows[0];
    if (!member) return res.status(401).json({ error: 'Invalid credentials' });

    const memberValid = await bcrypt.compare(password, member.password_hash);
    if (!memberValid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: member.id, memberId: member.id, username: member.ledger_no, fullName: member.full_name, role: 'member' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    return res.json({
      token,
      admin: {
        id: member.id,
        memberId: member.id,
        username: member.ledger_no,
        fullName: member.full_name,
        role: 'member',
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getMe(req, res) {
  res.json({ admin: req.admin });
}

module.exports = { login, getMe };
