const db = require('../db');
const { parse } = require('csv-parse/sync');

async function getBalances(req, res) {
  try {
    const { month, year } = req.query;

    // Default to latest month/year that has any data, or current date
    let m, y;
    if (month && year) {
      m = parseInt(month, 10);
      y = parseInt(year, 10);
    } else {
      const latestRes = await db.query(
        `SELECT month, year FROM monthly_trans ORDER BY year DESC, month DESC LIMIT 1`
      );
      if (latestRes.rows.length) {
        m = latestRes.rows[0].month;
        y = latestRes.rows[0].year;
      } else {
        m = new Date().getMonth() + 1;
        y = new Date().getFullYear();
      }
    }

    const result = await db.query(`
      SELECT
        m.id,
        m.ledger_no,
        m.staff_no,
        m.full_name,

        -- ── SAVINGS ──────────────────────────────────────────────────────
        -- Savings B/F: from monthly_trans (pre-computed running balance)
        COALESCE((
          SELECT mt.amount FROM monthly_trans mt
          WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2
            AND mt.column_key = 'savings_bf' LIMIT 1
        ), 0) AS savings_bf,

        -- Savings added this month
        COALESCE((
          SELECT mt.amount FROM monthly_trans mt
          WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2
            AND mt.column_key = 'savings_add' LIMIT 1
        ), COALESCE(s.amount, 0)) AS savings_this_month,

        -- Savings added via bank this month
        COALESCE((
          SELECT mt.amount FROM monthly_trans mt
          WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2
            AND mt.column_key = 'savings_add_bank' LIMIT 1
        ), 0) AS savings_bank,

        -- Net Savings C/F (pre-computed)
        COALESCE((
          SELECT mt.amount FROM monthly_trans mt
          WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2
            AND mt.column_key = 'savings_cf' LIMIT 1
        ), 0) AS net_savings_cf,

        -- ── LOAN PRINCIPAL ───────────────────────────────────────────────
        -- Loan Principal B/F (pre-computed)
        COALESCE((
          SELECT mt.amount FROM monthly_trans mt
          WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2
            AND mt.column_key = 'loan_bal_bf' LIMIT 1
        ), 0) AS loan_bal_bf,

        -- Loan granted this month
        COALESCE((
          SELECT mt.amount FROM monthly_trans mt
          WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2
            AND mt.column_key = 'loan_granted' LIMIT 1
        ), 0) AS loan_granted,

        -- Loan principal repayment this month (cash)
        COALESCE((
          SELECT mt.amount FROM monthly_trans mt
          WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2
            AND mt.column_key = 'loan_repayment' LIMIT 1
        ), 0) AS loan_repayment,

        -- Loan principal repayment this month (bank)
        COALESCE((
          SELECT mt.amount FROM monthly_trans mt
          WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2
            AND mt.column_key = 'loan_repayment_bank' LIMIT 1
        ), 0) AS loan_repayment_bank,

        -- Loan Ledger Balance C/F (pre-computed)
        COALESCE((
          SELECT mt.amount FROM monthly_trans mt
          WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2
            AND mt.column_key = 'loan_ledger_bal' LIMIT 1
        ), 0) AS loan_ledger_bal,

        -- Loan duration (from monthly_trans or loans table fallback)
        COALESCE((
          SELECT mt.amount FROM monthly_trans mt
          WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2
            AND mt.column_key = 'loan_duration' LIMIT 1
        ), COALESCE((
          SELECT months_remaining FROM loans l
          WHERE l.member_id = m.id AND l.status = 'active'
          ORDER BY l.date_issued DESC LIMIT 1
        ), 0)) AS loan_duration,

        -- ── LOAN INTEREST ────────────────────────────────────────────────
        -- Interest B/F (pre-computed)
        COALESCE((
          SELECT mt.amount FROM monthly_trans mt
          WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2
            AND mt.column_key = 'loan_int_bf' LIMIT 1
        ), 0) AS loan_int_bf,

        -- Interest charged this month
        COALESCE((
          SELECT mt.amount FROM monthly_trans mt
          WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2
            AND mt.column_key = 'loan_int_charged' LIMIT 1
        ), 0) AS loan_int_charged,

        -- Interest paid this month (cash)
        COALESCE((
          SELECT mt.amount FROM monthly_trans mt
          WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2
            AND mt.column_key = 'loan_int_paid' LIMIT 1
        ), 0) AS loan_int_paid,

        -- Interest paid this month (bank)
        COALESCE((
          SELECT mt.amount FROM monthly_trans mt
          WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2
            AND mt.column_key = 'loan_int_paid_bank' LIMIT 1
        ), 0) AS loan_int_paid_bank,

        -- Interest Balance C/F (pre-computed)
        COALESCE((
          SELECT mt.amount FROM monthly_trans mt
          WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2
            AND mt.column_key = 'loan_int_cf' LIMIT 1
        ), 0) AS loan_int_cf,

        -- ── COMMODITY ────────────────────────────────────────────────────
        -- Commodity B/F (pre-computed)
        COALESCE((
          SELECT mt.amount FROM monthly_trans mt
          WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2
            AND mt.column_key = 'comm_bal_bf' LIMIT 1
        ), 0) AS comm_bal_bf,

        -- Commodity added this month
        COALESCE((
          SELECT mt.amount FROM monthly_trans mt
          WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2
            AND mt.column_key = 'comm_add' LIMIT 1
        ), COALESCE(c.amount, 0)) AS comm_add,

        -- Commodity repayment (cash)
        COALESCE((
          SELECT mt.amount FROM monthly_trans mt
          WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2
            AND mt.column_key = 'comm_repayment' LIMIT 1
        ), 0) AS comm_repayment,

        -- Commodity repayment (bank)
        COALESCE((
          SELECT mt.amount FROM monthly_trans mt
          WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2
            AND mt.column_key = 'comm_repayment_bank' LIMIT 1
        ), 0) AS comm_repayment_bank,

        -- Commodity Balance C/F (pre-computed)
        COALESCE((
          SELECT mt.amount FROM monthly_trans mt
          WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2
            AND mt.column_key = 'comm_bal_cf' LIMIT 1
        ), 0) AS comm_bal_cf,

        -- Commodity duration
        CASE
          WHEN COALESCE((
            SELECT mt.amount FROM monthly_trans mt
            WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2
              AND mt.column_key = 'comm_bal_cf' LIMIT 1
          ), 0) > 0
          AND COALESCE((
            SELECT mt.amount FROM monthly_trans mt
            WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2
              AND mt.column_key = 'comm_repayment' LIMIT 1
          ), 0) > 0
          THEN CEIL(
            COALESCE((
              SELECT mt.amount FROM monthly_trans mt
              WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2
                AND mt.column_key = 'comm_bal_cf' LIMIT 1
            ), 0)
            /
            COALESCE((
              SELECT mt.amount FROM monthly_trans mt
              WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2
                AND mt.column_key = 'comm_repayment' LIMIT 1
            ), 0)
          )
          ELSE 0
        END AS comm_duration,

        -- ── OTHER CHARGES ─────────────────────────────────────────────────
        COALESCE((
          SELECT SUM(mcb.amount) FROM member_custom_balances mcb
          WHERE mcb.member_id = m.id AND mcb.column_key = 'form'
        ), 0) AS form,

        COALESCE((
          SELECT mt.amount FROM monthly_trans mt
          WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2
            AND mt.column_key = 'other_charges' LIMIT 1
        ), 0) AS other_charges,

        -- Total deduction = savings_add + savings_bank + loan_repayment + loan_repayment_bank + loan_int_paid + loan_int_paid_bank + comm_repayment + comm_repayment_bank + form + other_charges
        COALESCE((SELECT mt.amount FROM monthly_trans mt WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2 AND mt.column_key = 'savings_add' LIMIT 1), COALESCE(s.amount, 0))
        + COALESCE((SELECT mt.amount FROM monthly_trans mt WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2 AND mt.column_key = 'savings_add_bank' LIMIT 1), 0)
        + COALESCE((SELECT mt.amount FROM monthly_trans mt WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2 AND mt.column_key = 'loan_repayment' LIMIT 1), 0)
        + COALESCE((SELECT mt.amount FROM monthly_trans mt WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2 AND mt.column_key = 'loan_repayment_bank' LIMIT 1), 0)
        + COALESCE((SELECT mt.amount FROM monthly_trans mt WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2 AND mt.column_key = 'loan_int_paid' LIMIT 1), 0)
        + COALESCE((SELECT mt.amount FROM monthly_trans mt WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2 AND mt.column_key = 'loan_int_paid_bank' LIMIT 1), 0)
        + COALESCE((SELECT mt.amount FROM monthly_trans mt WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2 AND mt.column_key = 'comm_repayment' LIMIT 1), 0)
        + COALESCE((SELECT mt.amount FROM monthly_trans mt WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2 AND mt.column_key = 'comm_repayment_bank' LIMIT 1), 0)
        + COALESCE((SELECT SUM(mcb.amount) FROM member_custom_balances mcb WHERE mcb.member_id = m.id AND mcb.column_key = 'form'), 0)
        + COALESCE((SELECT mt.amount FROM monthly_trans mt WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2 AND mt.column_key = 'other_charges' LIMIT 1), 0)
        AS total_deduction

      FROM members m
      LEFT JOIN savings   s  ON s.member_id  = m.id AND s.month  = $1 AND s.year  = $2
      LEFT JOIN commodity c  ON c.member_id  = m.id AND c.month  = $1 AND c.year  = $2
      ORDER BY regexp_replace(m.ledger_no, '\d', '', 'g'), NULLIF(regexp_replace(m.ledger_no, '\D', '', 'g'), '')::numeric NULLS LAST, m.ledger_no
    `, [m, y]);

    // Column definitions matching the CSV layout
    const columns = [
      // Savings
      { key: 'savings_bf',       label: 'Savings B/F',                        type: 'fixed', group: 'Savings' },
      { key: 'savings_this_month', label: 'Add: Savings This Month',           type: 'fixed', group: 'Savings' },
      { key: 'savings_bank',     label: 'Add: Savings (Bank)',                 type: 'fixed', group: 'Savings' },
      { key: 'net_savings_cf',   label: 'Net Savings C/F',                     type: 'fixed', group: 'Savings' },
      // Loan Principal
      { key: 'loan_bal_bf',      label: 'Loan Prin. Bal. B/F',                type: 'fixed', group: 'Loan Principal' },
      { key: 'loan_granted',     label: 'Add: Loan Granted',                   type: 'fixed', group: 'Loan Principal' },
      { key: 'loan_repayment',   label: 'Less: Loan Repayment',               type: 'fixed', group: 'Loan Principal' },
      { key: 'loan_repayment_bank', label: 'Less: Loan Repayment (Bank)',      type: 'fixed', group: 'Loan Principal' },
      { key: 'loan_ledger_bal',  label: 'Loan Ledger Bal.',                    type: 'fixed', group: 'Loan Principal' },
      { key: 'loan_duration',    label: 'Loan Duration',                       type: 'fixed', group: 'Loan Principal' },
      // Loan Interest
      { key: 'loan_int_bf',      label: 'Loan Interest B/F',                  type: 'fixed', group: 'Loan Interest' },
      { key: 'loan_int_charged', label: 'Add: Interest Charged',              type: 'fixed', group: 'Loan Interest' },
      { key: 'loan_int_paid',    label: 'Less: Interest Paid',                type: 'fixed', group: 'Loan Interest' },
      { key: 'loan_int_paid_bank', label: 'Less: Interest Paid (Bank)',       type: 'fixed', group: 'Loan Interest' },
      { key: 'loan_int_cf',      label: 'Loan Interest Bal. C/F',             type: 'fixed', group: 'Loan Interest' },
      // Commodity
      { key: 'comm_bal_bf',      label: 'Commodity Sales B/F',                type: 'fixed', group: 'Commodity' },
      { key: 'comm_add',         label: 'Add: Comm. Sales This Month',        type: 'fixed', group: 'Commodity' },
      { key: 'comm_repayment',   label: 'Less: Comm. Sales Repayment',        type: 'fixed', group: 'Commodity' },
      { key: 'comm_repayment_bank', label: 'Less: Comm. Repayment (Bank)',    type: 'fixed', group: 'Commodity' },
      { key: 'comm_bal_cf',      label: 'Comm. Sales Bal. C/F',               type: 'fixed', group: 'Commodity' },
      { key: 'comm_duration',    label: 'Commodity Duration',                  type: 'fixed', group: 'Commodity' },
      // Other
      { key: 'form',             label: 'Form',                                type: 'custom', group: 'Other Charges' },
      { key: 'other_charges',    label: 'Other Charges',                       type: 'fixed', group: 'Other Charges' },
      { key: 'total_deduction',  label: 'Total Deduction',                     type: 'fixed', group: 'Other Charges' },
    ];

    res.json({
      columns,
      members:   result.rows,
      dataMonth: m,
      dataYear:  y,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function uploadBalances(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
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

    // from_line: 2 skips the merged group-header row (PERSONAL DETAILS, RECORDS ON SAVINGS…)
    // Real column headers (S/N, L/No, NAME…) are on line 1 (0-indexed row 0)
    const records = parse(csvText, {
      columns:            true,
      skip_empty_lines:   true,
      trim:               true,
      relax_column_count: true,
      from_line:          2,
    });

    let imported = 0, skipped = 0;
    const errors = [];

    const parseAmt = (v) => {
      const n = parseFloat((v || '').toString().replace(/,/g, '').trim());
      return isNaN(n) ? 0 : n;
    };

    // Deduplicate by ledger_no — last occurrence wins
    const seen = new Map();
    for (const row of records) {
      const r = {};
      for (const k of Object.keys(row)) {
        r[k.trim().toUpperCase()] = (row[k] || '').toString().trim();
      }
      const ledger_no = (r['LEDGER NO'] || r['LEDGER NO.'] || r['L/NO'] || r['LEDGER_NO'] || '').toUpperCase();
      const staff_no  = (r['STAFF NO']  || r['STAFF NO.']  || r['STAFF_NO']  || '').toUpperCase();
      const key = ledger_no || staff_no;
      if (!key) continue;
      seen.set(key, r);
    }

    for (const [, r] of seen.entries()) {
      const ledger_no = (r['LEDGER NO'] || r['LEDGER NO.'] || r['L/NO'] || r['LEDGER_NO'] || '').toUpperCase();
      const staff_no  = (r['STAFF NO']  || r['STAFF NO.']  || r['STAFF_NO']  || '').toUpperCase();

      let memberRes;
      if (ledger_no) memberRes = await db.query(
        'SELECT id FROM members WHERE UPPER(TRIM(ledger_no)) = $1', [ledger_no]
      );
      if ((!memberRes || !memberRes.rows.length) && staff_no) memberRes = await db.query(
        'SELECT id FROM members WHERE UPPER(TRIM(staff_no)) = $1', [staff_no]
      );

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