const db = require('../db');
const { parse } = require('csv-parse/sync');

async function getBalances(req, res) {
  try {
    const colsResult = await db.query(
      'SELECT * FROM balance_columns WHERE enabled = TRUE ORDER BY sort_order, id'
    );
    const columns = colsResult.rows;

    // ── Determine data source: monthly_trans if available ─────────────────
    let srcMonth = parseInt(req.query.month) || null;
    let srcYear  = parseInt(req.query.year)  || null;

    // Auto-detect latest month with trans data
    if (!srcMonth || !srcYear) {
      const latest = await db.query(
        'SELECT month, year FROM monthly_trans ORDER BY year DESC, month DESC LIMIT 1'
      );
      if (latest.rows.length) {
        srcMonth = latest.rows[0].month;
        srcYear  = latest.rows[0].year;
      }
    }

    // Check if monthly_trans has data for that month
    let useTransData = false;
    const transMap = {};   // memberId → { savings_cf, loan_ledger_bal, loan_int_cf, comm_bal_cf }

    if (srcMonth && srcYear) {
      const cnt = await db.query(
        'SELECT COUNT(*) AS cnt FROM monthly_trans WHERE month=$1 AND year=$2',
        [srcMonth, srcYear]
      );
      useTransData = parseInt(cnt.rows[0].cnt) > 0;
    }

    if (useTransData) {
      const transRes = await db.query(
        `SELECT member_id, column_key, amount FROM monthly_trans
         WHERE month=$1 AND year=$2
         AND column_key IN ('savings_cf','loan_ledger_bal','loan_int_cf','comm_bal_cf')`,
        [srcMonth, srcYear]
      );
      for (const row of transRes.rows) {
        if (!transMap[row.member_id]) transMap[row.member_id] = {};
        transMap[row.member_id][row.column_key] = parseFloat(row.amount);
      }
    }

    // Map balance_columns fixed keys → monthly_trans C/F keys
    const FIXED_TO_TRANS = {
      savings:      'savings_cf',
      loans:        'loan_ledger_bal',
      loan_interest:'loan_int_cf',
      commodity:    'comm_bal_cf',
      shares:       null,   // no equivalent in trans CSV
    };

    let membersResult;
    if (useTransData) {
      // Only members that have trans data for this month — optimized for 700+ members
      membersResult = await db.query(`
        SELECT m.id, m.ledger_no, m.staff_no, m.full_name
        FROM members m
        WHERE m.is_active = TRUE
        ORDER BY m.ledger_no
      `);
    } else {
      // Fall back to live-computed values — optimized query
      membersResult = await db.query(`
        SELECT
          m.id, m.ledger_no, m.staff_no, m.full_name,
          COALESCE((SELECT SUM(s.amount)  FROM savings s  WHERE s.member_id = m.id), 0) AS savings,
          COALESCE((SELECT SUM(sh.amount) FROM shares sh  WHERE sh.member_id = m.id), 0) AS shares,
          COALESCE((SELECT SUM(l.remaining_balance) FROM loans l WHERE l.member_id = m.id AND l.status = 'active'), 0) AS loans,
          COALESCE((SELECT SUM(l.total_interest - l.interest_paid) FROM loans l WHERE l.member_id = m.id AND l.status = 'active'), 0) AS loan_interest,
          COALESCE((SELECT SUM(c.amount)  FROM commodity c WHERE c.member_id = m.id), 0) AS commodity
        FROM members m
        WHERE m.is_active = TRUE
        ORDER BY m.ledger_no
      `);
    }

    // Pull all custom balance values
    const customResult = await db.query(
      'SELECT member_id, column_key, amount FROM member_custom_balances'
    );
    const customMap = {};
    for (const row of customResult.rows) {
      if (!customMap[row.member_id]) customMap[row.member_id] = {};
      customMap[row.member_id][row.column_key] = parseFloat(row.amount);
    }

    const members = membersResult.rows
      .filter((m) => !useTransData || !!transMap[m.id])
      .map((m) => {
        const custom = customMap[m.id] || {};
        const trans  = transMap[m.id]  || {};
        const result = { ...m };
        for (const col of columns) {
          if (col.type === 'custom') {
            result[col.key] = custom[col.key] ?? 0;
          } else if (useTransData) {
            const transKey = FIXED_TO_TRANS[col.key];
            result[col.key] = transKey !== undefined ? (trans[transKey] ?? 0) : 0;
          }
          // else: already in result from the live-computed SQL query
        }
        return result;
      });

    res.json({
      columns,
      members,
      ...(useTransData ? { dataMonth: srcMonth, dataYear: srcYear } : {}),
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

    res.json({
      message: `${imported} records updated, ${skipped} skipped`,
      imported, skipped, errors,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getBalances, uploadBalances };
