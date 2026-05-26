const db = require('../db');
const nodemailer = require('nodemailer');
// loans table needs optional description column – add it if it doesn't exist
// (run once on startup, harmless if already present)
db.query(`ALTER TABLE loans ADD COLUMN IF NOT EXISTS description TEXT`).catch(() => {});
const XLSX = require('xlsx');           // npm install xlsx  (already in most Node stacks)
const { parse } = require('csv-parse/sync');


const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function resolveMonthYear(monthRaw, yearRaw) {
  const now = new Date();
  const month = Number.isInteger(Number(monthRaw)) ? Number(monthRaw) : now.getMonth() + 1;
  const year = Number.isInteger(Number(yearRaw)) ? Number(yearRaw) : now.getFullYear();
  if (month < 1 || month > 12) {
    return { error: 'month must be between 1 and 12' };
  }
  if (year < 2000 || year > 9999) {
    return { error: 'year must be a valid 4-digit year' };
  }
  return { month, year };
}

function getPreviousMonthYear(month, year) {
  return month === 1 ? { month: 12, year: year - 1 } : { month: month - 1, year };
}

function toNumber(value) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatAmount(value) {
  return new Intl.NumberFormat('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function loadMonthlyValues(memberId, month, year) {
  const result = await db.query(
    `SELECT column_key, amount FROM monthly_trans WHERE member_id=$1 AND month=$2 AND year=$3`,
    [memberId, month, year]
  );

  const values = {};
  for (const row of result.rows) {
    values[row.column_key] = toNumber(row.amount);
  }

  return values;
}

function buildMonthlyReportDocument({ member, month, year, current, previous }) {
  const subjectPeriod = `${MONTH_LABELS[month - 1]} ${year}`;

  const savingsValue = toNumber(current.savings_add) + toNumber(current.savings_add_bank);
  const loanPrincipalValue = toNumber(current.loan_repayment) + toNumber(current.loan_repayment_bank);
  const loanInterestValue = toNumber(current.loan_int_paid) + toNumber(current.loan_int_paid_bank);
  const commodityValue = toNumber(current.comm_repayment) + toNumber(current.comm_repayment_bank);
  const totalAmountPaidToBank = toNumber(current.savings_add_bank) + toNumber(current.loan_repayment_bank) + toNumber(current.loan_int_paid_bank) + toNumber(current.comm_repayment_bank);
  const openingLoanInterest = toNumber(previous?.loan_int_cf || 0);
  const paidLoanInterest = toNumber(current.loan_int_paid) + toNumber(current.loan_int_paid_bank);
  const loanInterestCf = Math.max(0, openingLoanInterest + toNumber(current.loan_int_charged) - paidLoanInterest);

  const row = (label, value) => `
    <tr>
      <td class="report-label">${escapeHtml(label)}</td>
      <td class="report-value">${value}</td>
    </tr>
  `;

  const section = (title, rows, className) => `
    <table class="section ${className}">
      <tbody>
        <tr><th colspan="2" class="section-title">${escapeHtml(title)}</th></tr>
        ${rows}
      </tbody>
    </table>
  `;

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${escapeHtml(subjectPeriod)} Transaction Report</title>
      <style>
        body {
          margin: 0;
          padding: 24px;
          background: #efefef;
          font-family: Arial, Helvetica, sans-serif;
          color: #111;
        }
        .page {
          width: 760px;
          max-width: 100%;
          margin: 0 auto;
          background: #fff;
          border: 1px solid #222;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
        }
        .header {
          display: grid;
          grid-template-columns: 60px 1fr 60px;
          align-items: center;
          border-bottom: 1px solid #222;
          background: #eef1e0;
        }
        .seal {
          width: 54px;
          height: 54px;
          margin: 6px;
          border-radius: 50%;
          border: 2px solid #7a5a1c;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 700;
          color: #7a5a1c;
          background: #fff;
          line-height: 1.05;
          text-align: center;
        }
        .header-copy {
          text-align: center;
          padding: 8px 6px 6px;
        }
        .org {
          font-size: 14px;
          font-weight: 700;
          color: #8b5a11;
          line-height: 1.2;
        }
        .suborg {
          font-size: 12px;
          font-weight: 700;
          color: #8b5a11;
          margin-top: 2px;
        }
        .state {
          font-size: 12px;
          font-weight: 700;
          margin-top: 2px;
        }
        .title {
          margin-top: 4px;
          padding: 4px 0;
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.2px;
          border-top: 1px solid #222;
          border-bottom: 1px solid #222;
        }
        table {
          width: 100%;
          border-collapse: collapse;
        }
        .identity td {
          border: 1px solid #222;
          padding: 4px 8px;
          font-size: 13px;
        }
        .identity .label {
          width: 18%;
          background: #f6d7bd;
          font-weight: 700;
          white-space: nowrap;
        }
        .identity .value {
          width: 32%;
          background: #fff;
        }
        .identity .label.wide {
          width: 20%;
        }
        .section {
          border-left: 1px solid #222;
          border-right: 1px solid #222;
          border-bottom: 1px solid #222;
        }
        .section-title {
          border-top: 1px solid #222;
          border-bottom: 1px solid #222;
          background: #fff;
          text-align: center;
          font-size: 16px;
          font-weight: 800;
          padding: 2px 0;
        }
        .section td {
          border: 1px solid #222;
          font-size: 12px;
          line-height: 1.1;
          padding: 3px 6px;
        }
        .report-label {
          width: 70%;
          font-size: 12px;
        }
        .report-value {
          width: 30%;
          text-align: right;
          font-weight: 700;
        }
        .green .report-label, .green .section-title { background: #dfead3; }
        .green .report-value { background: #eaf4db; }
        .peach .report-label, .peach .section-title { background: #f6e0d1; }
        .peach .report-value { background: #f9eadf; }
        .yellow .report-label, .yellow .section-title { background: #f7ebbe; }
        .yellow .report-value { background: #fcf1cd; }
        .blue .report-label, .blue .section-title { background: #d4dced; }
        .blue .report-value { background: #dde6f7; }
        .summary .report-label, .summary .section-title { background: #ececec; }
        .summary .report-value { background: #f5f5f5; }
        .comments td {
          border: 1px solid #222;
          padding: 5px 6px;
          font-size: 12px;
          min-height: 26px;
        }
        .comments .label {
          width: 18%;
          background: #fff;
          font-weight: 700;
        }
        .footer {
          text-align: center;
          font-size: 12px;
          font-style: italic;
          font-weight: 700;
          padding: 8px 0 10px;
        }
      </style>
    </head>
    <body>
      <div class="page">
        <div class="header">
          <div class="seal">SSANU</div>
          <div class="header-copy">
            <div class="org">SSANU (FUOYE) COOPERATIVE MULTIPURPOSE SOCIETY LTD</div>
            <div class="suborg">SENIOR STAFF ASSOCIATION OF NIGERIA UNIVERSITIES</div>
            <div class="state">Federal University Oye-Ekiti, Ekiti State</div>
            <div class="title">TRANSACTION FOR THE MONTH OF ${escapeHtml(subjectPeriod)}</div>
          </div>
          <div class="seal">SSANU</div>
        </div>

        <table class="identity">
          <tr>
            <td class="label">NAME:</td>
            <td class="value" colspan="3">${escapeHtml(member.full_name || '')}</td>
          </tr>
          <tr>
            <td class="label">E-MAIL:</td>
            <td class="value" colspan="3">${escapeHtml(member.email || '')}</td>
          </tr>
          <tr>
            <td class="label">STAFF No</td>
            <td class="value">${escapeHtml(member.staff_no || '')}</td>
            <td class="label wide">GSM No:</td>
            <td class="value">${escapeHtml(member.phone || '')}</td>
          </tr>
        </table>

        ${section('SAVINGS:',
          row('SAVINGS B/F', `&#8358;${formatAmount(previous?.savings_cf || 0)}`) +
          row('ADD: Savings this month', `&#8358;${formatAmount(current.savings_add)}`) +
          row('ADD: Savings this month (Bank)', `&#8358;${formatAmount(current.savings_add_bank)}`) +
          row('LESS: Withdrawal', `&#8358;${formatAmount(current.savings_withdrawal)}`) +
          row('Net Saving C/F', `&#8358;${formatAmount(current.savings_cf)}`),
          'green')}

        ${section('LOAN SERVICES:',
          row('Loan Principal Balance B/F', `&#8358;${formatAmount(previous?.loan_ledger_bal || 0)}`) +
          row('ADD: Loan Granted this Month', `&#8358;${formatAmount(current.loan_granted)}`) +
          row('LESS: Loan Principal Repayment', `&#8358;${formatAmount(current.loan_repayment)}`) +
          row('LESS: Loan Principal Repayment (Bank)', `&#8358;${formatAmount(current.loan_repayment_bank)}`) +
          row('Loan Ledger Balance C/F', `&#8358;${formatAmount(current.loan_ledger_bal)}`),
          'peach')}

        ${section('LOAN INTEREST:',
          row('Loan Interest Balance B/F', `&#8358;${formatAmount(openingLoanInterest)}`) +
          row('ADD: Ln Interest charged (this month)', `&#8358;${formatAmount(current.loan_int_charged)}`) +
          row('LESS: Loan Interest paid', `&#8358;${formatAmount(current.loan_int_paid)}`) +
          row('LESS: Loan Interest Paid (Bank)', `&#8358;${formatAmount(current.loan_int_paid_bank)}`) +
          row('Loan Interest Balance C/F', `&#8358;${formatAmount(loanInterestCf)}`),
          'yellow')}

        ${section('COMMODITY/GADGET SALES SERVICES:',
          row('Commodity Sales Balance B/F', `&#8358;${formatAmount(previous?.comm_bal_cf || 0)}`) +
          row('ADD: Commodity Sales this Month', `&#8358;${formatAmount(current.comm_add)}`) +
          row('LESS: Commodity Sales Repayment', `&#8358;${formatAmount(current.comm_repayment)}`) +
          row('LESS: Commodity Sales Repayment (Bank)', `&#8358;${formatAmount(current.comm_repayment_bank)}`) +
          row('Commodity Sales Balance C/F', `&#8358;${formatAmount(current.comm_bal_cf)}`),
          'blue')}

        ${section('SUMMARY:',
          row('SAVINGS', `&#8358;${formatAmount(savingsValue)}`) +
          row('LOAN PRINCIPAL REPAYMENT', `&#8358;${formatAmount(loanPrincipalValue)}`) +
          row('LOAN INTEREST', `&#8358;${formatAmount(loanInterestValue)}`) +
          row('COMMODITY/GADGET', `&#8358;${formatAmount(commodityValue)}`) +
          row('LOAN/MEMBERSHIP FORM', `&#8358;${formatAmount(current.form)}`) +
          row('OTHER CHARGES', `&#8358;${formatAmount(current.other_charges)}`) +
          row('TOTAL DEDUCTION THIS MONTH', `&#8358;${formatAmount(current.total_deduction)}`) +
          row('TOTAL AMOUNT PAID TO BANK', `&#8358;${formatAmount(totalAmountPaidToBank)}`),
          'summary')}

        <table class="comments">
          <tr>
            <td class="label">COMMENTS:</td>
            <td>&nbsp;</td>
          </tr>
          <tr>
            <td style="width:55%; height:24px;"></td>
            <td></td>
          </tr>
        </table>

        <div class="footer">&copy; SSANUCOOP 2026</div>
      </div>
    </body>
    </html>
  `;
}

function getMailer() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    return { error: 'Missing SMTP configuration. Set SMTP_USER and SMTP_PASS.' };
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });

  return { transporter, from: user };
}

async function getMonthlyReport(memberId, month, year) {
  const memberRes = await db.query(
    `SELECT id, full_name, ledger_no, staff_no, email, phone FROM members WHERE id=$1`,
    [memberId]
  );
  const member = memberRes.rows[0];
  if (!member) {
    return null;
  }

  const previous = getPreviousMonthYear(month, year);
  const [currentValues, previousValues] = await Promise.all([
    loadMonthlyValues(memberId, month, year),
    loadMonthlyValues(memberId, previous.month, previous.year),
  ]);

  const report = {
    savings_withdrawal: currentValues.savings_withdrawal || 0,
    savings_add: currentValues.savings_add || 0,
    savings_add_bank: currentValues.savings_add_bank || 0,
    loan_granted: currentValues.loan_granted || 0,
    loan_int_charged: currentValues.loan_int_charged || 0,
    loan_repayment: currentValues.loan_repayment || 0,
    loan_repayment_bank: currentValues.loan_repayment_bank || 0,
    loan_int_paid: currentValues.loan_int_paid || 0,
    loan_int_paid_bank: currentValues.loan_int_paid_bank || 0,
    comm_add: currentValues.comm_add || 0,
    comm_repayment: currentValues.comm_repayment || 0,
    comm_repayment_bank: currentValues.comm_repayment_bank || 0,
    form: currentValues.form || 0,
    other_charges: currentValues.other_charges || 0,
    total_deduction: currentValues.total_deduction || 0,
    savings_cf: currentValues.savings_cf || 0,
    loan_ledger_bal: currentValues.loan_ledger_bal || 0,
    loan_int_cf: Math.max(0, toNumber(previousValues.loan_int_cf || 0) + toNumber(currentValues.loan_int_charged || 0) - toNumber(currentValues.loan_int_paid || 0) - toNumber(currentValues.loan_int_paid_bank || 0)),
    comm_bal_cf: currentValues.comm_bal_cf || 0,
  };

  const subjectPeriod = `${MONTH_LABELS[month - 1]} ${year}`;
  const subject = `Transaction for the Month of ${subjectPeriod}`;
  const html = buildMonthlyReportDocument({
    member,
    month,
    year,
    current: report,
    previous: previousValues,
  });

  const text = [
    `Transaction for the Month of ${subjectPeriod}`,
    `Member: ${member.full_name || ''}`,
    `Ledger: ${member.ledger_no || ''}`,
    `Savings Balance C/F: ${formatAmount(report.savings_cf)}`,
    `Loan Balance C/F: ${formatAmount(report.loan_ledger_bal)}`,
    `Interest Balance C/F: ${formatAmount(report.loan_int_cf)}`,
    `Commodity Balance C/F: ${formatAmount(report.comm_bal_cf)}`,
    `Total Deduction: ${formatAmount(report.total_deduction)}`,
  ].join('\n');

  return {
    member,
    subject,
    text,
    html,
    attachmentName: `${member.ledger_no || member.id}-monthly-report-${year}-${String(month).padStart(2, '0')}.html`,
    attachmentContent: html,
  };
}

async function sendSingleMemberMonthlyReport(memberId, month, year, mailer) {
  const reportPayload = await getMonthlyReport(memberId, month, year);
  if (!reportPayload) {
    return { status: 'failed', reason: 'member not found' };
  }

  const email = (reportPayload.member.email || '').trim();
  if (!email) {
    return { status: 'skipped', reason: 'member has no email' };
  }

  await mailer.transporter.sendMail({
    from: mailer.from,
    to: email,
    subject: reportPayload.subject,
    text: reportPayload.text,
    html: reportPayload.html,
    attachments: [
      {
        filename: reportPayload.attachmentName,
        content: reportPayload.attachmentContent,
        contentType: 'text/html; charset=utf-8',
      },
    ],
  });

  return {
    status: 'sent',
    member_id: reportPayload.member.id,
    ledger_no: reportPayload.member.ledger_no,
    email,
  };
}

async function getMembers(req, res) {
  const { search, page = 1, limit = 1000 } = req.query;
  const offset = (page - 1) * limit;
  
  try {
    let query, params;
    
    if (search) {
      // Use full-text search for better performance
      query = `
        SELECT m.*,
          COALESCE(s.total_savings, 0) AS total_savings,
          COALESCE(l.loan_balance, 0) AS loan_balance,
          COALESCE(l.interest_due, 0) AS interest_due,
          l.active_loans
        FROM members m
        LEFT JOIN (
          SELECT member_id, SUM(amount) AS total_savings
          FROM savings GROUP BY member_id
        ) s ON s.member_id = m.id
        LEFT JOIN (
          SELECT 
            member_id, 
            SUM(remaining_balance) AS loan_balance,
            SUM(total_interest - interest_paid) AS interest_due,
            COUNT(*) AS active_loans
          FROM loans 
          WHERE status = 'active' 
          GROUP BY member_id
        ) l ON l.member_id = m.id
        WHERE m.is_active = TRUE 
          AND (
            to_tsvector('english', m.full_name) @@ plainto_tsquery($1)
            OR m.ledger_no ILIKE $1
            OR m.staff_no ILIKE $1
            OR m.department ILIKE $1
          )
        ORDER BY m.ledger_no
        LIMIT $2 OFFSET $3
      `;
      params = [`%${search}%`, limit, offset];
    } else {
      // Optimized query for paginated results without search
      query = `
        SELECT m.*,
          COALESCE(s.total_savings, 0) AS total_savings,
          COALESCE(l.loan_balance, 0) AS loan_balance,
          COALESCE(l.interest_due, 0) AS interest_due,
          l.active_loans
        FROM members m
        LEFT JOIN (
          SELECT member_id, SUM(amount) AS total_savings
          FROM savings GROUP BY member_id
        ) s ON s.member_id = m.id
        LEFT JOIN (
          SELECT 
            member_id, 
            SUM(remaining_balance) AS loan_balance,
            SUM(total_interest - interest_paid) AS interest_due,
            COUNT(*) AS active_loans
          FROM loans 
          WHERE status = 'active' 
          GROUP BY member_id
        ) l ON l.member_id = m.id
        WHERE m.is_active = TRUE
        ORDER BY m.ledger_no
        LIMIT $1 OFFSET $2
      `;
      params = [limit, offset];
    }

    // Get total count efficiently for pagination
    const countQuery = search 
      ? `SELECT COUNT(*) FROM members WHERE is_active = TRUE AND (
           to_tsvector('english', full_name) @@ plainto_tsquery($1)
           OR ledger_no ILIKE $1
           OR staff_no ILIKE $1
           OR department ILIKE $1
         )`
      : `SELECT COUNT(*) FROM members WHERE is_active = TRUE`;
    
    const [result, countResult] = await Promise.all([
      db.query(query, params),
      db.query(countQuery, search ? [`%${search}%`] : [])
    ]);

    res.json({ 
      members: result.rows, 
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      totalPages: Math.ceil(countResult.rows[0].count / limit)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getMember(req, res) {
  const { id } = req.params;
  try {
    const memberResult = await db.query(`
      SELECT
        m.*,
        COALESCE(
            (SELECT mt.amount FROM monthly_trans mt
             WHERE mt.member_id = m.id AND mt.column_key = 'savings_cf'
             ORDER BY mt.year DESC, mt.month DESC LIMIT 1),
            (SELECT SUM(s.amount) FROM savings s WHERE s.member_id = m.id),
            0
          ) AS total_savings,
        COALESCE((SELECT SUM(shares.amount) FROM shares WHERE shares.member_id = m.id), 0) AS total_shares,
        COALESCE((SELECT SUM(c.amount) FROM commodity c WHERE c.member_id = m.id), 0) AS total_commodity,
        COALESCE((SELECT SUM(l.remaining_balance) FROM loans l WHERE l.member_id = m.id AND l.status = 'active'), 0) AS loan_balance,
        COALESCE((SELECT SUM(l.total_interest - l.interest_paid) FROM loans l WHERE l.member_id = m.id AND l.status = 'active'), 0) AS interest_due,
        (SELECT COUNT(*) FROM loans l WHERE l.member_id = m.id AND l.status = 'active') AS active_loans
      FROM members m
      WHERE m.id = $1
    `, [id]);

    if (!memberResult.rows[0]) return res.status(404).json({ error: 'Member not found' });

    const loansResult = await db.query(`
      SELECT * FROM loans WHERE member_id = $1 ORDER BY created_at ASC
    `, [id]);

    const savingsResult = await db.query(`
      SELECT * FROM savings WHERE member_id = $1 ORDER BY year DESC, month DESC
    `, [id]);

    const sharesResult = await db.query(`
      SELECT * FROM shares WHERE member_id = $1 ORDER BY year DESC, month DESC
    `, [id]);

    const commodityResult = await db.query(`
      SELECT * FROM commodity WHERE member_id = $1 ORDER BY year DESC, month DESC
    `, [id]);

    res.json({
      member: memberResult.rows[0],
      loans: loansResult.rows,
      savings: savingsResult.rows,
      shares: sharesResult.rows,
      commodity: commodityResult.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createMember(req, res) {
  const {
    ledger_no, staff_no, gifmis_no, full_name, gender, marital_status,
    phone, email, date_of_admission, bank, account_number, department,
    next_of_kin, next_of_kin_relation
  } = req.body;

  if (!ledger_no || !full_name) {
    return res.status(400).json({ error: 'ledger_no and full_name are required' });
  }

  try {
    const result = await db.query(`
      INSERT INTO members (ledger_no, staff_no, gifmis_no, full_name, gender, marital_status, phone, email, date_of_admission, bank, account_number, department, next_of_kin, next_of_kin_relation)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *
    `, [ledger_no, staff_no, gifmis_no, full_name, gender, marital_status, phone, email, date_of_admission || null, bank, account_number, department, next_of_kin, next_of_kin_relation]);
    res.status(201).json({ member: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ledger number already exists' });
    res.status(500).json({ error: err.message });
  }
}

async function updateMember(req, res) {
  const { id } = req.params;
  const {
    ledger_no, staff_no, gifmis_no, full_name, gender, marital_status,
    phone, email, date_of_admission, bank, account_number, department,
    next_of_kin, next_of_kin_relation
  } = req.body;

  try {
    const result = await db.query(`
      UPDATE members SET
        ledger_no=$1, staff_no=$2, gifmis_no=$3, full_name=$4, gender=$5,
        marital_status=$6, phone=$7, email=$8, date_of_admission=$9, bank=$10,
        account_number=$11, department=$12, next_of_kin=$13, next_of_kin_relation=$14,
        updated_at=NOW()
      WHERE id=$15 RETURNING *
    `, [ledger_no, staff_no, gifmis_no, full_name, gender, marital_status, phone, email, date_of_admission || null, bank, account_number, department, next_of_kin, next_of_kin_relation, id]);

    if (!result.rows[0]) return res.status(404).json({ error: 'Member not found' });
    res.json({ member: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteMember(req, res) {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM members WHERE id = $1', [id]);
    res.json({ message: 'Member deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function importCSV(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  function parseDate(raw) {
    if (!raw) return null;
    const s = raw.trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const mmm_yyyy = s.match(/^([A-Za-z]{3})[\/\-](\d{4})$/);
    if (mmm_yyyy) {
      const d = new Date(`1 ${mmm_yyyy[1]} ${mmm_yyyy[2]}`);
      if (!isNaN(d)) return d.toISOString().split('T')[0];
    }
    const d = new Date(s);
    if (!isNaN(d)) return d.toISOString().split('T')[0];
    return null;
  }

  try {
    let records = [];

    const isXlsx =
      req.file.originalname?.toLowerCase().endsWith('.xlsx') ||
      req.file.originalname?.toLowerCase().endsWith('.xls') ||
      req.file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      req.file.mimetype === 'application/vnd.ms-excel';

    if (isXlsx) {
      const XLSX = require('xlsx');
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (rawRows.length < 2) return res.status(400).json({ error: 'Excel file appears to be empty' });
      const headers = rawRows[0].map(h => String(h).trim());
      for (let i = 1; i < rawRows.length; i++) {
        const obj = {};
        headers.forEach((h, idx) => { obj[h] = String(rawRows[i][idx] ?? '').trim(); });
        records.push(obj);
      }
    } else {
      const csvText = req.file.buffer.toString('utf-8').replace(/^\uFEFF/, '');
      records = parse(csvText, {
        columns: true, skip_empty_lines: true, trim: true, relax_column_count: true,
      });
    }

    let imported = 0, skipped = 0;
    const errors = [];

    for (const row of records) {
      const r = {};
      for (const k of Object.keys(row)) r[k.trim()] = row[k];

      const ledger_no = r['LEDGER No'] || r['Ledger No'] || r['ledger_no'] || r['L/No'] || r['L/NO'];
      const full_name = r['Name'] || r['FULL NAME'] || r['full_name'] || r['NAME'];
      if (!ledger_no || !full_name) { skipped++; continue; }

      const date_of_admission = parseDate(r['Date of Admission'] || r['DATE OF ADMISSION']);

      try {
        await db.query(`
          INSERT INTO members
            (ledger_no, staff_no, gifmis_no, full_name, gender, marital_status,
             phone, email, date_of_admission, bank, account_number, department,
             next_of_kin, next_of_kin_relation)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
          ON CONFLICT (ledger_no) DO NOTHING
        `, [
          ledger_no.trim(),
          r['Staff No']  || r['STAFF NO']  || r['STAFF No'] || null,
          r['GIFMIS No'] || r['GIFMIS NO'] || r['IPPIS No'] || r['IPPIS NO'] || null,
          full_name.trim(),
          r['Gender']   || r['GENDER']    || null,
          r['MARITAL STATUS'] || r['Marital Status'] || null,
          r['Phone No.'] || r['PHONE'] || r['Phone'] || r['GSM No'] || r['GSM NO'] || null,
          r['FUOYE E-mail Address'] || r['Email'] || r['EMAIL'] || r['e-mail'] || r['E-MAIL'] || null,
          date_of_admission,
          r['BANK'] || r['Bank'] || null,
          r['ACCOUNT NUMBER'] || r['Account Number'] || null,
          r['DEPARTMENT'] || r['Department'] || null,
          r['Next of Kin'] || r['NEXT OF KIN'] || null,
          r['RELATION                (with next of kin)'] ||
            r['RELATION (with next of kin)'] || r['Relation'] || null,
        ]);
        imported++;
      } catch (e) {
        errors.push(`${ledger_no}: ${e.message}`);
        skipped++;
      }
    }

    res.json({ ok: true, message: `${imported} members imported, ${skipped} skipped`, imported, skipped, errors });
  } catch (err) {
    console.error('Members import error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function importBalances(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
 
  try {
    let records = [];
 
    const isXlsx =
      req.file.originalname?.toLowerCase().endsWith('.xlsx') ||
      req.file.originalname?.toLowerCase().endsWith('.xls') ||
      req.file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      req.file.mimetype === 'application/vnd.ms-excel';
 
    if (isXlsx) {
      // ── Parse Excel ────────────────────────────────────────────────────────
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      // header: 1 gives array-of-arrays; defval fills empty cells with ''
      const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
 
      if (rawRows.length < 2) {
        return res.status(400).json({ error: 'Excel file appears to be empty' });
      }
 
      // First row = headers
      const headers = rawRows[0].map(h => String(h).trim());
      for (let i = 1; i < rawRows.length; i++) {
        const row = rawRows[i];
        const obj = {};
        headers.forEach((h, idx) => { obj[h] = String(row[idx] ?? '').trim(); });
        records.push(obj);
      }
    } else {
      // ── Parse CSV ──────────────────────────────────────────────────────────
      const csvText = req.file.buffer.toString('utf-8').replace(/^\uFEFF/, '');
      records = parse(csvText, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      });
    }
 
    let imported = 0, skipped = 0;
    const errors = [];
 
    const parseAmt = (v) => {
      const n = parseFloat(String(v || '').replace(/,/g, '').trim());
      return isNaN(n) ? 0 : n;
    };
 
    // ── Flexible column getter ─────────────────────────────────────────────
    // Tries multiple possible header spellings (UPPERCASE) for each field.
    // The xlsx uses abbreviated names; the simple CSV format uses full names.
    const col = (r, ...keys) => {
      const upper = {};
      for (const k of Object.keys(r)) upper[k.trim().toUpperCase()] = r[k];
      for (const k of keys) {
        const val = upper[k.trim().toUpperCase()];
        if (val !== undefined && val !== '') return val;
      }
      return '';
    };
 
    for (const row of records) {
      // Normalise all keys to uppercase for safe lookup
      const r = {};
      for (const k of Object.keys(row)) r[k.trim().toUpperCase()] = String(row[k] || '').trim();
 
      // ── Skip header/summary rows ───────────────────────────────────────
      // S/N must be a positive integer; rows without it are totals / blanks
      const sn = (r['S/N'] || r['S/N.'] || '').replace(/\s/g, '');
      if (!/^\d+$/.test(sn)) { skipped++; continue; }
 
      // ── Identifiers ────────────────────────────────────────────────────
      const ledger_no = (
        r['L/NO'] || r['L/NO.'] || r['LEDGER NO'] || r['LEDGER NO.'] ||
        r['LEDGER_NO'] || r['LEDGER'] || ''
      ).trim();
 
      const staff_no = (
        r['STAFF NO'] || r['STAFF NO.'] || r['STAFF_NO'] || r['STAFF'] || ''
      ).trim();
 
      if (!ledger_no && !staff_no) {
        errors.push(`Row ${sn}: no ledger or staff number found`);
        skipped++; continue;
      }
 
      // ── Look up member ─────────────────────────────────────────────────
      let memberRes;
      if (ledger_no) {
        memberRes = await db.query(
          'SELECT id FROM members WHERE UPPER(TRIM(ledger_no))=$1',
          [ledger_no.toUpperCase()]
        );
      }
      if ((!memberRes || !memberRes.rows.length) && staff_no) {
        memberRes = await db.query(
          'SELECT id FROM members WHERE UPPER(TRIM(staff_no))=$1',
          [staff_no.toUpperCase()]
        );
      }
      if (!memberRes || !memberRes.rows.length) {
        errors.push(`${ledger_no || staff_no}: member not found — import members first via Import CSV`);
        skipped++; continue;
      }
      const memberId = memberRes.rows[0].id;
 
      // ── Detect format ──────────────────────────────────────────────────
      // Trans-sheet format: has L/NO column (the xlsx monthly sheet)
      // Simple format: SAVINGS, LOAN, LN INT, COMM columns
      const firstRowKeys = Object.keys(r).map(k => k.toUpperCase());
      const isTransFormat = firstRowKeys.some(k => k === 'L/NO' || k === 'L/NO.');
 
      // ── Parse amounts ──────────────────────────────────────────────────
      let savingsBF, monthlySavings, savingsBank,
          loanBF, monthlyPrincipal, loanPrinBank,
          loanIntBF, monthlyInterest, loanIntBank,
          commBF, commAdd, commRepay, commRepayBank,
          formFee, otherCharges, totalDeduction;
 
      if (isTransFormat) {
        // Columns from MM__FEB___2026.xlsx (abbreviated headers)
        savingsBF        = parseAmt(r['SAVINGS B/F']);
        monthlySavings   = parseAmt(r['ADD: SAV'] || r['ADD: SAVINGS DURING THE MONTH'] || r['ADD: SAVINGS']);
        savingsBank      = parseAmt(r['ADD: SAV  (BANK)'] || r['ADD: SAV (BANK)'] || r['ADD: SAVINGS DURING THE MONTH (BANK)']);
 
        loanBF           = parseAmt(r['LOAN PRIN. B/F'] || r['LOAN PRIN. BAL. B/F']);
        monthlyPrincipal = parseAmt(r['LESS: LN. PRIN. REPAY.'] || r['LESS: LOAN PRINCIPAL REPAYMENT'] || r['LESS: LN. PRIN. REP.']);
        loanPrinBank     = parseAmt(r['LESS: LN. PRIN. REP. (BANK)'] || r['LESS: LOAN PRINCIPAL REPAYMENT (BANK)']);
 
        loanIntBF        = parseAmt(r['LOAN INT. BAL. B/F'] || r['LOAN INTEREST BALANCE B/F']);
        monthlyInterest  = parseAmt(r['INT. PD.'] || r['INT. PD. (BANK)'] || r['LESS: LOAN INTEREST PAID THIS MONTH'] || r['INT PD']);
        loanIntBank      = parseAmt(r['INT. PD.  (BANK)'] || r['INT. PD. (BANK)']);
 
        commBF           = parseAmt(r['COM.  BAL. B/F'] || r['COMM. BAL. B/F'] || r['COMMODITY SALES BAL. B/F']);
        commAdd          = parseAmt(r[' COMM.DURING'] || r['COMM.DURING'] || r['ADD: COMM. SALES DURING THE MONTH']);
        commRepay        = parseAmt(r['COM. REPAY. '] || r['COM. REPAY.'] || r['LESS: COMMODITY SALES REPAYMENT']);
        commRepayBank    = parseAmt(r['COM. REPAY. (BANK)'] || r['LESS: COMM. SALES REPAY. (BANK)']);
 
        formFee          = parseAmt(r['FORM']);
        otherCharges     = parseAmt(r['OTHER CHARGES']);
        totalDeduction   = parseAmt(r['TOTAL DEDUCTION']);
 
      } else {
        // Simple balance format
        savingsBF        = 0;
        monthlySavings   = parseAmt(r['SAVINGS']);
        savingsBank      = 0;
 
        loanBF           = parseAmt(r['LOAN']);
        monthlyPrincipal = loanBF > 0
          ? parseAmt(r['MONTHLY PRINCIPAL'] || r['MONTHLY_PRINCIPAL']) || loanBF / 12
          : 0;
        loanPrinBank     = 0;
 
        loanIntBF        = parseAmt(r['LN INT'] || r['LN INTEREST'] || r['LOAN INTEREST'] || r['LOAN INT']);
        monthlyInterest  = loanIntBF > 0 ? loanIntBF / 12 : 0;
        loanIntBank      = 0;
 
        commBF           = parseAmt(r['COMM'] || r['COMMODITY']);
        commAdd          = 0; commRepay = 0; commRepayBank = 0;
        formFee = 0; otherCharges = 0; totalDeduction = 0;
      }
 
      // Extract month/year from the MONTH column (e.g. "FEBRUARY, 2026")
      const monthStr  = (r['MONTH'] || '').toUpperCase();
      const MONTHS    = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE',
                         'JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
      let dataMonth   = MONTHS.findIndex(m => monthStr.includes(m)) + 1; // 1-12
      let dataYear    = parseInt((monthStr.match(/\d{4}/) || [])[0]) || new Date().getFullYear();
      if (!dataMonth) { dataMonth = new Date().getMonth() + 1; }
 
      // Previous month = B/F reference (for savings_bf, loan_bal_bf, etc.)
      let bfMonth = dataMonth - 1;
      let bfYear  = dataYear;
      if (bfMonth === 0) { bfMonth = 12; bfYear--; }
 
      const client = await db.getClient();
      try {
        await client.query('BEGIN');
 
        // ── SAVINGS ────────────────────────────────────────────────────────
        // Store B/F as previous month record so cumulative total is correct
        if (savingsBF > 0) {
          await client.query(`
            INSERT INTO savings (member_id, amount, month, year, description)
            VALUES ($1,$2,$3,$4,'Balance B/F')
            ON CONFLICT (member_id, month, year) DO UPDATE SET amount=EXCLUDED.amount
          `, [memberId, savingsBF, bfMonth, bfYear]);
        }
        // Store the monthly savings contribution for the current month
        if (monthlySavings > 0 || savingsBank > 0) {
          const savTotal = monthlySavings + savingsBank;
          await client.query(`
            INSERT INTO savings (member_id, amount, month, year, description)
            VALUES ($1,$2,$3,$4,'Monthly Savings')
            ON CONFLICT (member_id, month, year) DO UPDATE SET amount=EXCLUDED.amount
          `, [memberId, savTotal, dataMonth, dataYear]);
        }
 
        // ── LOAN ──────────────────────────────────────────────────────────
        if (loanBF > 0 && monthlyPrincipal > 0) {
          await client.query(
            `DELETE FROM loans WHERE member_id=$1 AND description='Opening Balance'`,
            [memberId]
          );
          const months = Math.ceil(loanBF / monthlyPrincipal);
          const janPrincipal    = Math.min(monthlyPrincipal, loanBF);
          const janInterest     = monthlyInterest;
          const balanceAfterJan = loanBF - janPrincipal;
          const intBalAfterJan  = Math.max(loanIntBF - janInterest, 0);
          const loanStatus      = balanceAfterJan <= 0 ? 'cleared' : 'active';
          const dateIssued      = `${bfYear}-${String(bfMonth).padStart(2,'0')}-01`;
 
          const loanRow = await client.query(`
            INSERT INTO loans
              (member_id, principal, months, remaining_balance,
               monthly_principal, total_interest, monthly_interest,
               interest_paid, months_paid, status, date_issued, description)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10,'Opening Balance')
            RETURNING id
          `, [
            memberId,
            loanBF,
            months,
            balanceAfterJan,
            monthlyPrincipal,
            loanIntBF,
            monthlyInterest,
            janInterest,
            loanStatus,
            dateIssued,
          ]);
 
          if (janPrincipal > 0 || janInterest > 0) {
            await client.query(`
              INSERT INTO loan_repayments
                (loan_id, member_id, principal_paid, interest_paid, month, year)
              VALUES ($1,$2,$3,$4,$5,$6)
            `, [loanRow.rows[0].id, memberId, janPrincipal, janInterest, dataMonth, dataYear]);
          }
        }
 
        // ── COMMODITY ─────────────────────────────────────────────────────
        if (commBF > 0) {
          await client.query(
            `DELETE FROM commodity WHERE member_id=$1 AND month=$2 AND year=$3 AND description='Balance B/F'`,
            [memberId, bfMonth, bfYear]
          );
          await client.query(`
            INSERT INTO commodity (member_id, amount, month, year, description)
            VALUES ($1,$2,$3,$4,'Balance B/F')
          `, [memberId, commBF, bfMonth, bfYear]);
        }
 
        // ── MONTHLY TRANSACTION RECORD (monthly_trans) ────────────────────
        // Store all the trans-sheet values so the ledger view shows them correctly
        const transValues = {
          savings_bf:          savingsBF,
          savings_add:         monthlySavings,
          savings_add_bank:    savingsBank,
          savings_cf:          parseAmt(r['NET SAVING C/F'] || r['SAVINGS C/F'] || '0'),
          loan_bal_bf:         loanBF,
          loan_granted:        parseAmt(r['ADD: LOAN GRANTED '] || r['ADD: LOAN GRANTED'] || r['LOAN GRANTED'] || '0'),
          loan_repayment:      monthlyPrincipal,
          loan_repayment_bank: loanPrinBank,
          loan_ledger_bal:     parseAmt(r['LN LEDGER BAL.'] || r['LOAN LEDGER BAL.'] || '0'),
          loan_int_bf:         loanIntBF,
          loan_int_charged:    parseAmt(r[' INT. CHARGE'] || r['INT. CHARGE'] || r['INT CHARGE'] || '0'),
          loan_int_paid:       monthlyInterest,
          loan_int_paid_bank:  loanIntBank,
          loan_int_cf:         parseAmt(r['INT. BAL. C/F'] || r['LOAN INT. BAL. C/F'] || r['INT BAL C/F'] || '0'),
          comm_bal_bf:         commBF,
          comm_add:            commAdd,
          comm_repayment:      commRepay,
          comm_repayment_bank: commRepayBank,
          comm_bal_cf:         parseAmt(r['COM.  BAL. C/F'] || r['COM. BAL. C/F'] || r['COMM BAL C/F'] || '0'),
          form:                formFee,
          other_charges:       otherCharges,
          total_deduction:     totalDeduction,
        };
 
        for (const [column_key, amount] of Object.entries(transValues)) {
          await client.query(`
            INSERT INTO monthly_trans (member_id, column_key, amount, month, year)
            VALUES ($1,$2,$3,$4,$5)
            ON CONFLICT (member_id, column_key, month, year)
            DO UPDATE SET amount=EXCLUDED.amount, updated_at=NOW()
          `, [memberId, column_key, amount, dataMonth, dataYear]);
        }
 
        await client.query('COMMIT');
        imported++;
      } catch (e) {
        await client.query('ROLLBACK');
        errors.push(`${ledger_no || staff_no}: ${e.message}`);
        skipped++;
      } finally {
        client.release();
      }
    }
 
    console.log('Balances import successful:', { imported, skipped, errors });
    res.json({
      ok: true,
      message: `${imported} members updated, ${skipped} skipped`,
      imported, skipped, errors,
    });
  } catch (err) {
    console.error('Balances import error:', err);
    res.status(500).json({ error: err.message });
  }
}

// ── Personal Ledger: full year view per member ────────────────────────────────
async function getMemberLedger(req, res) {
  const memberId = parseInt(req.params.id);
  const year     = parseInt(req.query.year) || new Date().getFullYear();

  try {
    // All monthly_trans for this member/year
    const transRes = await db.query(
      `SELECT month, column_key, amount FROM monthly_trans
       WHERE member_id=$1 AND year=$2 ORDER BY month`,
      [memberId, year]
    );
    const byMonth = {};
    for (const r of transRes.rows) {
      if (!byMonth[r.month]) byMonth[r.month] = {};
      byMonth[r.month][r.column_key] = parseFloat(r.amount) || 0;
    }

    // Shares additions this year
    const sharesRes = await db.query(
      `SELECT month, amount FROM shares WHERE member_id=$1 AND year=$2`,
      [memberId, year]
    );
    const sharesMap = {};
    for (const s of sharesRes.rows) sharesMap[s.month] = parseFloat(s.amount) || 0;

    // Shares B/F = cumulative before this year
    const sharesBFRes = await db.query(
      `SELECT COALESCE(SUM(amount),0) AS total FROM shares WHERE member_id=$1 AND year<$2`,
      [memberId, year]
    );
    const sharesBF = parseFloat(sharesBFRes.rows[0].total) || 0;

    // B/F from earliest month's _bf columns
    const months = Object.keys(byMonth).map(Number).sort((a, b) => a - b);
    const firstData = months.length ? (byMonth[months[0]] || {}) : {};
    const bf = {
      savings_bf:  firstData.savings_bf   || 0,
      savings_bank_bf: 0,
      shares_bf:   sharesBF,
      loan_bal_bf: firstData.loan_bal_bf  || 0,
      loan_int_bf: firstData.loan_int_bf  || 0,
      comm_bal_bf: firstData.comm_bal_bf  || 0,
    };

    // Build 12 monthly rows
    const g = (d, k) => (d ? d[k] || 0 : 0);
    const rows = [];
    for (let m = 1; m <= 12; m++) {
      const d = byMonth[m] || null;
      rows.push({
        month: m,
        has_data: !!(d || sharesMap[m]),
        savings_withdrawal:  g(d, 'savings_withdrawal'),
        savings_add:         g(d, 'savings_add'),
        savings_add_bank:    g(d, 'savings_add_bank'),
        shares:              sharesMap[m] || 0,
        shares_bank:         0,
        loan_granted:        g(d, 'loan_granted'),
        loan_int_charged:    g(d, 'loan_int_charged'),
        loan_repayment:      g(d, 'loan_repayment'),
        loan_repayment_bank: g(d, 'loan_repayment_bank'),
        loan_int_paid:       g(d, 'loan_int_paid'),
        comm_add:            g(d, 'comm_add'),
        comm_repayment:      g(d, 'comm_repayment'),
        comm_repayment_bank: g(d, 'comm_repayment_bank'),
        form:                g(d, 'form'),
        other_charges:       g(d, 'other_charges'),
        total_deduction:     g(d, 'total_deduction'),
        // C/F balances (for reference)
        savings_cf:          g(d, 'savings_cf'),
        loan_ledger_bal:     g(d, 'loan_ledger_bal'),
        loan_int_cf:         g(d, 'loan_int_cf'),
        comm_bal_cf:         g(d, 'comm_bal_cf'),
      });
    }

    // Latest C/F for summary
    const lastData = months.length ? (byMonth[months[months.length - 1]] || {}) : {};
    const summary = {
      net_savings:  lastData.savings_cf      || 0,
      loan_bal:     lastData.loan_ledger_bal || 0,
      int_to_pay:   lastData.loan_int_cf     || 0,
      balance:      lastData.comm_bal_cf     || 0,
      total_shares: sharesBF + rows.reduce((s, r) => s + r.shares, 0),
    };

    // Available years for this member
    const yearsRes = await db.query(
      `SELECT DISTINCT year FROM monthly_trans WHERE member_id=$1
       UNION SELECT DISTINCT year FROM shares WHERE member_id=$1
       ORDER BY year DESC`,
      [memberId]
    );
    const availableYears = yearsRes.rows.map((r) => r.year);

    res.json({ rows, bf, summary, year, availableYears });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── Get all deactivated members ──────────────────────────────────────────────
async function getDeactivatedMembers(req, res) {
  try {
    const result = await db.query(`
      SELECT
        m.id, m.ledger_no, m.staff_no, m.full_name,
        m.deactivation_reason, m.updated_at,
        COALESCE((SELECT SUM(l.remaining_balance) FROM loans l WHERE l.member_id = m.id AND l.status = 'active'), 0) AS outstanding_loan,
        COALESCE((SELECT SUM(l.total_interest - l.interest_paid) FROM loans l WHERE l.member_id = m.id AND l.status = 'active'), 0) AS outstanding_interest,
        COALESCE(
            (SELECT mt.amount FROM monthly_trans mt
             WHERE mt.member_id = m.id AND mt.column_key = 'savings_cf'
             ORDER BY mt.year DESC, mt.month DESC LIMIT 1),
            (SELECT SUM(s.amount) FROM savings s WHERE s.member_id = m.id),
            0
          ) AS total_savings
      FROM members m
      WHERE m.is_active = FALSE
      ORDER BY m.updated_at DESC
    `);
    res.json({ deactivated: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── Reactivate a deactivated member ──────────────────────────────────────────
async function reactivateMember(req, res) {
  const { id } = req.params;
  const { reason } = req.body; // optional reason why reactivating

  try {
    const result = await db.query(
      `UPDATE members SET is_active = TRUE, deactivation_reason = NULL, updated_at = NOW()
       WHERE id = $1 AND is_active = FALSE
       RETURNING *`,
      [id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Member not found or already active' });
    }

    res.json({ message: 'Member reactivated', member: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function emailMemberMonthlyReport(req, res) {
  const memberId = parseInt(req.params.id, 10);
  if (!memberId) {
    return res.status(400).json({ error: 'Invalid member id' });
  }

  const resolved = resolveMonthYear(req.body.month, req.body.year);
  if (resolved.error) {
    return res.status(400).json({ error: resolved.error });
  }
  const { month, year } = resolved;

  const mailer = getMailer();
  if (mailer.error) {
    return res.status(500).json({ error: mailer.error });
  }

  try {
    const result = await sendSingleMemberMonthlyReport(memberId, month, year, mailer);
    if (result.status === 'failed') {
      return res.status(404).json({ error: result.reason });
    }
    if (result.status === 'skipped') {
      return res.status(400).json({ error: result.reason });
    }
    res.json({ ok: true, month, year, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function emailMonthlyReports(req, res) {
  const resolved = resolveMonthYear(req.body.month, req.body.year);
  if (resolved.error) {
    return res.status(400).json({ error: resolved.error });
  }
  const { month, year } = resolved;

  const mailer = getMailer();
  if (mailer.error) {
    return res.status(500).json({ error: mailer.error });
  }

  try {
    let memberRows;
    if (Array.isArray(req.body.member_ids) && req.body.member_ids.length > 0) {
      const memberIds = req.body.member_ids
        .map((v) => parseInt(v, 10))
        .filter((v) => Number.isInteger(v) && v > 0);

      if (!memberIds.length) {
        return res.status(400).json({ error: 'member_ids must contain valid integer ids' });
      }

      const scoped = await db.query(
        `SELECT id FROM members WHERE id = ANY($1::int[]) ORDER BY ledger_no`,
        [memberIds]
      );
      memberRows = scoped.rows;
    } else {
      const allMembers = await db.query(
        `SELECT id FROM members WHERE is_active = TRUE ORDER BY ledger_no`
      );
      memberRows = allMembers.rows;
    }

    const sent = [];
    const skipped = [];
    const failed = [];

    for (const row of memberRows) {
      try {
        const result = await sendSingleMemberMonthlyReport(row.id, month, year, mailer);
        if (result.status === 'sent') sent.push(result);
        if (result.status === 'skipped') skipped.push({ member_id: row.id, reason: result.reason });
        if (result.status === 'failed') failed.push({ member_id: row.id, reason: result.reason });
      } catch (err) {
        failed.push({ member_id: row.id, reason: err.message });
      }
    }

    res.json({
      ok: true,
      month,
      year,
      total: memberRows.length,
      sent_count: sent.length,
      skipped_count: skipped.length,
      failed_count: failed.length,
      sent,
      skipped,
      failed,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { 
  getMembers, getMember, createMember, updateMember, deleteMember, 
  importCSV, importBalances, getMemberLedger,
  getDeactivatedMembers, reactivateMember,
  emailMemberMonthlyReport, emailMonthlyReports
};
