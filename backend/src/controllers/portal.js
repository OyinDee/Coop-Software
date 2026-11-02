const db = require('../db');
const bcrypt = require('bcryptjs');
const { getMonthlyReport } = require('./members');

async function getMyProfile(req, res) {
  try {
    const result = await db.query(
      `SELECT id, ledger_no, staff_no, full_name, email, phone, department, bank, account_number
       FROM members WHERE id = $1 AND is_active = TRUE`,
      [req.admin.memberId]
    );
    const member = result.rows[0];
    if (!member) return res.status(404).json({ error: 'Member not found' });
    res.json({ member });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getMyMonthlyReport(req, res) {
  const now = new Date();
  const month = req.query.month === undefined ? now.getMonth() + 1 : Number(req.query.month);
  const year = req.query.year === undefined ? now.getFullYear() : Number(req.query.year);

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: 'month must be between 1 and 12' });
  }
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    return res.status(400).json({ error: 'year must be a valid 4-digit year' });
  }

  try {
    const report = await getMonthlyReport(req.admin.memberId, month, year);
    if (!report) return res.status(404).json({ error: 'Member not found' });

    const { id, ledger_no, staff_no, full_name, email } = report.member;
    res.json({
      member: { id, ledger_no, staff_no, full_name, email },
      month: report.month,
      year: report.year,
      summary: report.summary,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function changeMyPassword(req, res) {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Current and new passwords are required' });
  }
  if (String(new_password).length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  try {
    const result = await db.query(
      `SELECT a.password_hash FROM member_accounts a
       WHERE a.member_id = $1`,
      [req.admin.memberId]
    );
    const account = result.rows[0];
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const valid = await bcrypt.compare(String(current_password), account.password_hash);
    if (!valid) return res.status(400).json({ error: 'Current password is incorrect' });

    const newHash = await bcrypt.hash(String(new_password), 10);
    await db.query(
      `UPDATE member_accounts SET password_hash = $1, updated_at = NOW()
       WHERE member_id = $2`,
      [newHash, req.admin.memberId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getMyProfile, getMyMonthlyReport, changeMyPassword };
