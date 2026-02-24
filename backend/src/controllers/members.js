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

    // Helper: get value by case-insensitive key
    const colNames = records.length > 0 ? Object.keys(records[0]).map(k => k.trim()) : [];

    for (const row of records) {
      // Normalise all column names to UPPERCASE + trimmed for case-insensitive matching
      const r = {};
      for (const k of Object.keys(row)) r[k.trim().toUpperCase()] = (row[k] || '').toString().trim();

      const ledger_no = r['LEDGER NO'] || r['LEDGER_NO'] || r['LEDGER NO.'] || r['LEDGER'];
      const staff_no  = r['STAFF NO']  || r['STAFF_NO']  || r['STAFF NO.'] || r['STAFF'];
      if (!ledger_no && !staff_no) {
        // Report first skipped row's available columns to help debug
        if (skipped === 0) {
          errors.push(`Row skipped: could not find 'LEDGER NO' or 'STAFF NO' column. Available columns: ${colNames.join(', ')}`);
        }
        skipped++;
        continue;
      }

      // Look up member by ledger_no first, then staff_no
      let memberRes;
      if (ledger_no) {
        memberRes = await db.query('SELECT id FROM members WHERE UPPER(TRIM(ledger_no))=$1', [ledger_no.toUpperCase()]);
      }
      if ((!memberRes || !memberRes.rows.length) && staff_no) {
        memberRes = await db.query('SELECT id FROM members WHERE UPPER(TRIM(staff_no))=$1', [staff_no.toUpperCase()]);
      }
      if (!memberRes || !memberRes.rows.length) {
        errors.push(`${ledger_no || staff_no}: member not found`);
        skipped++;
        continue;
      }
      const memberId = memberRes.rows[0].id;

      const parseAmt = (v) => { const n = parseFloat((v || '').toString().replace(/,/g, '')); return isNaN(n) ? 0 : n; };
      const savings   = parseAmt(r['SAVINGS']);
      const shares    = parseAmt(r['SHARES']);
      const loan      = parseAmt(r['LOAN']);
      const loanInt   = parseAmt(r['LN INT'] || r['LN INTEREST'] || r['LOAN INTEREST'] || r['LNINT'] || r['LOAN INT']);
      const commodity = parseAmt(r['COMM'] || r['COMMODITY']);
      const others    = parseAmt(r['OTHERS'] || r['OTHER']);

      // Use month=1, year=2026 as the "opening balance" period for savings/shares/commodity
      // ON CONFLICT DO UPDATE so re-importing updates the opening balance
      const OB_MONTH = 1, OB_YEAR = 2026;

      const client = await db.getClient();
      try {
        await client.query('BEGIN');

        if (savings > 0) {
          await client.query(`
            INSERT INTO savings (member_id, amount, month, year, description)
            VALUES ($1,$2,$3,$4,'Opening Balance')
            ON CONFLICT (member_id, month, year) DO UPDATE SET amount=EXCLUDED.amount
          `, [memberId, savings, OB_MONTH, OB_YEAR]);
        }

        if (shares > 0) {
          await client.query(`
            INSERT INTO shares (member_id, amount, month, year)
            VALUES ($1,$2,$3,$4)
            ON CONFLICT (member_id, month, year) DO UPDATE SET amount=EXCLUDED.amount
          `, [memberId, shares, OB_MONTH, OB_YEAR]);
        }

        if (loan > 0) {
          // Remove any previous opening-balance loan for this member before re-importing
          await client.query(`DELETE FROM loans WHERE member_id=$1 AND description='Opening Balance'`, [memberId]);
          const months = 12;
          await client.query(`
            INSERT INTO loans
              (member_id, principal, months, remaining_balance,
               monthly_principal, total_interest, monthly_interest,
               interest_paid, months_paid, status, date_issued, description)
            VALUES ($1,$2,$3,$2, $4,$5,$6, 0,0,'active', '2026-01-01', 'Opening Balance')
          `, [memberId, loan, months, loan / months, loanInt, loanInt / months]);
        }

        if (commodity > 0) {
          await client.query(`
            INSERT INTO commodity (member_id, amount, month, year, description)
            VALUES ($1,$2,$3,$4,'Opening Balance')
          `, [memberId, commodity, OB_MONTH, OB_YEAR]);
        }

        if (others > 0) {
          // Store "Others" as a separate commodity line
          await client.query(`
            INSERT INTO commodity (member_id, amount, month, year, description)
            VALUES ($1,$2,$3,$4,'Opening Balance – Others')
          `, [memberId, others, OB_MONTH, OB_YEAR]);
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
