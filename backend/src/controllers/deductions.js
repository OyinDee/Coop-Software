const db = require('../db');
const { parse } = require('csv-parse/sync');

// Headers that identify the member — not stored as financial data
const IDENTITY_HEADERS = new Set(['s/n', 'month', 'l/no', 'ippis no', 'name', 'staff no']);

function normalizeLabel(h) {
  return h.toLowerCase().replace(/\s+/g, ' ').trim();
}

function makeKey(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 150);
}

function parseAmount(val) {
  if (val === null || val === undefined || val === '') return 0;
  return parseFloat(String(val).replace(/[,"]/g, '').trim()) || 0;
}

// ── Get enabled trans columns ─────────────────────────────────────────────────
async function getTransColumns(req, res) {
  try {
    const r = await db.query('SELECT * FROM trans_columns ORDER BY sort_order, id');
    res.json({ columns: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── Toggle a trans column enabled/disabled ────────────────────────────────────
async function updateTransColumn(req, res) {
  const { key } = req.params;
  const { enabled } = req.body;
  try {
    const r = await db.query(
      'UPDATE trans_columns SET enabled=$1 WHERE key=$2 RETURNING *',
      [Boolean(enabled), key]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Column not found' });
    res.json({ column: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── CSV Upload: parse + store all columns per member per month ────────────────
async function uploadTransCSV(req, res) {
  const { month, year } = req.body;
  const m = parseInt(month);
  const y = parseInt(year);

  if (!m || !y || !req.file) {
    return res.status(400).json({ error: 'file, month, and year are required' });
  }

  try {
    const records = parse(req.file.buffer, {
      skip_empty_lines: false,
      trim: true,
      relax_column_count: true,
      bom: true,
    });

    if (records.length < 2) {
      return res.status(400).json({ error: 'CSV is too short' });
    }

    // Row 0: main column headers
    const headerRow = records[0].map((h) => (h || '').trim());

    // Preload all existing trans_columns labels for quick lookup (normalized)
    const existingCols = await db.query('SELECT key, label FROM trans_columns');
    const labelToKey = {};
    for (const row of existingCols.rows) {
      labelToKey[normalizeLabel(row.label)] = row.key;
    }

    // Identify column indices
    const lNoIdx     = headerRow.findIndex((h) => normalizeLabel(h) === 'l/no');
    const staffNoIdx = headerRow.findIndex((h) => normalizeLabel(h) === 'staff no');
    const ippisIdx   = headerRow.findIndex((h) => normalizeLabel(h) === 'ippis no');
    const snIdx      = headerRow.findIndex((h) => normalizeLabel(h) === 's/n');
    const nameIdx    = headerRow.findIndex((h) => normalizeLabel(h) === 'name');

    if (lNoIdx === -1) {
      return res.status(400).json({ error: 'CSV must have an L/No column' });
    }

    // Build financial column map & register any new columns in one pass
    const financialCols = [];
    const newColInserts = { ledgers: [], labels: [], sorts: [] };
    for (let i = 0; i < headerRow.length; i++) {
      const h = headerRow[i];
      if (!h || IDENTITY_HEADERS.has(normalizeLabel(h))) continue;
      let colKey = labelToKey[normalizeLabel(h)];
      if (!colKey) {
        colKey = makeKey(h).slice(0, 150) || `col_${i}`;
        newColInserts.ledgers.push(colKey);
        newColInserts.labels.push(h);
        newColInserts.sorts.push(i);
        labelToKey[normalizeLabel(h)] = colKey;
      }
      financialCols.push({ idx: i, key: colKey });
    }

    // Batch-insert any new columns
    if (newColInserts.ledgers.length > 0) {
      await db.query(
        `INSERT INTO trans_columns (key, label, sort_order)
         SELECT * FROM UNNEST($1::text[], $2::text[], $3::int[])
         ON CONFLICT (key) DO NOTHING`,
        [newColInserts.ledgers, newColInserts.labels, newColInserts.sorts]
      );
    }

    // ── Pre-load ALL existing members into Maps for O(1) lookup ──────────────
    const allMembers = await db.query('SELECT id, LOWER(ledger_no) AS ln, LOWER(staff_no) AS sn FROM members');
    const byLedger = new Map();
    const byStaff  = new Map();
    for (const r of allMembers.rows) {
      if (r.ln) byLedger.set(r.ln, r.id);
      if (r.sn) byStaff.set(r.sn,  r.id);
    }

    // ── First pass: collect data rows, identify new members ──────────────────
    const dataRows = [];   // { lNoVal, staffNo, ippisVal, nameVal, row }
    const newMembers = []; // { ledger_no, staff_no, gifmis_no, full_name }

    for (let rowIdx = 1; rowIdx < records.length; rowIdx++) {
      const row = records[rowIdx];
      if (!row || row.length === 0) continue;
      const snVal  = snIdx  >= 0 ? (row[snIdx]  || '').trim() : '';
      const lNoVal = lNoIdx >= 0 ? (row[lNoIdx] || '').trim() : '';
      if (snVal && isNaN(Number(snVal))) continue;  // section-header row
      if (!snVal && !lNoVal) continue;              // totals / blank row

      const staffNo  = staffNoIdx >= 0 ? (row[staffNoIdx] || '').trim() : '';
      const ippisVal = ippisIdx   >= 0 ? (row[ippisIdx]   || '').trim() : '';
      const nameVal  = nameIdx    >= 0 ? (row[nameIdx]    || '').trim() : '';

      const existId = byLedger.get(lNoVal.toLowerCase()) ||
                      (staffNo ? byStaff.get(staffNo.toLowerCase()) : null);

      if (!existId) {
        if (!lNoVal) continue; // can't create without ledger_no
        newMembers.push([lNoVal, staffNo || null, ippisVal || null, nameVal || lNoVal]);
      }
      dataRows.push({ lNoVal, staffNo, ippisVal, nameVal, existId, row });
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // ── Batch-upsert new members ────────────────────────────────────────────
      if (newMembers.length > 0) {
        const lnArr = newMembers.map(r => r[0]);
        const snArr = newMembers.map(r => r[1]);
        const giArr = newMembers.map(r => r[2]);
        const fnArr = newMembers.map(r => r[3]);
        const ins = await client.query(
          `INSERT INTO members (ledger_no, staff_no, gifmis_no, full_name, is_active)
           SELECT unnest($1::text[]), unnest($2::text[]), unnest($3::text[]), unnest($4::text[]),
                  TRUE
           ON CONFLICT (ledger_no) DO UPDATE
             SET staff_no  = COALESCE(EXCLUDED.staff_no,  members.staff_no),
                 gifmis_no = COALESCE(EXCLUDED.gifmis_no, members.gifmis_no),
                 updated_at = NOW()
           RETURNING id, LOWER(ledger_no) AS ln, LOWER(COALESCE(staff_no,'')) AS sn`,
          [lnArr, snArr, giArr, fnArr]
        );
        for (const r of ins.rows) {
          if (r.ln) byLedger.set(r.ln, r.id);
          if (r.sn && r.sn !== '') byStaff.set(r.sn, r.id);
        }
      }

      // ── Re-resolve member IDs and build trans batch ─────────────────────────
      const tMemberIds = [];
      const tColKeys   = [];
      const tAmounts   = [];
      const tMonths    = [];
      const tYears     = [];

      let matched   = 0;
      let unmatched = 0;
      const unmatchedRows = [];

      for (const dr of dataRows) {
        const memberId = dr.existId ||
                         byLedger.get(dr.lNoVal.toLowerCase()) ||
                         (dr.staffNo ? byStaff.get(dr.staffNo.toLowerCase()) : null);
        if (!memberId) { unmatched++; unmatchedRows.push(dr.lNoVal || dr.staffNo); continue; }

        for (const col of financialCols) {
          const raw = col.idx < dr.row.length ? dr.row[col.idx] : '';
          tMemberIds.push(memberId);
          tColKeys.push(col.key);
          tAmounts.push(parseAmount(raw));
          tMonths.push(m);
          tYears.push(y);
        }
        matched++;
      }

      // ── Single batch upsert into monthly_trans via UNNEST ───────────────────
      if (tMemberIds.length > 0) {
        await client.query(
          `INSERT INTO monthly_trans (member_id, column_key, amount, month, year)
           SELECT * FROM UNNEST($1::int[], $2::text[], $3::numeric[], $4::int[], $5::int[])
           ON CONFLICT (member_id, column_key, month, year)
           DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()`,
          [tMemberIds, tColKeys, tAmounts, tMonths, tYears]
        );
      }

      await client.query('COMMIT');
      const created = newMembers.length;
      res.json({
        matched,
        created,
        unmatched,
        unmatchedRows,
        message: `Imported ${matched} member${matched !== 1 ? 's' : ''}${created ? ` (${created} new member${created !== 1 ? 's' : ''} created)` : ''}${unmatched ? ` (${unmatched} unmatched)` : ''}`,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── Get deductions for a month (reads from monthly_trans) ────────────────────
async function getDeductions(req, res) {
  const { month, year } = req.query;
  const m = parseInt(month) || new Date().getMonth() + 1;
  const y = parseInt(year)  || new Date().getFullYear();

  try {
    // Get enabled trans columns
    const colsResult = await db.query(
      'SELECT * FROM trans_columns WHERE enabled = TRUE ORDER BY sort_order, id'
    );
    const columns = colsResult.rows;

    // Get all active members
    const membersResult = await db.query(
      `SELECT id, ledger_no, staff_no, full_name, department
       FROM members WHERE is_active = TRUE ORDER BY ledger_no`
    );

    // Get all monthly_trans data for this month
    const dataResult = await db.query(
      'SELECT member_id, column_key, amount FROM monthly_trans WHERE month=$1 AND year=$2',
      [m, y]
    );
    const dataMap = {};
    for (const d of dataResult.rows) {
      if (!dataMap[d.member_id]) dataMap[d.member_id] = {};
      dataMap[d.member_id][d.column_key] = parseFloat(d.amount);
    }

    // Get narrations for this month
    const narrResult = await db.query(
      'SELECT member_id, narration FROM deduction_narrations WHERE month=$1 AND year=$2',
      [m, y]
    );
    const narrMap = {};
    for (const n of narrResult.rows) narrMap[n.member_id] = n.narration;

    const hasData = Object.keys(dataMap).length > 0;

    // Return only members that have CSV data uploaded for this month
    const members = membersResult.rows
      .filter((row) => !!dataMap[row.id])
      .map((row) => {
        const memberData = dataMap[row.id] || {};
        const result = { ...row, narration: narrMap[row.id] || '' };
        for (const col of columns) result[col.key] = memberData[col.key] ?? null;
        return result;
      });

    res.json({ columns, members, month: m, year: y, hasData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── Save narration for a member/month ─────────────────────────────────────────
async function upsertDeductions(req, res) {
  const { member_id, month, year, narration } = req.body;
  if (!member_id || !month || !year) {
    return res.status(400).json({ error: 'member_id, month, year are required' });
  }
  const m = parseInt(month);
  const y = parseInt(year);

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    if (narration !== undefined) {
      if (narration && narration.trim()) {
        await client.query(`
          INSERT INTO deduction_narrations (member_id, narration, month, year)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (member_id, month, year)
          DO UPDATE SET narration = EXCLUDED.narration, updated_at = NOW()
        `, [member_id, narration.trim(), m, y]);
      } else {
        await client.query(
          'DELETE FROM deduction_narrations WHERE member_id=$1 AND month=$2 AND year=$3',
          [member_id, m, y]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ message: 'Deductions updated' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

// ── Month name lookup (used in generateNextMonth) ────────────────────────────
const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

// ── Generate next month: C/F → next month's B/F, recurring amounts copied ────
async function generateNextMonth(req, res) {
  const { fromMonth, fromYear, force } = req.body;

  try {
    let srcMonth, srcYear;

    if (fromMonth && fromYear) {
      srcMonth = parseInt(fromMonth);
      srcYear  = parseInt(fromYear);
    } else {
      // Find the latest month with data
      const latest = await db.query(
        'SELECT month, year FROM monthly_trans ORDER BY year DESC, month DESC LIMIT 1'
      );
      if (!latest.rows.length) {
        return res.status(400).json({ error: 'No monthly data found. Upload an opening balances CSV first.' });
      }
      srcMonth = latest.rows[0].month;
      srcYear  = latest.rows[0].year;
    }

    // Target = source + 1 month
    let tgtMonth = srcMonth + 1;
    let tgtYear  = srcYear;
    if (tgtMonth > 12) { tgtMonth = 1; tgtYear++; }

    // Check if target already has data
    if (!force) {
      const existCheck = await db.query(
        'SELECT COUNT(*) AS cnt FROM monthly_trans WHERE month=$1 AND year=$2',
        [tgtMonth, tgtYear]
      );
      if (parseInt(existCheck.rows[0].cnt) > 0) {
        return res.status(409).json({
          error: `Data for ${MONTH_NAMES[tgtMonth - 1]} ${tgtYear} already exists.`,
          month: tgtMonth, year: tgtYear, exists: true,
        });
      }
    }

    // Verify source has data
    const srcCheck = await db.query(
      'SELECT COUNT(*) AS cnt FROM monthly_trans WHERE month=$1 AND year=$2',
      [srcMonth, srcYear]
    );
    if (parseInt(srcCheck.rows[0].cnt) === 0) {
      return res.status(400).json({ error: `No data found for ${MONTH_NAMES[srcMonth - 1]} ${srcYear}.` });
    }

    // Get interest rate
    const rateRes = await db.query("SELECT value FROM app_settings WHERE key='loan_interest_rate'");
    const interestRate = parseFloat(rateRes.rows[0]?.value || '5') / 100;

    // Load source month data
    const dataRes = await db.query(
      'SELECT member_id, column_key, amount FROM monthly_trans WHERE month=$1 AND year=$2',
      [srcMonth, srcYear]
    );
    const memberData = {};
    for (const d of dataRes.rows) {
      if (!memberData[d.member_id]) memberData[d.member_id] = {};
      memberData[d.member_id][d.column_key] = parseFloat(d.amount) || 0;
    }

    const g = (obj, k) => obj[k] || 0;
    const client = await db.getClient();
    let generated = 0;

    try {
      await client.query('BEGIN');

      if (force) {
        await client.query('DELETE FROM monthly_trans WHERE month=$1 AND year=$2', [tgtMonth, tgtYear]);
      }

      for (const [memberId, prev] of Object.entries(memberData)) {
        // B/F values come from previous month's C/F
        const savings_bf           = g(prev, 'savings_cf');
        const loan_bal_bf          = g(prev, 'loan_ledger_bal');
        const loan_int_bf          = g(prev, 'loan_int_cf');
        const comm_bal_bf          = g(prev, 'comm_bal_cf');

        // Recurring amounts copied; non-recurring (new grants/additions) reset to 0
        const savings_add          = g(prev, 'savings_add');
        const savings_add_bank     = g(prev, 'savings_add_bank');
        const savings_withdrawal   = g(prev, 'savings_withdrawal');
        const loan_granted         = 0;  // new loans not assumed recurring
        const loan_repayment       = g(prev, 'loan_repayment');
        const loan_repayment_bank  = g(prev, 'loan_repayment_bank');
        const loan_int_paid        = g(prev, 'loan_int_paid');
        const loan_int_paid_bank   = g(prev, 'loan_int_paid_bank');
        const comm_add             = 0;  // new commodity not assumed recurring
        const comm_repayment       = g(prev, 'comm_repayment');
        const comm_repayment_bank  = g(prev, 'comm_repayment_bank');
        const form                 = g(prev, 'form');
        const other_charges        = g(prev, 'other_charges');

        // Interest charged on opening loan balance for this month
        const loan_int_charged = loan_bal_bf > 0
          ? Math.round(loan_bal_bf * interestRate * 100) / 100
          : 0;

        // C/F recalculations
        const savings_cf     = Math.max(0, savings_bf + savings_add + savings_add_bank - savings_withdrawal);
        const loan_ledger_bal = Math.max(0, loan_bal_bf + loan_granted - loan_repayment - loan_repayment_bank);
        const loan_int_cf    = Math.max(0, loan_int_bf + loan_int_charged - loan_int_paid - loan_int_paid_bank);
        const comm_bal_cf    = Math.max(0, comm_bal_bf + comm_add - comm_repayment - comm_repayment_bank);

        // Total salary deduction (bank-paid portions excluded)
        const total_deduction = savings_add + loan_repayment + loan_int_paid + comm_repayment + form + other_charges;

        const newData = {
          savings_bf, savings_add, savings_add_bank, savings_withdrawal, savings_cf,
          loan_bal_bf, loan_granted, loan_repayment, loan_repayment_bank, loan_ledger_bal,
          loan_int_bf, loan_int_charged, loan_int_paid, loan_int_paid_bank, loan_int_cf,
          comm_bal_bf, comm_add, comm_repayment, comm_repayment_bank, comm_bal_cf,
          form, other_charges, total_deduction,
        };

        for (const [key, amount] of Object.entries(newData)) {
          await client.query(`
            INSERT INTO monthly_trans (member_id, column_key, amount, month, year)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (member_id, column_key, month, year)
            DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()
          `, [memberId, key, amount, tgtMonth, tgtYear]);
        }
        generated++;
      }

      await client.query('COMMIT');
      res.json({
        message: `Generated ${generated} record${generated !== 1 ? 's' : ''} for ${MONTH_NAMES[tgtMonth - 1]} ${tgtYear}`,
        month: tgtMonth, year: tgtYear, generated,
        sourceMonth: srcMonth, sourceYear: srcYear,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getDeductions, upsertDeductions, uploadTransCSV, getTransColumns, updateTransColumn, generateNextMonth };
