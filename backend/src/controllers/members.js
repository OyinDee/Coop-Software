const db = require('../db');
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

  try {
    const csvText = req.file.buffer.toString('utf-8');
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    let imported = 0;
    let skipped = 0;

    for (const row of records) {
      const ledger_no = row['LEDGER No'] || row['Ledger No'] || row['ledger_no'];
      const full_name = row['Name'] || row['FULL NAME'] || row['full_name'];
      if (!ledger_no || !full_name) { skipped++; continue; }

      try {
        await db.query(`
          INSERT INTO members (ledger_no, staff_no, gifmis_no, full_name, gender, marital_status, phone, email, date_of_admission, bank, account_number, department)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          ON CONFLICT (ledger_no) DO NOTHING
        `, [
          ledger_no.trim(),
          row['Staff No'] || row['STAFF NO'] || null,
          row['GIFMIS No'] || row['GIFMIS NO'] || null,
          full_name.trim(),
          row['Gender'] || row['GENDER'] || null,
          row['MARITAL STATUS'] || row['Marital Status'] || null,
          row['Phone No.'] || row['PHONE'] || null,
          row['FUOYE E-mail Address'] || row['EMAIL'] || null,
          row['Date of Admission'] || null,
          row['BANK'] || row['Bank'] || null,
          row['ACCOUNT NUMBER'] || row['Account Number'] || null,
          row['DEPARTMENT'] || row['Department'] || null,
        ]);
        imported++;
      } catch (e) {
        skipped++;
      }
    }

    res.json({ message: `${imported} members imported, ${skipped} skipped`, imported, skipped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getMembers, getMember, createMember, updateMember, deleteMember, importCSV };
