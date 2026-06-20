const db = require('../db');
const { parse } = require('csv-parse/sync');

async function getBalances(req, res) {
  try {
    const { month, year } = req.query;

    let dataMonth = null;
    let dataYear  = null;

    // Determine which month/year to pull monthly_trans data from
    if (month && year) {
      dataMonth = parseInt(month, 10);
      dataYear  = parseInt(year, 10);
    } else {
      // Use the latest available month/year in monthly_trans
      const latestRes = await db.query(
        'SELECT month, year FROM monthly_trans ORDER BY year DESC, month DESC LIMIT 1'
      );
      if (latestRes.rows.length) {
        dataMonth = latestRes.rows[0].month;
        dataYear  = latestRes.rows[0].year;
      }
    }

    const membersResult = await db.query(`
      SELECT 
        m.id,
        m.full_name,
        m.ledger_no,
        m.staff_no,
        COALESCE(mt_savings.amount,   0) AS net_savings,
        COALESCE(mt_loan_bal.amount,  0) AS loan_ledger_balance,
        COALESCE(l.months_remaining,  0) AS loan_duration,
        COALESCE(mt_loan_int.amount,  0) AS balance_on_interest,
        COALESCE(mt_comm_bal.amount,  0) AS commodity_balance,
        CASE 
          WHEN mt_comm_bal.amount > 0 AND mt_comm_repayment.amount > 0 THEN 
            CEIL(mt_comm_bal.amount / mt_comm_repayment.amount)
          ELSE 0 
        END AS commodity_duration,
        COALESCE(mt_other.amount,     0) AS others
      FROM members m
      LEFT JOIN monthly_trans mt_savings ON
        mt_savings.member_id  = m.id AND
        mt_savings.column_key = 'savings_cf' AND
        mt_savings.month = $1 AND mt_savings.year = $2
      LEFT JOIN monthly_trans mt_loan_bal ON
        mt_loan_bal.member_id  = m.id AND
        mt_loan_bal.column_key = 'loan_ledger_bal' AND
        mt_loan_bal.month = $1 AND mt_loan_bal.year = $2
      LEFT JOIN monthly_trans mt_loan_int ON
        mt_loan_int.member_id  = m.id AND
        mt_loan_int.column_key = 'loan_int_cf' AND
        mt_loan_int.month = $1 AND mt_loan_int.year = $2
      LEFT JOIN monthly_trans mt_comm_bal ON
        mt_comm_bal.member_id  = m.id AND
        mt_comm_bal.column_key = 'comm_bal_cf' AND
        mt_comm_bal.month = $1 AND mt_comm_bal.year = $2
      LEFT JOIN monthly_trans mt_comm_repayment ON
        mt_comm_repayment.member_id  = m.id AND
        mt_comm_repayment.column_key = 'comm_repayment' AND
        mt_comm_repayment.month = $1 AND mt_comm_repayment.year = $2
      LEFT JOIN LATERAL (
        SELECT months_remaining 
        FROM loans l 
        WHERE l.member_id = m.id AND l.status = 'active' 
        ORDER BY l.created_at DESC 
        LIMIT 1
      ) l ON true
      LEFT JOIN monthly_trans mt_other ON
        mt_other.member_id  = m.id AND
        mt_other.column_key = 'other_charges' AND
        mt_other.month = $1 AND mt_other.year = $2
      ORDER BY m.ledger_no
    `, [dataMonth, dataYear]);

    // Fetch enabled custom balance columns
    const colsResult = await db.query(
      "SELECT * FROM balance_columns WHERE enabled = TRUE ORDER BY sort_order, id"
    );

    // Fixed columns (always shown)
    const fixedColumns = [
      { key: 'net_savings',         label: 'Net Savings',          type: 'fixed', sort_order: 1 },
      { key: 'loan_ledger_balance', label: 'Loan Ledger Balance',  type: 'fixed', sort_order: 2 },
      { key: 'loan_duration',       label: 'Loan Duration',        type: 'fixed', sort_order: 3 },
      { key: 'balance_on_interest', label: 'Balance on Interest',  type: 'fixed', sort_order: 4 },
      { key: 'commodity_balance',   label: 'Commodity Balance',    type: 'fixed', sort_order: 5 },
      { key: 'commodity_duration',  label: 'Commodity Duration',   type: 'fixed', sort_order: 6 },
      { key: 'others',              label: 'Others',               type: 'fixed', sort_order: 7 },
    ];

    // Custom columns come after fixed ones
    const customColumns = colsResult.rows
      .filter(c => c.type === 'custom')
      .map(c => ({ key: c.key, label: c.label, type: 'custom', sort_order: c.sort_order }));

    const columns = [...fixedColumns, ...customColumns];

    // Attach custom balance values to each member row
    if (customColumns.length && membersResult.rows.length) {
      const memberIds = membersResult.rows.map(r => r.id);
      const customKeys = customColumns.map(c => c.key);

      const customVals = await db.query(
        `SELECT member_id, column_key, amount
         FROM member_custom_balances
         WHERE member_id = ANY($1) AND column_key = ANY($2)`,
        [memberIds, customKeys]
      );

      // Index by member_id + column_key for O(1) lookup
      const valMap = {};
      for (const row of customVals.rows) {
        valMap[`${row.member_id}:${row.column_key}`] = row.amount;
      }

      for (const member of membersResult.rows) {
        for (const col of customColumns) {
          member[col.key] = valMap[`${member.id}:${col.key}`] ?? 0;
        }
      }
    }

    res.json({
      columns,
      members:   membersResult.rows,
      dataMonth,
      dataYear,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function uploadBalances(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    // Only process enabled custom columns
    const colsResult = await db.query(
      "SELECT * FROM balance_columns WHERE enabled = TRUE AND type = 'custom' ORDER BY sort_order, id"
    );
    const customColumns = colsResult.rows;

    if (!customColumns.length) {
      return res.status(400).json({
        error: 'No custom columns are configured. Add them in Settings first.',
      });
    }

    let csvText = req.file.buffer.toString('utf-8').replace(/^\uFEFF/, '');

    // Your CSV has a merged group-header row (row 0: PERSONAL DETAILS, RECORDS ON SAVINGS…)
    // and the real column headers on row 1 (S/N, L/No, NAME, STAFF No, FORM, OTHER CHARGES…)
    // from_line: 2 tells csv-parse to treat row 1 (1-indexed line 2) as the header row,
    // skipping the merged group-header entirely.
    const records = parse(csvText, {
      columns:           true,
      skip_empty_lines:  true,
      trim:              true,
      relax_column_count: true,
      from_line:         2,   // skip merged group-header row
    });

    let imported = 0, skipped = 0;
    const errors = [];

    const parseAmt = (v) => {
      const n = parseFloat((v || '').toString().replace(/,/g, '').trim());
      return isNaN(n) ? 0 : n;
    };

    // Deduplicate rows by ledger_no (last occurrence wins) to prevent
    // "ON CONFLICT DO UPDATE command cannot affect row a second time"
    const seen = new Map();
    for (const row of records) {
      // Normalise all keys to UPPER for case-insensitive matching
      const r = {};
      for (const k of Object.keys(row)) {
        r[k.trim().toUpperCase()] = (row[k] || '').toString().trim();
      }

      // Your CSV uses "L/No" as the ledger column header
      const ledger_no = (
        r['LEDGER NO'] || r['LEDGER NO.'] || r['L/NO'] || r['LEDGER_NO'] || ''
      ).trim().toUpperCase();

      const staff_no = (
        r['STAFF NO'] || r['STAFF NO.'] || r['STAFF_NO'] || ''
      ).trim().toUpperCase();

      const key = ledger_no || staff_no;
      if (!key) continue; // skip rows with no identifier

      seen.set(key, r); // last row for this key wins
    }

    for (const [key, r] of seen.entries()) {
      const ledger_no = (
        r['LEDGER NO'] || r['LEDGER NO.'] || r['L/NO'] || r['LEDGER_NO'] || ''
      ).trim().toUpperCase();

      const staff_no = (
        r['STAFF NO'] || r['STAFF NO.'] || r['STAFF_NO'] || ''
      ).trim().toUpperCase();

      // Look up member
      let memberRes;
      if (ledger_no) {
        memberRes = await db.query(
          'SELECT id FROM members WHERE UPPER(TRIM(ledger_no)) = $1',
          [ledger_no]
        );
      }
      if ((!memberRes || !memberRes.rows.length) && staff_no) {
        memberRes = await db.query(
          'SELECT id FROM members WHERE UPPER(TRIM(staff_no)) = $1',
          [staff_no]
        );
      }

      if (!memberRes || !memberRes.rows.length) {
        errors.push(`${ledger_no || staff_no}: member not found`);
        skipped++;
        continue;
      }

      const memberId = memberRes.rows[0].id;

      let hasAnyValue = false;
      for (const col of customColumns) {
        const byLabel = r[col.label.toUpperCase()];
        const byKey   = r[col.key.toUpperCase()];
        const raw = byLabel !== undefined ? byLabel : byKey;
        if (raw === undefined) continue;

        const amount = parseAmt(raw);
        await db.query(`
          INSERT INTO member_custom_balances (member_id, column_key, amount, updated_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (member_id, column_key)
          DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()
        `, [memberId, col.key, amount]);
        hasAnyValue = true;
      }

      if (hasAnyValue) imported++; else skipped++;
    }

    res.json({
      message: `${imported} member${imported !== 1 ? 's' : ''} updated, ${skipped} skipped`,
      imported,
      skipped,
      total: imported + skipped,
      errors,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getBalances, uploadBalances };