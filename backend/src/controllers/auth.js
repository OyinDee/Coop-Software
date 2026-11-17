const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { getMailer } = require('../utils/mailer');

const RESET_TOKEN_TTL_MINUTES = 60;
const RESET_COOLDOWN_SECONDS = 60;
const MIN_PASSWORD_LENGTH = 6;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function frontendUrl(req, path) {
  const configured = process.env.FRONTEND_URL || process.env.APP_URL;
  const origin = configured || req.get('origin') || `${req.protocol}://${req.get('host')}`;
  return `${origin.replace(/\/$/, '')}${path}`;
}

function resetEmailHtml({ name, link, minutes }) {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1b1b1b">
      <div style="background:#eef1e0;border-bottom:2px solid #8b5a11;padding:18px 22px">
        <div style="font-size:16px;font-weight:800;color:#8b5a11">SSANUCOOP</div>
        <div style="font-size:11px;color:#555">SSANU FUOYE Cooperative Society</div>
      </div>
      <div style="padding:22px">
        <p style="font-size:14px">Hello ${name || 'there'},</p>
        <p style="font-size:14px;line-height:1.5">
          We received a request to reset the password for your cooperative account.
          Click the button below to choose a new password. This link expires in ${minutes} minutes.
        </p>
        <p style="margin:26px 0">
          <a href="${link}" style="background:#8b5a11;color:#fff;text-decoration:none;padding:12px 22px;border-radius:4px;font-size:14px;font-weight:700">Reset my password</a>
        </p>
        <p style="font-size:12px;color:#666;line-height:1.5">
          If the button does not work, copy this address into your browser:<br />
          <span style="word-break:break-all">${link}</span>
        </p>
        <p style="font-size:12px;color:#666;line-height:1.5">
          If you did not ask for this, you can ignore this email — your password will not change.
          You can also ask the cooperative office to reset it for you.
        </p>
      </div>
      <div style="padding:14px 22px;border-top:1px solid #ddd;font-size:11px;color:#888">
        &copy; SSANUCOOP 2026
      </div>
    </div>
  `;
}

async function findAccount(identifier) {
  const value = String(identifier || '').trim();
  if (!value) return null;

  const adminRes = await db.query(
    `SELECT id, username, full_name, email FROM admins
     WHERE LOWER(BTRIM(username)) = LOWER(BTRIM($1))
        OR (email IS NOT NULL AND LOWER(BTRIM(email)) = LOWER(BTRIM($1)))
     LIMIT 1`,
    [value]
  );
  if (adminRes.rows[0]) {
    const admin = adminRes.rows[0];
    return {
      type: 'admin',
      id: admin.id,
      name: admin.full_name || admin.username,
      email: admin.email || (admin.username.includes('@') ? admin.username : null),
      label: admin.username,
    };
  }

  const memberRes = await db.query(
    `SELECT id, ledger_no, staff_no, full_name, email FROM members
     WHERE is_active = TRUE
       AND (
         LOWER(BTRIM(ledger_no)) = LOWER(BTRIM($1))
         OR LOWER(BTRIM(staff_no)) = LOWER(BTRIM($1))
         OR LOWER(BTRIM(email)) = LOWER(BTRIM($1))
       )
     LIMIT 1`,
    [value]
  );
  const member = memberRes.rows[0];
  if (!member) return null;
  return {
    type: 'member',
    id: member.id,
    name: member.full_name,
    email: (member.email || '').trim() || null,
    label: member.ledger_no,
  };
}

// POST /api/auth/forgot-password
// Always answers with the same message so the endpoint cannot be used to
// discover which ledger numbers or usernames exist.
async function requestPasswordReset(req, res) {
  const identifier = req.body?.identifier;
  try {
    const account = await findAccount(identifier);

    if (account && account.email) {
      // Throttle: at most one email per account per minute.
      const recent = await db.query(
        `SELECT id FROM password_reset_tokens
         WHERE user_type = $1 AND user_id = $2 AND created_at > NOW() - ($3 || ' seconds')::interval
         LIMIT 1`,
        [account.type, account.id, String(RESET_COOLDOWN_SECONDS)]
      );

      if (!recent.rows[0]) {
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = hashToken(token);

        await db.query(
          `UPDATE password_reset_tokens SET used_at = NOW()
           WHERE user_type = $1 AND user_id = $2 AND used_at IS NULL`,
          [account.type, account.id]
        );
        await db.query(
          `INSERT INTO password_reset_tokens (user_type, user_id, token_hash, expires_at)
           VALUES ($1, $2, $3, NOW() + ($4 || ' minutes')::interval)`,
          [account.type, account.id, tokenHash, String(RESET_TOKEN_TTL_MINUTES)]
        );

        const mailer = await getMailer();
        if (mailer.error) {
          console.error('Password reset email not sent:', mailer.error);
        } else {
          const link = frontendUrl(req, `/reset-password?token=${token}`);
          try {
            await mailer.transporter.sendMail({
              from: mailer.from,
              to: account.email,
              subject: 'Reset your SSANUCOOP password',
              text: [
                `Hello ${account.name || 'there'},`,
                '',
                'We received a request to reset your cooperative account password.',
                `Open this link within ${RESET_TOKEN_TTL_MINUTES} minutes to choose a new one:`,
                link,
                '',
                'If you did not ask for this, ignore this email.',
              ].join('\n'),
              html: resetEmailHtml({
                name: account.name,
                link,
                minutes: RESET_TOKEN_TTL_MINUTES,
              }),
            });
          } catch (err) {
            console.error('Password reset email failed:', err.message);
          }
        }
      }
    }

    res.json({
      ok: true,
      message: 'If that account exists and has an email address on file, a reset link is on its way. Ask the cooperative office for a temporary password if you do not receive it.',
    });
  } catch (err) {
    console.error('Password reset request failed:', err);
    res.status(500).json({ error: 'Could not process the request. Please try again.' });
  }
}

// POST /api/auth/reset-password { token, password }
async function resetPassword(req, res) {
  const token = String(req.body?.token || '').trim();
  const password = String(req.body?.password || '');
  if (!token) return res.status(400).json({ error: 'Reset link is missing its token' });
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  try {
    const result = await db.query(
      `SELECT id, user_type, user_id FROM password_reset_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
       LIMIT 1`,
      [hashToken(token)]
    );
    const record = result.rows[0];
    if (!record) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    if (record.user_type === 'admin') {
      await db.query('UPDATE admins SET password_hash = $1 WHERE id = $2', [passwordHash, record.user_id]);
    } else {
      const updated = await db.query(
        'UPDATE member_accounts SET password_hash = $1, updated_at = NOW() WHERE member_id = $2',
        [passwordHash, record.user_id]
      );
      if (updated.rowCount === 0) {
        await db.query(
          'INSERT INTO member_accounts (member_id, password_hash) VALUES ($1, $2)',
          [record.user_id, passwordHash]
        );
      }
    }

    await db.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [record.id]);
    await db.query(
      `UPDATE password_reset_tokens SET used_at = NOW()
       WHERE user_type = $1 AND user_id = $2 AND used_at IS NULL`,
      [record.user_type, record.user_id]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Password reset failed:', err);
    res.status(500).json({ error: 'Could not reset the password. Please try again.' });
  }
}

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

module.exports = { login, getMe, requestPasswordReset, resetPassword };
