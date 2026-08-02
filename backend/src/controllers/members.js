const db = require('../db');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
// loans table needs optional description column – add it if it doesn't exist
// (run once on startup, harmless if already present)
db.query(`ALTER TABLE loans ADD COLUMN IF NOT EXISTS description TEXT`).catch(() => { });
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

function buildLedgerRows({ byMonth, sharesMap, sharesBF }) {
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const firstDataMonth = months.find((month) => byMonth[month]);
  const firstData = firstDataMonth ? (byMonth[firstDataMonth] || {}) : {};

  const bf = {
    savings_bf: toNumber(firstData.savings_bf || 0),
    savings_bank_bf: toNumber(firstData.savings_bank_bf || 0),
    shares_bf: sharesBF,
    loan_bal_bf: toNumber(firstData.loan_bal_bf || 0),
    loan_int_bf: toNumber(firstData.loan_int_bf || 0),
    comm_bal_bf: toNumber(firstData.comm_bal_bf || 0),
  };

  let savingsCarry = bf.savings_bf;
  let loanCarry = bf.loan_bal_bf;
  let interestCarry = bf.loan_int_bf;
  let commodityCarry = bf.comm_bal_bf;

  const rows = months.map((month) => {
    const data = byMonth[month] || {};
    const savings_withdrawal = toNumber(data.savings_withdrawal);
    const savings_add = toNumber(data.savings_add);
    const savings_add_bank = toNumber(data.savings_add_bank);
    const shares = toNumber(sharesMap[month]);
    const loan_granted = toNumber(data.loan_granted);
    const loan_int_charged = toNumber(data.loan_int_charged);
    const loan_repayment = toNumber(data.loan_repayment);
    const loan_repayment_bank = toNumber(data.loan_repayment_bank);
    const loan_int_paid = toNumber(data.loan_int_paid);
    const loan_int_paid_bank = toNumber(data.loan_int_paid_bank);
    const comm_add = toNumber(data.comm_add);
    const comm_repayment = toNumber(data.comm_repayment);
    const comm_repayment_bank = toNumber(data.comm_repayment_bank);
    const form = toNumber(data.form);
    const other_charges = toNumber(data.other_charges);

    savingsCarry = Math.max(0, savingsCarry + savings_add + savings_add_bank - savings_withdrawal);
    loanCarry = Math.max(0, loanCarry + loan_granted - loan_repayment - loan_repayment_bank);
    interestCarry = Math.max(0, interestCarry + loan_int_charged - loan_int_paid - loan_int_paid_bank);
    commodityCarry = Math.max(0, commodityCarry + comm_add - comm_repayment - comm_repayment_bank);

    return {
      month,
      has_data: !!(byMonth[month] || sharesMap[month]),
      savings_withdrawal,
      savings_add,
      savings_add_bank,
      shares,
      shares_bank: 0,
      loan_granted,
      loan_int_charged,
      loan_repayment,
      loan_repayment_bank,
      loan_int_paid,
      loan_int_paid_bank,
      comm_add,
      comm_repayment,
      comm_repayment_bank,
      form,
      other_charges,
      total_deduction: savings_add + savings_add_bank + loan_repayment + loan_repayment_bank + loan_int_paid + loan_int_paid_bank + comm_repayment + comm_repayment_bank + form + other_charges,
      savings_cf: savingsCarry,
      loan_ledger_bal: loanCarry,
      loan_int_cf: interestCarry,
      comm_bal_cf: commodityCarry,
    };
  });

  const summary = rows.reduce((acc, row) => ({
    net_savings: row.savings_cf,
    loan_bal: row.loan_ledger_bal,
    int_to_pay: row.loan_int_cf,
    balance: row.comm_bal_cf,
    total_shares: acc.total_shares + row.shares,
  }), {
    net_savings: bf.savings_bf,
    loan_bal: bf.loan_bal_bf,
    int_to_pay: bf.loan_int_bf,
    balance: bf.comm_bal_bf,
    total_shares: bf.shares_bf,
  });

  return { bf, rows, summary };
}

function buildMonthlyReportDocument({ member, month, year, current, previous }) {
  const subjectPeriod = `${MONTH_LABELS[month - 1]} ${year}`;
  // Inline logo if available to avoid duplicate displayed attachments in email clients
  let logoDataUrl = null;
  try {
    const logoPath = process.env.COOP_LOGO_PATH;
    if (logoPath && fs.existsSync(logoPath)) {
      const ext = path.extname(logoPath).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : (ext === '.gif' ? 'image/gif' : 'image/png');
      const buf = fs.readFileSync(logoPath);
      logoDataUrl = `data:${mime};base64,${buf.toString('base64')}`;
    }
  } catch (e) {
    logoDataUrl = null;
  }

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
          display: flex;
          align-items: center;
          gap: 12px;
          border-bottom: 1px solid #222;
          background: #eef1e0;
          padding: 6px 8px;
        }
        .logo-wrap { width:48px; height:48px; display:flex; align-items:center; justify-content:center; }
        .logo { width:100%; height:100%; object-fit:contain; }
        .logo-placeholder { width:100%; height:100%; background:transparent; }
        .header-copy { text-align: left; }
        .org { font-size: 12px; font-weight: 800; color: #8b5a11; }
        .title { font-size: 11px; font-weight: 700; margin-top: 2px; }
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
          <div class="logo-wrap">${logoDataUrl ? `<img src="${logoDataUrl}" alt="logo" class="logo"/>` : `<div class="logo-placeholder"></div>`}</div>
          <div class="header-copy">
            <div class="org">SSANUCOOP</div>
            <div class="title">TRANSACTIONS — ${escapeHtml(subjectPeriod)}</div>
          </div>
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
    row('SAVINGS B/F', `${formatAmount(previous?.savings_cf || 0)}`) +
    row('ADD: Savings this month', `${formatAmount(current.savings_add)}`) +
    row('ADD: Savings this month (Bank)', `${formatAmount(current.savings_add_bank)}`) +
    row('LESS: Withdrawal', `${formatAmount(current.savings_withdrawal)}`) +
    row('Net Saving C/F', `${formatAmount(current.savings_cf)}`),
    'green')}

        ${section('LOAN SERVICES:',
      row('Loan Principal Balance B/F', `${formatAmount(previous?.loan_ledger_bal || 0)}`) +
      row('ADD: Loan Granted this Month', `${formatAmount(current.loan_granted)}`) +
      row('LESS: Loan Principal Repayment', `${formatAmount(current.loan_repayment)}`) +
      row('LESS: Loan Principal Repayment (Bank)', `${formatAmount(current.loan_repayment_bank)}`) +
      row('Loan Ledger Balance C/F', `${formatAmount(current.loan_ledger_bal)}`),
      'peach')}

        ${section('LOAN INTEREST:',
        row('Loan Interest Balance B/F', `${formatAmount(openingLoanInterest)}`) +
        row('ADD: Ln Interest charged (this month)', `${formatAmount(current.loan_int_charged)}`) +
        row('LESS: Loan Interest paid', `${formatAmount(current.loan_int_paid)}`) +
        row('LESS: Loan Interest Paid (Bank)', `${formatAmount(current.loan_int_paid_bank)}`) +
        row('Loan Interest Balance C/F', `${formatAmount(loanInterestCf)}`),
        'yellow')}

        ${section('COMMODITY/GADGET SALES SERVICES:',
          row('Commodity Sales Balance B/F', `${formatAmount(previous?.comm_bal_cf || 0)}`) +
          row('ADD: Commodity Sales this Month', `${formatAmount(current.comm_add)}`) +
          row('LESS: Commodity Sales Repayment', `${formatAmount(current.comm_repayment)}`) +
          row('LESS: Commodity Sales Repayment (Bank)', `${formatAmount(current.comm_repayment_bank)}`) +
          row('Commodity Sales Balance C/F', `${formatAmount(current.comm_bal_cf)}`),
          'blue')}

        ${section('SUMMARY:',
            row('SAVINGS', `${formatAmount(savingsValue)}`) +
            row('LOAN PRINCIPAL REPAYMENT', `${formatAmount(loanPrincipalValue)}`) +
            row('LOAN INTEREST', `${formatAmount(loanInterestValue)}`) +
            row('COMMODITY/GADGET', `${formatAmount(commodityValue)}`) +
            row('LOAN/MEMBERSHIP FORM', `${formatAmount(current.form)}`) +
            row('OTHER CHARGES', `${formatAmount(current.other_charges)}`) +
            row('TOTAL DEDUCTION THIS MONTH', `${formatAmount(current.total_deduction)}`) +
            row('TOTAL AMOUNT PAID TO BANK', `${formatAmount(totalAmountPaidToBank)}`),
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

async function getMailer() {
  let user = process.env.SMTP_USER;
  let pass = process.env.SMTP_PASS;
  let host = process.env.SMTP_HOST;
  let port = process.env.SMTP_PORT;

  if (!user || !pass) {
    try {
      const res = await db.query(
        "SELECT key, value FROM app_settings WHERE key IN ('smtp_user', 'smtp_pass', 'smtp_host', 'smtp_port')"
      );
      const settings = Object.fromEntries(res.rows.map(r => [r.key, r.value]));
      if (settings.smtp_user && settings.smtp_pass) {
        user = user || settings.smtp_user;
        pass = pass || settings.smtp_pass;
        host = host || settings.smtp_host;
        port = port || settings.smtp_port;
      }
    } catch (e) {
      console.error('Error fetching SMTP settings from DB:', e);
    }
  }

  if (!user || !pass) {
    return { error: 'Missing SMTP configuration. Set SMTP_USER and SMTP_PASS in environment variables or Settings.' };
  }

  const transportConfig = host ? {
    host,
    port: parseInt(port) || 587,
    secure: parseInt(port) === 465,
    auth: { user, pass },
  } : {
    service: 'gmail',
    auth: { user, pass },
  };

  const transporter = nodemailer.createTransport(transportConfig);

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

  const targetMonth = parseInt(month, 10) || new Date().getMonth() + 1;
  const targetYear = parseInt(year, 10) || new Date().getFullYear();
  const transRes = await db.query(
    `SELECT month, column_key, amount FROM monthly_trans
     WHERE member_id=$1 AND year=$2 AND month <= $3 ORDER BY month`,
    [memberId, targetYear, targetMonth]
  );

  const byMonth = {};
  for (const row of transRes.rows) {
    if (!byMonth[row.month]) byMonth[row.month] = {};
    byMonth[row.month][row.column_key] = parseFloat(row.amount) || 0;
  }

  const ledger = buildLedgerRows({ byMonth, sharesMap: {}, sharesBF: 0 });
  const currentRow = ledger.rows[targetMonth - 1] || {
    savings_withdrawal: 0,
    savings_add: 0,
    savings_add_bank: 0,
    loan_granted: 0,
    loan_int_charged: 0,
    loan_repayment: 0,
    loan_repayment_bank: 0,
    loan_int_paid: 0,
    loan_int_paid_bank: 0,
    comm_add: 0,
    comm_repayment: 0,
    comm_repayment_bank: 0,
    form: 0,
    other_charges: 0,
    total_deduction: 0,
    savings_cf: ledger.bf.savings_bf,
    loan_ledger_bal: ledger.bf.loan_bal_bf,
    loan_int_cf: ledger.bf.loan_int_bf,
    comm_bal_cf: ledger.bf.comm_bal_bf,
  };
  const previousRow = targetMonth > 1
    ? (ledger.rows[targetMonth - 2] || {
      savings_cf: ledger.bf.savings_bf,
      loan_ledger_bal: ledger.bf.loan_bal_bf,
      loan_int_cf: ledger.bf.loan_int_bf,
      comm_bal_cf: ledger.bf.comm_bal_bf,
    })
    : {
      savings_cf: ledger.bf.savings_bf,
      loan_ledger_bal: ledger.bf.loan_bal_bf,
      loan_int_cf: ledger.bf.loan_int_bf,
      comm_bal_cf: ledger.bf.comm_bal_bf,
    };

  const report = {
    savings_withdrawal: currentRow.savings_withdrawal || 0,
    savings_add: currentRow.savings_add || 0,
    savings_add_bank: currentRow.savings_add_bank || 0,
    loan_granted: currentRow.loan_granted || 0,
    loan_int_charged: currentRow.loan_int_charged || 0,
    loan_repayment: currentRow.loan_repayment || 0,
    loan_repayment_bank: currentRow.loan_repayment_bank || 0,
    loan_int_paid: currentRow.loan_int_paid || 0,
    loan_int_paid_bank: currentRow.loan_int_paid_bank || 0,
    comm_add: currentRow.comm_add || 0,
    comm_repayment: currentRow.comm_repayment || 0,
    comm_repayment_bank: currentRow.comm_repayment_bank || 0,
    form: currentRow.form || 0,
    other_charges: currentRow.other_charges || 0,
    total_deduction: currentRow.total_deduction || 0,
    savings_cf: currentRow.savings_cf || 0,
    loan_ledger_bal: currentRow.loan_ledger_bal || 0,
    loan_int_cf: currentRow.loan_int_cf || 0,
    comm_bal_cf: currentRow.comm_bal_cf || 0,
  };

  const subjectPeriod = `${MONTH_LABELS[month - 1]} ${year}`;
  const subject = `Transaction for the Month of ${subjectPeriod}`;
  const html = buildMonthlyReportDocument({
    member,
    month: targetMonth,
    year: targetYear,
    current: report,
    previous: previousRow,
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
    attachmentName: `${member.ledger_no || member.id}-monthly-report-${targetYear}-${String(targetMonth).padStart(2, '0')}.html`,
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

  const attachments = [
    {
      filename: reportPayload.attachmentName,
      content: reportPayload.attachmentContent,
      contentType: 'text/html; charset=utf-8',
    },
  ];

  await mailer.transporter.sendMail({
    from: mailer.from,
    to: email,
    subject: reportPayload.subject,
    text: reportPayload.text,
    html: reportPayload.html,
    attachments,
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
            m.full_name ILIKE $1
            OR m.ledger_no ILIKE $1
            OR m.staff_no ILIKE $1
            OR m.department ILIKE $1
          )
        ORDER BY regexp_replace(m.ledger_no, '\\d', '', 'g'), NULLIF(regexp_replace(m.ledger_no, '\\D', '', 'g'), '')::numeric NULLS LAST, m.ledger_no
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
        ORDER BY regexp_replace(m.ledger_no, '\\d', '', 'g'), NULLIF(regexp_replace(m.ledger_no, '\\D', '', 'g'), '')::numeric NULLS LAST, m.ledger_no
        LIMIT $1 OFFSET $2
      `;
      params = [limit, offset];
    }

    // Get total count efficiently for pagination
    const countQuery = search
      ? `SELECT COUNT(*) FROM members WHERE is_active = TRUE AND (
           full_name ILIKE $1
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
    const s = String(raw).trim();
    if (!s) return null;

    // ── 1. ISO already formatted ────────────────────────────────────────────
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    // ── 2. Excel serial number (e.g. 43240 → 2018-05-20) ───────────────────
    // Serials for years 2000-2040 fall in range 36526-51544.
    // We guard with > 1000 so bare years like "2016" aren't treated as serials.
    if (/^\d{4,6}$/.test(s)) {
      const serial = parseInt(s, 10);
      if (serial > 20000) { // 20000 = ~1954, safe floor for admission dates
        const corrected = serial >= 61 ? serial - 1 : serial;
        const epoch = new Date(1899, 11, 31); // Dec 31 1899
        epoch.setDate(epoch.getDate() + corrected);
        if (!isNaN(epoch)) return epoch.toISOString().split('T')[0];
      }
    }

    // ── 3. Normalise the string then try multiple patterns ──────────────────
    // Strip ordinal suffixes (1ST, 2ND, 3RD, 4TH, IST typo) and stray dots
    let n = s
      .replace(/\b(\d+)(ST|ND|RD|TH)\b\.?/gi, '$1') // "1ST" → "1", "IST" left alone below
      .replace(/\bIST\b/gi, '1')                      // "IST JULY" typo → "1 JULY"
      .replace(/\./g, '')                              // "JAN." → "JAN"
      .replace(/,/g, '')                               // "JANUARY, 2020" → "JANUARY 2020"
      .replace(/\s+/g, ' ')
      .trim();

    // Expand full month names to 3-letter abbrevs for uniform parsing
    const MONTHS = {
      JANUARY: 'Jan', FEBRUARY: 'Feb', MARCH: 'Mar', APRIL: 'Apr',
      MAY: 'May', JUNE: 'Jun', JULY: 'Jul', AUGUST: 'Aug',
      SEPTEMBER: 'Sep', OCTOBER: 'Oct', NOVEMBER: 'Nov', DECEMBER: 'Dec',
    };
    for (const [full, abbr] of Object.entries(MONTHS)) {
      n = n.replace(new RegExp(`\\b${full}\\b`, 'gi'), abbr);
    }

    // "6 Aug 16" / "6 Aug 2016" / "6-Aug-16" / "28-APR-2017"
    const dmy = n.match(/^(\d{1,2})[\s\-\/]([A-Za-z]{3})[\s\-\/](\d{2,4})$/);
    if (dmy) {
      const year = dmy[3].length === 2
        ? (parseInt(dmy[3]) > 50 ? '19' : '20') + dmy[3]
        : dmy[3];
      const d = new Date(`${dmy[1]} ${dmy[2]} ${year}`);
      if (!isNaN(d)) return d.toISOString().split('T')[0];
    }

    // "1 Aug 2020" already covered above; also handle "Aug 2016" (no day → 1st)
    const my = n.match(/^([A-Za-z]{3})[\s\-\/](\d{4})$/);
    if (my) {
      const d = new Date(`1 ${my[1]} ${my[2]}`);
      if (!isNaN(d)) return d.toISOString().split('T')[0];
    }

    // "1 Jan 2020" with full or abbrev month, space-separated (after normalisation)
    const dmy2 = n.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
    if (dmy2) {
      const d = new Date(`${dmy2[1]} ${dmy2[2]} ${dmy2[3]}`);
      if (!isNaN(d)) return d.toISOString().split('T')[0];
    }

    // "Jan 2020" / "Jan 2019" — month + year only, no day
    const my2 = n.match(/^([A-Za-z]{3})\s+(\d{4})$/);
    if (my2) {
      const d = new Date(`1 ${my2[1]} ${my2[2]}`);
      if (!isNaN(d)) return d.toISOString().split('T')[0];
    }

    // ── 4. Last-resort generic parse (avoid for ambiguous values) ───────────
    // Skip if value looks like a pure year (already failed serial check above)
    if (/^\d{4}$/.test(s)) return null;
    const d = new Date(s);
    if (!isNaN(d) && d.getFullYear() > 1970) return d.toISOString().split('T')[0];

    return null; // unparseable — admit date will be NULL, not an error
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

      // ── Flexible header lookup ────────────────────────────────────────────
      const findValue = (...keys) => {
        const upper = {};
        for (const k of Object.keys(r)) upper[k.trim().toUpperCase()] = r[k];
        for (const key of keys) {
          const val = upper[key.trim().toUpperCase()];
          if (val !== undefined && String(val).trim() !== '') return String(val).trim();
        }
        return null;
      };

      const ledger_no = findValue('LEDGER No', 'LEDGER NO', 'Ledger No', 'ledger_no', 'L/No', 'L/NO');
      const full_name = findValue('Name', 'FULL NAME', 'full_name', 'NAME');
      if (!ledger_no || !full_name) { skipped++; continue; }

      const date_of_admission = parseDate(findValue('Date of admission', 'Date of Admission', 'DATE OF ADMISSION', 'ADMISSION DATE'));

      let rawBank = findValue('BANK', 'Bank');
      let rawAcct = findValue('acct number', 'ACCT NUMBER', 'ACCOUNT NUMBER', 'Account Number', 'Acct No', 'Account No', 'ACCT');
      // In some spreadsheets (e.g. membership upload), BANK column contains NUBAN account numbers
      if (rawBank && /^\d{8,12}$/.test(rawBank.replace(/\s+/g, '')) && !rawAcct) {
        rawAcct = rawBank;
        rawBank = null;
      }

      try {
        await db.query(`
          INSERT INTO members
            (ledger_no, staff_no, gifmis_no, full_name, gender, marital_status,
             phone, email, date_of_admission, bank, account_number, department,
             next_of_kin, next_of_kin_relation)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
          ON CONFLICT (ledger_no) DO UPDATE SET
            staff_no        = COALESCE(EXCLUDED.staff_no,        members.staff_no),
            gifmis_no       = COALESCE(EXCLUDED.gifmis_no,       members.gifmis_no),
            full_name       = EXCLUDED.full_name,
            gender          = COALESCE(EXCLUDED.gender,          members.gender),
            marital_status  = COALESCE(EXCLUDED.marital_status,  members.marital_status),
            phone           = COALESCE(EXCLUDED.phone,           members.phone),
            email           = COALESCE(EXCLUDED.email,           members.email),
            date_of_admission = COALESCE(EXCLUDED.date_of_admission, members.date_of_admission),
            bank            = COALESCE(EXCLUDED.bank,            members.bank),
            account_number  = COALESCE(EXCLUDED.account_number,  members.account_number),
            department      = COALESCE(EXCLUDED.department,      members.department),
            next_of_kin     = COALESCE(EXCLUDED.next_of_kin,     members.next_of_kin),
            next_of_kin_relation = COALESCE(EXCLUDED.next_of_kin_relation, members.next_of_kin_relation),
            updated_at      = NOW()
        `, [
          ledger_no.trim(),
          // Staff No
          findValue('Staff No', 'STAFF NO', 'staff_no', 'STAFF'),
          // GIFMIS / IPPIS
          findValue('GIFMIS No', 'GIFMIS NO', 'IPPIS No', 'IPPIS NO', 'gifmis_no'),
          full_name.trim(),
          // Gender
          findValue('GENDER', 'Gender'),
          // Marital status
          findValue('Marital status', 'MARITAL STATUS', 'Marital Status', 'Marital'),
          // Phone — includes "Phone No.", "Phone No", "GSM No"
          findValue('Phone No.', 'PHONE NO.', 'Phone No', 'PHONE NO', 'GSM No', 'GSM NO', 'Phone', 'PHONE', 'GSM'),
          // Email — includes "FUOYE E-mail Address", "Fuoye Email address"
          findValue('FUOYE E-mail Address', 'FUOYE EMAIL ADDRESS', 'Fuoye Email address', 'FUOYE Email', 'FUOYE E-mail', 'Email', 'EMAIL', 'E-MAIL'),
          date_of_admission,
          // Bank
          rawBank,
          // Account number
          rawAcct,
          // Department
          findValue('DEPARTMENT', 'Department', 'Dept'),
          // Next of kin
          findValue('Next of kin', 'NEXT OF KIN', 'Next of Kin', 'Next of kin '),
          // Relationship
          findValue('Relationship', 'RELATIONSHIP', 'RELATION', 'Relation'),
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
      const sn = (r['S/N'] || r['S/N.'] || '').replace(/\s/g, '');
      if (sn !== '' && !/^\d+$/.test(sn)) { skipped++; continue; }

      const rowName = (r['NAME'] || r['FULL NAME'] || '').toUpperCase();
      if (rowName.startsWith('TOTAL') || rowName.startsWith('GRAND TOTAL') || rowName.startsWith('SUMMARY')) {
        skipped++; continue;
      }

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
      const firstRowKeys = Object.keys(r).map(k => k.toUpperCase());
      const isTransFormat = firstRowKeys.some(k => k === 'L/NO' || k === 'L/NO.');

      // ── Parse amounts ──────────────────────────────────────────────────
      let savingsBF, monthlySavings, savingsBank,
        loanBF, monthlyPrincipal, loanPrinBank,
        loanIntBF, monthlyInterest, loanIntBank,
        commBF, commAdd, commRepay, commRepayBank,
        formFee, otherCharges, totalDeduction;

      if (isTransFormat) {
        savingsBF = parseAmt(col(r, 'SAVINGS BALANCE', 'SAVINGS B/F', 'SAVINGS BAL B/F', 'SAVINGS BAL. B/F', 'SAVINGS BF', 'SAVINGS B F'));
        monthlySavings = parseAmt(col(r, 'ADD: SAV', 'ADD: SAVINGS DURING THE MONTH', 'ADD: SAVINGS', 'SAVINGS', 'ADD SAVINGS', 'ADD SAVINGS DURING THE MONTH'));
        savingsBank = parseAmt(col(r, 'ADD: SAV (BANK)', 'ADD: SAV  (BANK)', 'ADD: SAVINGS DURING THE MONTH (BANK)', 'ADD SAVINGS (BANK)'));

        loanBF = parseAmt(col(r, 'LOAN BALANCE', 'LOAN PRIN. B/F', 'LOAN PRIN. BAL. B/F', 'LOAN PRIN BAL B/F', 'LOAN B/F', 'LOAN PRINCIPAL B/F', 'LOAN BAL B/F', 'LOAN PRIN BAL B F', 'LOAN B F'));
        monthlyPrincipal = parseAmt(col(r, 'LESS: LN. PRIN. REPAY.', 'LESS: LOAN PRINCIPAL REPAYMENT', 'LESS: LN. PRIN. REP.', 'LOAN REPAYMENT', 'LOAN PRINCIPAL REPAYMENT', 'LN PRIN REPAY'));
        loanPrinBank = parseAmt(col(r, 'LESS: LN. PRIN. REP. (BANK)', 'LESS: LOAN PRINCIPAL REPAYMENT (BANK)', 'LOAN REPAYMENT (BANK)'));

        loanIntBF = parseAmt(col(r, 'INTEREST', 'INTEREST BALANCE', 'LOAN INT. BAL. B/F', 'LOAN INTEREST BALANCE B/F', 'LOAN INT B/F', 'LOAN INT. B/F', 'LOAN INTEREST B/F', 'LOAN INT BAL B/F', 'LN INT B/F', 'INT B/F', 'INTEREST B/F', 'LOAN INT B F', 'LOAN INTEREST B F', 'INT B F', 'LN INT B F'));
        monthlyInterest = parseAmt(col(r, 'INT. PD.', 'INT. PD. (BANK)', 'LESS: LOAN INTEREST PAID THIS MONTH', 'INT PD', 'LOAN INTEREST PAID', 'LESS: LOAN INTEREST PAID'));
        loanIntBank = parseAmt(col(r, 'INT. PD. (BANK)', 'INT. PD.  (BANK)', 'LOAN INTEREST PAID (BANK)'));

        commBF = parseAmt(col(r, 'COMMODITY BALANCE', 'COM. BAL. B/F', 'COM.  BAL. B/F', 'COMM. BAL. B/F', 'COMMODITY SALES BAL. B/F', 'COMMODITY B/F', 'COMM B/F', 'COMM B F', 'COMMODITY B F'));
        commAdd = parseAmt(col(r, ' COMM.DURING', 'COMM.DURING', 'ADD: COMM. SALES DURING THE MONTH', 'COMMODITY SALES DURING THE MONTH', 'COMM DURATION'));
        commRepay = parseAmt(col(r, 'COM. REPAY. ', 'COM. REPAY.', 'LESS: COMMODITY SALES REPAYMENT', 'COMMODITY REPAYMENT', 'COMM REPAYMENT'));
        commRepayBank = parseAmt(col(r, 'COM. REPAY. (BANK)', 'LESS: COMM. SALES REPAY. (BANK)', 'COMM REPAYMENT (BANK)'));

        formFee = parseAmt(col(r, 'FORM', 'FORM FEE'));
        otherCharges = parseAmt(col(r, 'OTHER CHARGES', 'OTHERS', 'OTHER', 'OTHER CHARGE', 'OTHER DEDUCTIONS', 'OTHER DEDUCTION'));
        totalDeduction = parseAmt(col(r, 'TOTAL DEDUCTION', 'TOTAL DEDUCTIONS'));

      } else {
        savingsBF = 0;
        monthlySavings = parseAmt(col(r, 'SAVINGS', 'SAVINGS DURING MONTH'));
        savingsBank = 0;

        loanBF = parseAmt(col(r, 'LOAN', 'LOAN BAL', 'LOAN PRIN'));
        monthlyPrincipal = loanBF > 0
          ? parseAmt(col(r, 'MONTHLY PRINCIPAL', 'MONTHLY_PRINCIPAL', 'PRINCIPAL REPAYMENT')) || loanBF / 12
          : 0;
        loanPrinBank = 0;

        loanIntBF = parseAmt(col(r, 'LN INT', 'LN INTEREST', 'LOAN INTEREST', 'LOAN INT', 'LOAN INT B/F', 'LOAN INT. B/F', 'LOAN INTEREST B/F', 'INT B/F', 'LOAN INT B F', 'LOAN INTEREST B F'));
        monthlyInterest = loanIntBF > 0 ? loanIntBF / 12 : 0;
        loanIntBank = 0;

        commBF = parseAmt(col(r, 'COMM', 'COMMODITY', 'COMM B/F'));
        commAdd = 0; commRepay = 0; commRepayBank = 0;
        formFee = 0; otherCharges = 0; totalDeduction = 0;
      }

      const monthStr = (col(r, 'MONTH') || '').toUpperCase();
      const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
        'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
      let dataMonth = MONTHS.findIndex(m => monthStr.includes(m)) + 1;
      let dataYear = parseInt((monthStr.match(/\d{4}/) || [])[0]) || new Date().getFullYear();
      if (!dataMonth) { dataMonth = new Date().getMonth() + 1; }

      let bfMonth = dataMonth - 1;
      let bfYear = dataYear;
      if (bfMonth === 0) { bfMonth = 12; bfYear--; }

      const client = await db.getClient();
      try {
        await client.query('BEGIN');

        if (savingsBF > 0) {
          await client.query(`
            INSERT INTO savings (member_id, amount, month, year, description)
            VALUES ($1,$2,$3,$4,'Balance B/F')
            ON CONFLICT (member_id, month, year) DO UPDATE SET amount=EXCLUDED.amount
          `, [memberId, savingsBF, bfMonth, bfYear]);
        }
        if (monthlySavings > 0 || savingsBank > 0) {
          const savTotal = monthlySavings + savingsBank;
          await client.query(`
            INSERT INTO savings (member_id, amount, month, year, description)
            VALUES ($1,$2,$3,$4,'Monthly Savings')
            ON CONFLICT (member_id, month, year) DO UPDATE SET amount=EXCLUDED.amount
          `, [memberId, savTotal, dataMonth, dataYear]);
        }

        if (loanBF > 0) {
          await client.query(
            `DELETE FROM loans WHERE member_id=$1 AND description='Opening Balance'`,
            [memberId]
          );
          const prinPaid = monthlyPrincipal;
          const monthlyPrin = prinPaid > 0 ? prinPaid : Math.round((loanBF / 12) * 100) / 100;
          const months = prinPaid > 0 ? Math.ceil(loanBF / prinPaid) : 12;
          const balanceAfterJan = Math.max(0, loanBF - prinPaid);
          const loanStatus = balanceAfterJan <= 0 ? 'cleared' : 'active';
          const dateIssued = `${bfYear}-${String(bfMonth).padStart(2, '0')}-01`;

          const loanRow = await client.query(`
            INSERT INTO loans
              (member_id, principal, months, remaining_balance,
               monthly_principal, total_interest, monthly_interest,
               interest_paid, months_paid, status, date_issued, description)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10,'Opening Balance')
            RETURNING id
          `, [
            memberId, loanBF, months, balanceAfterJan,
            monthlyPrin, loanIntBF, monthlyInterest,
            monthlyInterest, loanStatus, dateIssued,
          ]);

          if (prinPaid > 0 || monthlyInterest > 0) {
            await client.query(`
              INSERT INTO loan_repayments
                (loan_id, member_id, principal_paid, interest_paid, month, year)
              VALUES ($1,$2,$3,$4,$5,$6)
            `, [loanRow.rows[0].id, memberId, prinPaid, monthlyInterest, dataMonth, dataYear]);
          }
        }

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

        const parsedSavingsCF = parseAmt(col(r, 'NET SAVING C/F', 'SAVINGS C/F', 'SAVINGS CF', 'NET SAVINGS C/F', 'NET SAVING C F'));
        const parsedLoanLedgerBal = parseAmt(col(r, 'LN LEDGER BAL.', 'LOAN LEDGER BAL.', 'LOAN LEDGER BAL', 'LOAN LEDGER BALANCE'));
        const parsedLoanIntCF = parseAmt(col(r, 'INT. BAL. C/F', 'LOAN INT. BAL. C/F', 'INT BAL C/F', 'LOAN INTEREST BAL C/F', 'LOAN INT C/F'));
        const parsedCommCF = parseAmt(col(r, 'COM. BAL. C/F', 'COM.  BAL. C/F', 'COMM BAL C/F', 'COMMODITY SALES BAL. C/F', 'COMM C/F'));

        const savingsWithdrawal = parseAmt(col(r, 'LESS: WITHDRAWAL', 'WITHDRAWAL', 'SAVINGS WITHDRAWAL'));
        const loanGranted = parseAmt(col(r, 'ADD: LOAN GRANTED ', 'ADD: LOAN GRANTED', 'LOAN GRANTED', 'ADD: LOAN GRANTED THIS MONTH', 'LOAN GRANTED THIS MONTH', 'GRANTS', 'GRANT', 'ADD LOAN GRANTED THIS MONTH'));
        const loanIntCharged = parseAmt(col(r, ' INT. CHARGE', 'INT. CHARGE', 'INT CHARGE', 'ADD: INTEREST CHARGED ON LOAN GRANTED THIS MONTH', 'LOAN INT CHARGED', 'INTEREST CHARGED'));

        const savingsCF = parsedSavingsCF > 0 ? parsedSavingsCF : Math.max(0, savingsBF + monthlySavings + savingsBank - savingsWithdrawal);
        const loanLedgerBal = parsedLoanLedgerBal > 0 ? parsedLoanLedgerBal : Math.max(0, loanBF + loanGranted - monthlyPrincipal - loanPrinBank);
        const loanIntCF = parsedLoanIntCF > 0 ? parsedLoanIntCF : Math.max(0, loanIntBF + loanIntCharged - monthlyInterest - loanIntBank);
        const commCF = parsedCommCF > 0 ? parsedCommCF : Math.max(0, commBF + commAdd - commRepay - commRepayBank);

        const transValues = {
          savings_bf: savingsBF,
          savings_add: monthlySavings,
          savings_add_bank: savingsBank,
          savings_withdrawal: savingsWithdrawal,
          savings_cf: savingsCF,
          loan_bal_bf: loanBF,
          loan_granted: loanGranted,
          loan_repayment: monthlyPrincipal,
          loan_repayment_bank: loanPrinBank,
          loan_ledger_bal: loanLedgerBal,
          loan_int_bf: loanIntBF,
          loan_int_charged: loanIntCharged,
          loan_int_paid: monthlyInterest,
          loan_int_paid_bank: loanIntBank,
          loan_int_cf: loanIntCF,
          comm_bal_bf: commBF,
          comm_add: commAdd,
          comm_repayment: commRepay,
          comm_repayment_bank: commRepayBank,
          comm_bal_cf: commCF,
          form: formFee,
          other_charges: otherCharges,
          total_deduction: totalDeduction || (monthlySavings + monthlyPrincipal + monthlyInterest + commRepay + formFee + otherCharges),
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
  const year = parseInt(req.query.year) || new Date().getFullYear();

  try {
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

    const sharesRes = await db.query(
      `SELECT month, amount FROM shares WHERE member_id=$1 AND year=$2`,
      [memberId, year]
    );
    const sharesMap = {};
    for (const s of sharesRes.rows) sharesMap[s.month] = parseFloat(s.amount) || 0;

    const sharesBFRes = await db.query(
      `SELECT COALESCE(SUM(amount),0) AS total FROM shares WHERE member_id=$1 AND year<$2`,
      [memberId, year]
    );
    const sharesBF = parseFloat(sharesBFRes.rows[0].total) || 0;

    const ledger = buildLedgerRows({ byMonth, sharesMap, sharesBF });

    const yearsRes = await db.query(
      `SELECT DISTINCT year FROM monthly_trans WHERE member_id=$1
       UNION SELECT DISTINCT year FROM shares WHERE member_id=$1
       ORDER BY year DESC`,
      [memberId]
    );
    const availableYears = yearsRes.rows.map((r) => r.year);

    res.json({ rows: ledger.rows, bf: ledger.bf, summary: ledger.summary, year, availableYears });
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
  const { reason } = req.body;

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

  const mailer = await getMailer();
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

  const mailer = await getMailer();
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