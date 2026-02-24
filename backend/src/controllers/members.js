const db = require('../db');
// loans table needs optional description column – add it if it doesn't exist
// (run once on startup, harmless if already present)
db.query(`ALTER TABLE loans ADD COLUMN IF NOT EXISTS description TEXT`).catch(() => {});

const { parse } = require('csv-parse/sync');

async function getMembers(req, res) {
  const { search } = req.query;
  try {
    let query = `
      SELECT
        m.*,
        COALESCE(SUM(s.amount), 0) AS total_savings,
        COALESCE(SUM(l.remaining_balance), 0) AS loan_balance,
        COALESCE(SUM(l.total_interest - l.interest_paid), 0) AS interest_due,
        COUNT(CASE WHEN l.status = 'active' THEN 1 END) AS active_loans
      FROM members m
      LEFT JOIN savings s ON s.member_id = m.id
      LEFT JOIN loans l ON l.member_id = m.id AND l.status = 'active'
      WHERE m.is_active = TRUE
    `;
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (m.full_name ILIKE $1 OR m.ledger_no ILIKE $1 OR m.staff_no ILIKE $1)`;
    }
    query += ` GROUP BY m.id ORDER BY m.ledger_no`;
    const result = await db.query(query, params);
    res.json({ members: result.rows, total: result.rowCount });
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
        COALESCE((SELECT SUM(s.amount) FROM savings s WHERE s.member_id = m.id), 0) AS total_savings,
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
    await db.query('UPDATE members SET is_active = FALSE WHERE id = $1', [id]);
    res.json({ message: 'Member deactivated' });
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

    res.json({ message: `${imported} members imported, ${skipped} skipped`, imported, skipped, errors });
  } catch (err) {
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
        // loanBF = remaining balance going INTO Jan 2026 (B/F)
        // monthlyPrincipal = deduction per month
        // months = how many more months the loan runs (including Jan 2026)
        if (loanBF > 0 && monthlyPrincipal > 0) {
          await client.query(`DELETE FROM loans WHERE member_id=$1 AND description='Opening Balance'`, [memberId]);
          const months = Math.ceil(loanBF / monthlyPrincipal);
          await client.query(`
            INSERT INTO loans
              (member_id, principal, months, remaining_balance,
               monthly_principal, total_interest, monthly_interest,
               interest_paid, months_paid, status, date_issued, description)
            VALUES ($1,$2,$3,$2,$4,$5,$6,0,0,'active','2026-01-01','Opening Balance')
          `, [memberId, loanBF, months, monthlyPrincipal, loanIntBF, monthlyInterest]);
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

    res.json({ message: `${imported} members updated, ${skipped} skipped`, imported, skipped, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getMembers, getMember, createMember, updateMember, deleteMember, importCSV, importBalances };
