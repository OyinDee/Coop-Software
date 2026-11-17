const db = require('../db');
const bcrypt = require('bcryptjs');
const { getMonthlyReport } = require('./members');
const { buildStatementPdf } = require('../utils/statementPdf');

function resolvePeriod(req, res) {
  const now = new Date();
  const month = req.query.month === undefined ? now.getMonth() + 1 : Number(req.query.month);
  const year = req.query.year === undefined ? now.getFullYear() : Number(req.query.year);

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    res.status(400).json({ error: 'month must be between 1 and 12' });
    return null;
  }
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    res.status(400).json({ error: 'year must be a valid 4-digit year' });
    return null;
  }
  return { month, year };
}

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
  const period = resolvePeriod(req, res);
  if (!period) return;

  try {
    const report = await getMonthlyReport(req.admin.memberId, period.month, period.year);
    if (!report) return res.status(404).json({ error: 'Member not found' });

    const { id, ledger_no, staff_no, full_name, email } = report.member;
    res.json({
      member: { id, ledger_no, staff_no, full_name, email },
      month: report.month,
      year: report.year,
      hasData: report.hasData,
      summary: report.summary,
      commodities: report.commodities || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/portal/statement.pdf?month=&year=
// Every member can download their own statement as a PDF.
async function downloadMyStatementPdf(req, res) {
  const period = resolvePeriod(req, res);
  if (!period) return;

  try {
    const report = await getMonthlyReport(req.admin.memberId, period.month, period.year);
    if (!report) return res.status(404).json({ error: 'Member not found' });

    const pdf = buildStatementPdf({
      member: report.member,
      month: report.month,
      year: report.year,
      summary: report.summary,
      commodities: report.commodities || [],
    });

    const safeLedger = String(report.member.ledger_no || report.member.id).replace(/[^A-Za-z0-9_-]/g, '-');
    const filename = `${safeLedger}-statement-${report.year}-${String(report.month).padStart(2, '0')}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdf.length);
    res.send(pdf);
  } catch (err) {
    console.error('Statement PDF failed:', err);
    res.status(500).json({ error: 'Could not build your statement PDF' });
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

module.exports = { getMyProfile, getMyMonthlyReport, downloadMyStatementPdf, changeMyPassword };
