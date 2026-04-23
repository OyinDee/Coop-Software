const db = require('../db');
const nodemailer = require('nodemailer');
// loans table needs optional description column – add it if it doesn't exist
// (run once on startup, harmless if already present)
db.query(`ALTER TABLE loans ADD COLUMN IF NOT EXISTS description TEXT`).catch(() => {});

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

function getMailer() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;

  if (!host || !port || !user || !pass || !from) {
    return { error: 'Missing SMTP configuration. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.' };
  }

  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  return { transporter, from };
}

async function getMonthlyReport(memberId, month, year) {
  const memberRes = await db.query(
    `SELECT id, full_name, ledger_no, staff_no, email FROM members WHERE id=$1`,
    [memberId]
  );
  const member = memberRes.rows[0];
  if (!member) {
    return null;
  }

  const transRes = await db.query(
    `SELECT column_key, amount FROM monthly_trans WHERE member_id=$1 AND month=$2 AND year=$3`,
    [memberId, month, year]
  );
  const sharesRes = await db.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM shares WHERE member_id=$1 AND month=$2 AND year=$3`,
    [memberId, month, year]
  );

  const values = {};
  for (const row of transRes.rows) {
    values[row.column_key] = parseFloat(row.amount) || 0;
  }

  const shares = parseFloat(sharesRes.rows[0]?.total) || 0;
  const report = {
    savings_withdrawal: values.savings_withdrawal || 0,
    savings_add: values.savings_add || 0,
    savings_add_bank: values.savings_add_bank || 0,
    shares,
    loan_granted: values.loan_granted || 0,
    loan_int_charged: values.loan_int_charged || 0,
    loan_repayment: values.loan_repayment || 0,
    loan_repayment_bank: values.loan_repayment_bank || 0,
    loan_int_paid: values.loan_int_paid || 0,
    comm_add: values.comm_add || 0,
    comm_repayment: values.comm_repayment || 0,
    comm_repayment_bank: values.comm_repayment_bank || 0,
    form: values.form || 0,
    other_charges: values.other_charges || 0,
    total_deduction: values.total_deduction || 0,
    savings_cf: values.savings_cf || 0,
    loan_ledger_bal: values.loan_ledger_bal || 0,
    loan_int_cf: values.loan_int_cf || 0,
    comm_bal_cf: values.comm_bal_cf || 0,
  };

  const subjectPeriod = `${MONTH_LABELS[month - 1]} ${year}`;
  const subject = `Monthly Cooperative Report - ${subjectPeriod}`;

  const csvHeaders = [
    'MONTH',
    'MEMBER_NAME',
    'LEDGER_NO',
    'STAFF_NO',
    'SAVINGS_WITHDRAWAL',
    'SAVINGS_ADD',
    'SAVINGS_ADD_BANK',
    'SHARES',
    'LOAN_GRANTED',
    'LOAN_INTEREST_CHARGED',
    'LOAN_REPAYMENT',
    'LOAN_REPAYMENT_BANK',
    'LOAN_INTEREST_PAID',
    'COMMODITY_ADD',
    'COMMODITY_REPAYMENT',
    'COMMODITY_REPAYMENT_BANK',
    'FORM',
    'OTHER_CHARGES',
    'TOTAL_DEDUCTION',
    'SAVINGS_BALANCE_CF',
    'LOAN_BALANCE_CF',
    'LOAN_INTEREST_BALANCE_CF',
    'COMMODITY_BALANCE_CF'
  ];

  const csvData = [
    subjectPeriod,
    member.full_name || '',
    member.ledger_no || '',
    member.staff_no || '',
    report.savings_withdrawal,
    report.savings_add,
    report.savings_add_bank,
    report.shares,
    report.loan_granted,
    report.loan_int_charged,
    report.loan_repayment,
    report.loan_repayment_bank,
    report.loan_int_paid,
    report.comm_add,
    report.comm_repayment,
    report.comm_repayment_bank,
    report.form,
    report.other_charges,
    report.total_deduction,
    report.savings_cf,
    report.loan_ledger_bal,
    report.loan_int_cf,
    report.comm_bal_cf,
  ];

  const csvContent = `${csvHeaders.join(',')}\n${csvData.join(',')}`;

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
      <h2 style="margin: 0 0 12px;">Monthly Cooperative Report</h2>
      <p style="margin: 0 0 10px;">Dear ${member.full_name || 'Member'},</p>
      <p style="margin: 0 0 16px;">Your report for <strong>${subjectPeriod}</strong> is attached as CSV.</p>
      <table style="border-collapse: collapse; width: 100%; max-width: 640px;">
        <tr><td style="border: 1px solid #ddd; padding: 8px;">Savings Balance C/F</td><td style="border: 1px solid #ddd; padding: 8px;">${report.savings_cf.toFixed(2)}</td></tr>
        <tr><td style="border: 1px solid #ddd; padding: 8px;">Loan Balance C/F</td><td style="border: 1px solid #ddd; padding: 8px;">${report.loan_ledger_bal.toFixed(2)}</td></tr>
        <tr><td style="border: 1px solid #ddd; padding: 8px;">Interest Balance C/F</td><td style="border: 1px solid #ddd; padding: 8px;">${report.loan_int_cf.toFixed(2)}</td></tr>
        <tr><td style="border: 1px solid #ddd; padding: 8px;">Commodity Balance C/F</td><td style="border: 1px solid #ddd; padding: 8px;">${report.comm_bal_cf.toFixed(2)}</td></tr>
        <tr><td style="border: 1px solid #ddd; padding: 8px;">Total Deduction</td><td style="border: 1px solid #ddd; padding: 8px;">${report.total_deduction.toFixed(2)}</td></tr>
      </table>
    </div>
  `;

  const text = [
    `Monthly Cooperative Report - ${subjectPeriod}`,
    `Member: ${member.full_name || ''}`,
    `Ledger: ${member.ledger_no || ''}`,
    `Savings Balance C/F: ${report.savings_cf.toFixed(2)}`,
    `Loan Balance C/F: ${report.loan_ledger_bal.toFixed(2)}`,
    `Interest Balance C/F: ${report.loan_int_cf.toFixed(2)}`,
    `Commodity Balance C/F: ${report.comm_bal_cf.toFixed(2)}`,
    `Total Deduction: ${report.total_deduction.toFixed(2)}`,
  ].join('\n');

  return {
    member,
    subject,
    text,
    html,
    attachmentName: `${member.ledger_no || member.id}-monthly-report-${year}-${String(month).padStart(2, '0')}.csv`,
    attachmentContent: csvContent,
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
  const { search, page = 1, limit = 100 } = req.query;
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

  // Parse a flexible date string into a YYYY-MM-DD string Postgres accepts, or null
  function parseDate(raw) {
    if (!raw) return null;
    const s = raw.trim();
    if (!s) return null;

    // Already ISO or DD/MM/YYYY-ish
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    // "Aug/2016" → 1 Aug 2016
    const mmm_yyyy = s.match(/^([A-Za-z]{3})[\/\-](\d{4})$/);
    if (mmm_yyyy) {
      const d = new Date(`1 ${mmm_yyyy[1]} ${mmm_yyyy[2]}`);
      if (!isNaN(d)) return d.toISOString().split('T')[0];
    }

    // Try generic parse
    const d = new Date(s);
    if (!isNaN(d)) return d.toISOString().split('T')[0];

    return null;
  }

  try {
    // Strip BOM if present
    let csvText = req.file.buffer.toString('utf-8').replace(/^\uFEFF/, '');

    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });

    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (const row of records) {
      // Normalise all keys: trim whitespace so "DEPARTMENT " matches
      const r = {};
      for (const k of Object.keys(row)) r[k.trim()] = row[k];

      const ledger_no = r['LEDGER No'] || r['Ledger No'] || r['ledger_no'];
      const full_name = r['Name'] || r['FULL NAME'] || r['full_name'];
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
          r['Staff No']  || r['STAFF NO']  || null,
          r['GIFMIS No'] || r['GIFMIS NO'] || null,
          full_name.trim(),
          r['Gender']   || r['GENDER']    || null,
          r['MARITAL STATUS'] || r['Marital Status'] || null,
          r['Phone No.'] || r['PHONE'] || r['Phone']  || null,
          r['FUOYE E-mail Address'] || r['Email'] || r['EMAIL'] || null,
          date_of_admission,
          r['BANK']  || r['Bank']  || null,
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

    console.log('Members import successful, sending response:', { imported, skipped, errors });
    res.json({ ok: true, message: `${imported} members imported, ${skipped} skipped`, imported, skipped, errors });
  } catch (err) {
    console.error('Members import error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function importBalances(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    let csvText = req.file.buffer.toString('utf-8').replace(/^\uFEFF/, '');
    const records = parse(csvText, {
      columns: true, skip_empty_lines: true, trim: true, relax_column_count: true,
    });

    let imported = 0, skipped = 0;
    const errors = [];

    const parseAmt = (v) => {
      const n = parseFloat((v || '').toString().replace(/,/g, '').trim());
      return isNaN(n) ? 0 : n;
    };

    // Detect trans-sheet format (has 'L/No' column) vs simple balance format
    const firstRowKeys = records.length > 0
      ? Object.keys(records[0]).map(k => k.trim().toUpperCase())
      : [];
    const isTransFormat = firstRowKeys.some(k => k === 'L/NO');

    for (const row of records) {
      // Normalise all column names to UPPERCASE + trimmed
      const r = {};
      for (const k of Object.keys(row)) r[k.trim().toUpperCase()] = (row[k] || '').toString().trim();

      // Skip sub-header rows and totals rows — S/N must be a positive integer
      const sn = (r['S/N'] || r['S/N.'] || '').trim();
      if (!/^\d+$/.test(sn)) { skipped++; continue; }

      const ledger_no = (r['L/NO'] || r['LEDGER NO'] || r['LEDGER NO.'] || r['LEDGER_NO'] || r['LEDGER'] || '').trim();
      const staff_no  = (r['STAFF NO'] || r['STAFF NO.'] || r['STAFF_NO'] || r['STAFF'] || '').trim();
      const full_name = (r['NAME'] || r['FULL NAME'] || '').trim();
      const gifmis_no = (r['IPPIS NO'] || r['IPPIS NO.'] || r['GIFMIS NO'] || r['GIFMIS NO.'] || '').trim();

      if (!ledger_no && !staff_no) {
        errors.push(`Row ${sn}: no ledger or staff number found`);
        skipped++; continue;
      }

      // ── Look up member by ledger_no first, then staff_no ───────────────────
      let memberRes;
      if (ledger_no) memberRes = await db.query(
        'SELECT id FROM members WHERE UPPER(TRIM(ledger_no))=$1', [ledger_no.toUpperCase()]);
      if ((!memberRes || !memberRes.rows.length) && staff_no) memberRes = await db.query(
        'SELECT id FROM members WHERE UPPER(TRIM(staff_no))=$1', [staff_no.toUpperCase()]);

      if (!memberRes || !memberRes.rows.length) {
        errors.push(`${ledger_no || staff_no}: member not found — import members first via Import CSV`);
        skipped++; continue;
      }
      const memberId = memberRes.rows[0].id;

      // ── Parse amounts from the correct columns based on format ────────────
      let savingsBF, monthlySavings, loanBF, monthlyPrincipal, loanIntBF, monthlyInterest, commBF;

      if (isTransFormat) {
        savingsBF       = parseAmt(r['SAVINGS B/F']);
        monthlySavings  = parseAmt(r['ADD: SAVINGS DURING THE MONTH']);
        loanBF          = parseAmt(r['LOAN PRIN. BAL. B/F']);
        monthlyPrincipal= parseAmt(r['LESS: LOAN PRINCIPAL REPAYMENT']);
        loanIntBF       = parseAmt(r['LOAN INTEREST BALANCE B/F']);
        monthlyInterest = parseAmt(r['LESS: LOAN INTEREST PAID THIS MONTH']);
        commBF          = parseAmt(r['COMMODITY SALES BAL. B/F']);
      } else {
        // Simple format — treat as Jan 2026 opening values directly
        savingsBF       = 0;
        monthlySavings  = parseAmt(r['SAVINGS']);
        loanBF          = parseAmt(r['LOAN']);
        monthlyPrincipal= loanBF > 0 ? parseAmt(r['MONTHLY PRINCIPAL'] || r['MONTHLY_PRINCIPAL']) || loanBF / 12 : 0;
        loanIntBF       = parseAmt(r['LN INT'] || r['LN INTEREST'] || r['LOAN INTEREST'] || r['LOAN INT']);
        monthlyInterest = loanIntBF > 0 ? loanIntBF / 12 : 0;
        commBF          = parseAmt(r['COMM'] || r['COMMODITY']);
      }

      const client = await db.getClient();
      try {
        await client.query('BEGIN');

        // ── SAVINGS ──────────────────────────────────────────────────────────
        // Store prior accumulated total as Dec 2025 record (so cumulative total is correct)
        // Store the recurring monthly contribution as the Jan 2026 record (carries forward)
        if (savingsBF > 0) {
          await client.query(`
            INSERT INTO savings (member_id, amount, month, year, description)
            VALUES ($1,$2,12,2025,'Balance B/F')
            ON CONFLICT (member_id, month, year) DO UPDATE SET amount=EXCLUDED.amount
          `, [memberId, savingsBF]);
        }
        if (monthlySavings > 0) {
          await client.query(`
            INSERT INTO savings (member_id, amount, month, year, description)
            VALUES ($1,$2,1,2026,'Opening Balance')
            ON CONFLICT (member_id, month, year) DO UPDATE SET amount=EXCLUDED.amount
          `, [memberId, monthlySavings]);
        }

        // ── LOAN ─────────────────────────────────────────────────────────────
        // loanBF           = Loan Prin. Bal. B/F  (owed before Jan payment)
        // monthlyPrincipal = LESS: Loan Principal Repayment (Jan deduction)
        // loanIntBF        = Loan Interest Balance B/F (interest owed before Jan)
        // monthlyInterest  = LESS: Loan Interest paid this month (Jan interest paid)
        //
        // We store the loan with the B/F principal, then immediately apply the
        // January repayment so remaining_balance, months_paid and interest_paid
        // are all correct going into February.
        if (loanBF > 0 && monthlyPrincipal > 0) {
          await client.query(`DELETE FROM loans WHERE member_id=$1 AND description='Opening Balance'`, [memberId]);
          const months = Math.ceil(loanBF / monthlyPrincipal);
          // Jan principal payment may be less than monthly_principal if it's also the last month
          const janPrincipal = Math.min(monthlyPrincipal, loanBF);
          const janInterest  = monthlyInterest;
          const balanceAfterJan = loanBF - janPrincipal;
          const intBalanceAfterJan = Math.max(loanIntBF - janInterest, 0);
          const loanStatus = balanceAfterJan <= 0 ? 'cleared' : 'active';

          const loanRow = await client.query(`
            INSERT INTO loans
              (member_id, principal, months, remaining_balance,
               monthly_principal, total_interest, monthly_interest,
               interest_paid, months_paid, status, date_issued, description)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,'2026-01-01','Opening Balance')
            RETURNING id
          `, [
            memberId,
            loanBF,          // principal = B/F (starting point for our records)
            months,
            balanceAfterJan, // remaining after Jan payment
            monthlyPrincipal,
            loanIntBF,       // total_interest = interest owed at B/F point
            monthlyInterest,
            janInterest,     // interest_paid = Jan interest paid
            loanStatus,
          ]);

          // Record the January repayment explicitly
          if (janPrincipal > 0 || janInterest > 0) {
            await client.query(`
              INSERT INTO loan_repayments (loan_id, member_id, principal_paid, interest_paid, month, year)
              VALUES ($1,$2,$3,$4,1,2026)
            `, [loanRow.rows[0].id, memberId, janPrincipal, janInterest]);
          }
        }

        // ── COMMODITY ────────────────────────────────────────────────────────
        // Store commodity balance B/F as Dec 2025 so it shows in the ledger
        if (commBF > 0) {
          await client.query(
            `DELETE FROM commodity WHERE member_id=$1 AND month=12 AND year=2025 AND description='Balance B/F'`,
            [memberId]
          );
          await client.query(`
            INSERT INTO commodity (member_id, amount, month, year, description)
            VALUES ($1,$2,12,2025,'Balance B/F')
          `, [memberId, commBF]);
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

    console.log('Balances import successful, sending response:', { imported, skipped, errors });
    res.json({ ok: true, message: `${imported} members updated, ${skipped} skipped`, imported, skipped, errors });
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
