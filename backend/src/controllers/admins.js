const bcrypt = require('bcryptjs');
const db = require('../db');

function isSuperadmin(req) {
  return req.admin?.role === 'superadmin';
}

function denyIfNotSuperadmin(req, res) {
  if (!isSuperadmin(req)) {
    res.status(403).json({ error: 'Superadmin access required' });
    return true;
  }
  return false;
}

async function listAdmins(req, res) {
  if (denyIfNotSuperadmin(req, res)) return;

  try {
    const result = await db.query(`
      SELECT id, username, full_name, role, created_at
      FROM admins
      ORDER BY role DESC, username ASC
    `);
    res.json({ admins: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createAdmin(req, res) {
  if (denyIfNotSuperadmin(req, res)) return;

  const { username, password, full_name, role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const normalizedRole = role === 'superadmin' ? 'superadmin' : 'admin';

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.query(`
      INSERT INTO admins (username, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4)
      RETURNING id, username, full_name, role, created_at
    `, [username.trim(), passwordHash, full_name?.trim() || null, normalizedRole]);

    res.status(201).json({ admin: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: err.message });
  }
}

async function updateAdmin(req, res) {
  if (denyIfNotSuperadmin(req, res)) return;

  const adminId = parseInt(req.params.id, 10);
  if (!Number.isInteger(adminId)) {
    return res.status(400).json({ error: 'Invalid admin id' });
  }

  const { username, password, full_name, role } = req.body;
  const normalizedRole = role === 'superadmin' ? 'superadmin' : role === 'admin' ? 'admin' : null;

  try {
    const current = await db.query('SELECT id FROM admins WHERE id = $1', [adminId]);
    if (!current.rows[0]) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    const passwordHash = password ? await bcrypt.hash(password, 10) : null;
    const result = await db.query(`
      UPDATE admins SET
        username = COALESCE($1, username),
        password_hash = COALESCE($2, password_hash),
        full_name = COALESCE($3, full_name),
        role = COALESCE($4, role)
      WHERE id = $5
      RETURNING id, username, full_name, role, created_at
    `, [
      username?.trim() || null,
      passwordHash,
      full_name?.trim() || null,
      normalizedRole,
      adminId,
    ]);

    res.json({ admin: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: err.message });
  }
}

async function deleteAdmin(req, res) {
  if (denyIfNotSuperadmin(req, res)) return;

  const adminId = parseInt(req.params.id, 10);
  if (!Number.isInteger(adminId)) {
    return res.status(400).json({ error: 'Invalid admin id' });
  }

  try {
    const target = await db.query('SELECT id, username, role FROM admins WHERE id = $1', [adminId]);
    const admin = target.rows[0];
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found' });
    }
    if (admin.username === req.admin.username) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }
    if (admin.role === 'superadmin') {
      const superadminCount = await db.query(`SELECT COUNT(*)::int AS count FROM admins WHERE role = 'superadmin'`);
      if (superadminCount.rows[0].count <= 1) {
        return res.status(400).json({ error: 'At least one superadmin must remain' });
      }
    }

    await db.query('DELETE FROM admins WHERE id = $1', [adminId]);
    res.json({ message: 'Admin deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteAllMembers(req, res) {
  if (denyIfNotSuperadmin(req, res)) return;

  try {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const countResult = await client.query('SELECT COUNT(*)::int AS count FROM members');
      const deletedCount = countResult.rows[0].count;
      await client.query('TRUNCATE TABLE members RESTART IDENTITY CASCADE');
      await client.query('COMMIT');
      res.json({ message: 'All members deleted', deleted: deletedCount });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  listAdmins,
  createAdmin,
  updateAdmin,
  deleteAdmin,
  deleteAllMembers,
};