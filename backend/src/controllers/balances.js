const db = require('../db');
const { parse } = require('csv-parse/sync');

async function getBalances(req, res) {
  try {
    // Get only the required columns for balances
    const membersResult = await db.query(`
      SELECT 
        m.id,
        m.full_name AS name,
        m.ledger_no,
        m.staff_no,
        COALESCE(mt_savings.amount, 0) AS net_savings,
        COALESCE(mt_loan_bal.amount, 0) AS loan_ledger_balance,
        COALESCE(l.months_remaining, 0) AS loan_duration,
        COALESCE(mt_loan_int.amount, 0) AS balance_on_interest,
        COALESCE(mt_comm_bal.amount, 0) AS commodity_balance,
        CASE 
          WHEN mt_comm_bal.amount > 0 AND mt_comm_repayment.amount > 0 THEN 
            CEIL(mt_comm_bal.amount / mt_comm_repayment.amount)
          ELSE 0 
        END AS commodity_duration,
        COALESCE(mt_other.amount, 0) AS others
      FROM members m
      LEFT JOIN monthly_trans mt_savings ON mt_savings.member_id = m.id AND mt_savings.column_key = 'savings_cf' 
        AND mt_savings.month = (SELECT month FROM monthly_trans ORDER BY year DESC, month DESC LIMIT 1) 
        AND mt_savings.year = (SELECT year FROM monthly_trans ORDER BY year DESC, month DESC LIMIT 1)
      LEFT JOIN monthly_trans mt_loan_bal ON mt_loan_bal.member_id = m.id AND mt_loan_bal.column_key = 'loan_ledger_bal'
        AND mt_loan_bal.month = (SELECT month FROM monthly_trans ORDER BY year DESC, month DESC LIMIT 1) 
        AND mt_loan_bal.year = (SELECT year FROM monthly_trans ORDER BY year DESC, month DESC LIMIT 1)
      LEFT JOIN monthly_trans mt_loan_int ON mt_loan_int.member_id = m.id AND mt_loan_int.column_key = 'loan_int_cf'
        AND mt_loan_int.month = (SELECT month FROM monthly_trans ORDER BY year DESC, month DESC LIMIT 1) 
        AND mt_loan_int.year = (SELECT year FROM monthly_trans ORDER BY year DESC, month DESC LIMIT 1)
      LEFT JOIN monthly_trans mt_comm_bal ON mt_comm_bal.member_id = m.id AND mt_comm_bal.column_key = 'comm_bal_cf'
        AND mt_comm_bal.month = (SELECT month FROM monthly_trans ORDER BY year DESC, month DESC LIMIT 1) 
        AND mt_comm_bal.year = (SELECT year FROM monthly_trans ORDER BY year DESC, month DESC LIMIT 1)
      LEFT JOIN monthly_trans mt_comm_repayment ON mt_comm_repayment.member_id = m.id AND mt_comm_repayment.column_key = 'comm_repayment'
        AND mt_comm_repayment.month = (SELECT month FROM monthly_trans ORDER BY year DESC, month DESC LIMIT 1) 
        AND mt_comm_repayment.year = (SELECT year FROM monthly_trans ORDER BY year DESC, month DESC LIMIT 1)
      LEFT JOIN LATERAL (
        SELECT months_remaining 
        FROM loans l 
        WHERE l.member_id = m.id AND l.status = 'active' 
        ORDER BY l.created_at DESC 
        LIMIT 1
      ) l ON true
      LEFT JOIN monthly_trans mt_other ON mt_other.member_id = m.id AND mt_other.column_key = 'other_charges'
        AND mt_other.month = (SELECT month FROM monthly_trans ORDER BY year DESC, month DESC LIMIT 1) 
        AND mt_other.year = (SELECT year FROM monthly_trans ORDER BY year DESC, month DESC LIMIT 1)
      -- Include all members (active and deactivated) to show their balances
      ORDER BY m.ledger_no
    `);

    // Define the fixed columns for balances (no totals)
    const columns = [
      { key: 'name', label: 'NAME', enabled: true, sort_order: 1, type: 'fixed' },
      { key: 'ledger_no', label: 'LEDGER No', enabled: true, sort_order: 2, type: 'fixed' },
      { key: 'staff_no', label: 'STAFF No', enabled: true, sort_order: 3, type: 'fixed' },
      { key: 'net_savings', label: 'Net savings (TOTAL SAVINGS)', enabled: true, sort_order: 4, type: 'fixed' },
      { key: 'loan_ledger_balance', label: 'LOAN LEDGER BALANCE', enabled: true, sort_order: 5, type: 'fixed' },
      { key: 'loan_duration', label: 'LOAN DURATION', enabled: true, sort_order: 6, type: 'fixed' },
      { key: 'balance_on_interest', label: 'BALANCE ON INTEREST', enabled: true, sort_order: 7, type: 'fixed' },
      { key: 'commodity_balance', label: 'COMMODITY BALANCE', enabled: true, sort_order: 8, type: 'fixed' },
      { key: 'commodity_duration', label: 'COMMODITY DURATION', enabled: true, sort_order: 9, type: 'fixed' },
      { key: 'others', label: 'OTHERS', enabled: true, sort_order: 10, type: 'fixed' }
    ];

    res.json({
      columns,
      members: membersResult.rows,
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
        error: 'No custom columns are configured. Balances upload only updates custom balance columns. For full monthly payroll/transaction CSV, use Deductions upload.'
      });
    }

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

    for (const row of records) {
      // Normalise keys to UPPER for case-insensitive matching
      const r = {};
      for (const k of Object.keys(row)) r[k.trim().toUpperCase()] = (row[k] || '').toString().trim();

      const ledger_no = (r['LEDGER NO'] || r['LEDGER NO.'] || r['L/NO'] || r['LEDGER_NO'] || '').trim();
      const staff_no  = (r['STAFF NO']  || r['STAFF NO.']  || r['STAFF_NO']  || '').trim();

      if (!ledger_no && !staff_no) { skipped++; continue; }

      let memberRes;
      if (ledger_no) memberRes = await db.query(
        'SELECT id FROM members WHERE UPPER(TRIM(ledger_no)) = $1', [ledger_no.toUpperCase()]
      );
      if ((!memberRes || !memberRes.rows.length) && staff_no) memberRes = await db.query(
        'SELECT id FROM members WHERE UPPER(TRIM(staff_no)) = $1', [staff_no.toUpperCase()]
      );

      if (!memberRes || !memberRes.rows.length) {
        errors.push(`${ledger_no || staff_no}: member not found`);
        skipped++; continue;
      }
      const memberId = memberRes.rows[0].id;

      // For each enabled custom column attempt to read its value from the CSV
      // Accept both the column label (upper) and the column key (upper) as header names
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

    const totalProcessed = imported + skipped;
    const successRate = totalProcessed > 0 ? Math.round((imported / totalProcessed) * 100) : 0;
    
    res.json({
      message: `${imported} member${imported !== 1 ? 's' : ''} updated, ${skipped} skipped`,
      imported,
      skipped,
      total: totalProcessed,
      successRate,
      errors,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getBalances, uploadBalances };
