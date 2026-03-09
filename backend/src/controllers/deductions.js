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

// ── Alias map: all known label variations → canonical column key ──────────────
// Handles different spacing, punctuation and abbreviations in uploaded CSVs.
const LABEL_ALIASES = {
  // SAVINGS
  'savings b/f':                                  'savings_bf',
  'savings bf':                                   'savings_bf',
  'savings b f':                                  'savings_bf',
  'add savings during the month':                 'savings_add',
  'add: savings during the month':                'savings_add',
  'add savings during the month (bank)':          'savings_add_bank',
  'add: savings during the month (bank)':         'savings_add_bank',
  'less withdrawal':                              'savings_withdrawal',
  'less: withdrawal':                             'savings_withdrawal',
  'net saving c/f':                               'savings_cf',
  'net savings c/f':                              'savings_cf',
  'savings c/f':                                  'savings_cf',
  'savings cf':                                   'savings_cf',

  // LOAN PRINCIPAL
  'loan prin. bal. b/f':                          'loan_bal_bf',
  'loan principal balance b/f':                   'loan_bal_bf',
  'loan prin bal b/f':                            'loan_bal_bf',
  'loan bal b/f':                                 'loan_bal_bf',
  'loan bal bf':                                  'loan_bal_bf',
  'loan b/f':                                     'loan_bal_bf',
  'add loan granted this month (auto)':           'loan_granted',
  'add: loan granted this month (auto)':          'loan_granted',
  'add: loan granted this month':                 'loan_granted',
  'loan granted this month':                      'loan_granted',
  'less loan principal repayment':                'loan_repayment',
  'less: loan principal repayment':               'loan_repayment',
  'loan principal repayment':                     'loan_repayment',
  'loan repayment':                               'loan_repayment',
  'less loan principal repayment (bank)':         'loan_repayment_bank',
  'less: loan principal repayment (bank)':        'loan_repayment_bank',
  'loan repayment (bank)':                        'loan_repayment_bank',
  'loan ledger bal.':                             'loan_ledger_bal',
  'loan ledger bal':                              'loan_ledger_bal',
  'loan ledger balance':                          'loan_ledger_bal',

  // LOAN INTEREST
  'loan interest balance b/f':                   'loan_int_bf',
  'loan int balance b/f':                        'loan_int_bf',
  'loan int b/f':                                'loan_int_bf',
  'loan interest b/f':                           'loan_int_bf',
  'add interest charged on loan granted this month':       'loan_int_charged',
  'add:interest charged on loan granted this month:':      'loan_int_charged',
  'add: interest charged on loan granted this month:':     'loan_int_charged',
  'interest charged on loan granted this month':           'loan_int_charged',
  'loan int charged':                            'loan_int_charged',
  'less loan interest paid this month':          'loan_int_paid',
  'less: loan interest paid this month':         'loan_int_paid',
  'loan interest paid this month':               'loan_int_paid',
  'loan int paid':                               'loan_int_paid',
  'ln int paid':                                 'loan_int_paid',
  'less loan interest paid (bank)':              'loan_int_paid_bank',
  'less: loan interest paid  (bank)':            'loan_int_paid_bank',
  'less: loan interest paid (bank)':             'loan_int_paid_bank',
  'loan interest paid (bank)':                   'loan_int_paid_bank',
  'loan interest balance c/f':                   'loan_int_cf',
  'loan int balance c/f':                        'loan_int_cf',
  'loan int c/f':                                'loan_int_cf',
  'loan interest c/f':                           'loan_int_cf',
  'loan int cf':                                 'loan_int_cf',

  // COMMODITY
  'commodity sales bal. b/f':                    'comm_bal_bf',
  'commodity sales bal b/f':                     'comm_bal_bf',
  'comm. sales bal. b/f':                        'comm_bal_bf',
  'comm sales bal b/f':                          'comm_bal_bf',
  'commodity bal. b/f':                          'comm_bal_bf',
  'commodity b/f':                               'comm_bal_bf',
  'add comm. sales during the month':            'comm_add',
  'add: comm. sales during the month':           'comm_add',
  'commodity sales during the month':            'comm_add',
  'comm sales during the month':                 'comm_add',
  'less commodity sales repayment':              'comm_repayment',
  'less: commodity sales repayment':             'comm_repayment',
  'less: commodity sales repayment ':            'comm_repayment',
  'commodity sales repayment':                   'comm_repayment',
  'comm repayment':                              'comm_repayment',
  'less commodity sales repayment (bank)':       'comm_repayment_bank',
  'less: comm. sales repay. (bank)':             'comm_repayment_bank',
  'less: commodity sales repay. (bank)':         'comm_repayment_bank',
  'comm. sales repay. (bank)':                   'comm_repayment_bank',
  'comm. sales bal. c/f':                        'comm_bal_cf',
  'comm. sales bal. c/f':                        'comm_bal_cf',
  'commodity sales bal. c/f':                    'comm_bal_cf',
  'comm sales bal c/f':                          'comm_bal_cf',
  'commodity c/f':                               'comm_bal_cf',

  // OTHER DEDUCTIONS
  'form':                                        'form',
  'form fee':                                    'form',
  'other charges':                               'other_charges',
  'other charge':                                'other_charges',
  'total deduction':                             'total_deduction',
  'total deductions':                            'total_deduction',
};

// Resolve a CSV header label to a canonical key, checking aliases first
function resolveKey(label, labelToKey) {
  const norm = normalizeLabel(label);
  // 1. Check alias table (covers all known Excel header variants)
  if (LABEL_ALIASES[norm]) return LABEL_ALIASES[norm];
  // 2. Check existing trans_columns by label
  if (labelToKey[norm]) return labelToKey[norm];
  // 3. Fall back to auto-generated key from label
  return null;
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

// Sync a loan repayment entry into loan_repayments + update loans balance.
// Called after CSV upload or month generation so loan tracking stays current.
async function syncLoanRepayment(client, memberId, month, year, principalPaid, interestPaid, description) {
  if (principalPaid <= 0 && interestPaid <= 0) return;
  const loanRes = await client.query(
    "SELECT id, remaining_balance, interest_paid AS int_paid, months_paid FROM loans WHERE member_id=$1 AND status='active' ORDER BY created_at ASC LIMIT 1",
    [memberId]
  );
  if (!loanRes.rows.length) return;
  const loan = loanRes.rows[0];
  // Prevent duplicate entries for the same loan/month/year
  const dup = await client.query(
    'SELECT id FROM loan_repayments WHERE loan_id=$1 AND month=$2 AND year=$3',
    [loan.id, month, year]
  );
  if (dup.rows.length) return;
  await client.query(
    'INSERT INTO loan_repayments (loan_id, member_id, principal_paid, interest_paid, month, year, description) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [loan.id, memberId, principalPaid, interestPaid, month, year, description || null]
  );
  const newBalance = Math.max(0, parseFloat(loan.remaining_balance) - principalPaid);
  const newStatus  = newBalance <= 0 ? 'cleared' : 'active';
  await client.query(
    'UPDATE loans SET remaining_balance=$1, interest_paid=interest_paid+$2, months_paid=months_paid+1, status=$3, updated_at=NOW() WHERE id=$4',
    [newBalance, interestPaid, newStatus, loan.id]
  );
}

// Canonical labels + sort orders for all known column keys
const CANONICAL_LABELS = {
  savings_bf:           { label: 'Savings B/F',                              sort: 1  },
  savings_add:          { label: 'ADD: Savings (Salary)',                    sort: 2  },
  savings_add_bank:     { label: 'ADD: Savings (Bank)',                      sort: 3  },
  savings_withdrawal:   { label: 'LESS: Withdrawal',                         sort: 4  },
  savings_cf:           { label: 'Net Saving C/F',                           sort: 5  },
  loan_bal_bf:          { label: 'Loan Prin. Bal. B/F',                      sort: 6  },
  loan_granted:         { label: 'ADD: Loan Granted this Month',             sort: 7  },
  loan_repayment:       { label: 'LESS: Loan Principal Repayment',           sort: 8  },
  loan_repayment_bank:  { label: 'LESS: Loan Principal Repayment (Bank)',    sort: 9  },
  loan_ledger_bal:      { label: 'Loan Ledger Bal.',                         sort: 10 },
  loan_int_bf:          { label: 'Loan Interest Balance B/F',                sort: 11 },
  loan_int_charged:     { label: 'ADD: Interest Charged',                    sort: 12 },
  loan_int_paid:        { label: 'LESS: Loan Interest Paid',                 sort: 13 },
  loan_int_paid_bank:   { label: 'LESS: Loan Interest Paid (Bank)',          sort: 14 },
  loan_int_cf:          { label: 'Loan Interest Balance C/F',                sort: 15 },
  comm_bal_bf:          { label: 'Commodity Sales Bal. B/F',                 sort: 16 },
  comm_add:             { label: 'ADD: Comm. Sales During the Month',        sort: 17 },
  comm_repayment:       { label: 'LESS: Commodity Sales Repayment',          sort: 18 },
  comm_repayment_bank:  { label: 'LESS: Comm. Sales Repay. (Bank)',          sort: 19 },
  comm_bal_cf:          { label: 'Comm. Sales Bal. C/F',                     sort: 20 },
  form:                 { label: 'Form',                                      sort: 21 },
  other_charges:        { label: 'Other Charges',                            sort: 22 },
  total_deduction:      { label: 'Total Deduction',                          sort: 23 },
};

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

      // Try alias resolution first, then DB lookup, then auto-generate
      let colKey = resolveKey(h, labelToKey);
      if (!colKey) {
        colKey = makeKey(h).slice(0, 150) || `col_${i}`;
        newColInserts.ledgers.push(colKey);
        newColInserts.labels.push(h);
        newColInserts.sorts.push(i);
        labelToKey[normalizeLabel(h)] = colKey;
      } else {
        // Canonical key resolved via LABEL_ALIASES — still register in trans_columns
        const canonMeta = CANONICAL_LABELS[colKey];
        if (canonMeta) {
          newColInserts.ledgers.push(colKey);
          newColInserts.labels.push(canonMeta.label);
          newColInserts.sorts.push(canonMeta.sort);
        }
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

      const loanSyncMap = new Map(); // memberId -> { principal_paid, interest_paid }

      for (const dr of dataRows) {
        const memberId = dr.existId ||
                         byLedger.get(dr.lNoVal.toLowerCase()) ||
                         (dr.staffNo ? byStaff.get(dr.staffNo.toLowerCase()) : null);
        if (!memberId) { unmatched++; unmatchedRows.push(dr.lNoVal || dr.staffNo); continue; }

        for (const col of financialCols) {
          const raw = col.idx < dr.row.length ? dr.row[col.idx] : '';
          const amt = parseAmount(raw);
          tMemberIds.push(memberId);
          tColKeys.push(col.key);
          tAmounts.push(amt);
          tMonths.push(m);
          tYears.push(y);
          if (col.key === 'loan_repayment' || col.key === 'loan_repayment_bank') {
            const e = loanSyncMap.get(memberId) || { principal_paid: 0, interest_paid: 0 };
            e.principal_paid += amt;
            loanSyncMap.set(memberId, e);
          } else if (col.key === 'loan_int_paid' || col.key === 'loan_int_paid_bank') {
            const e = loanSyncMap.get(memberId) || { principal_paid: 0, interest_paid: 0 };
            e.interest_paid += amt;
            loanSyncMap.set(memberId, e);
          }
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

      // Sync loan repayments from CSV data into loan tracking tables
      for (const [memberId, { principal_paid, interest_paid }] of loanSyncMap) {
        await syncLoanRepayment(client, memberId, m, y, principal_paid, interest_paid, null);
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

      const loanSyncs = [];
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

        // Interest is flat-rate, calculated once when loan is issued.
        // Only charge new interest if a new loan was granted this month (loan_granted > 0).
        const loan_int_charged = loan_granted > 0
          ? Math.round(loan_granted * interestRate * 100) / 100
          : 0;

        // ── Cap repayments at remaining balances so payments stop when cleared ──

        // Loan principal: stop deducting once loan_ledger_bal reaches 0
        const loan_balance_before = loan_bal_bf + loan_granted;
        const eff_loan_repayment      = loan_balance_before > 0 ? Math.min(loan_repayment,      loan_balance_before) : 0;
        const eff_loan_repayment_bank = loan_balance_before > 0 ? Math.min(loan_repayment_bank, Math.max(0, loan_balance_before - eff_loan_repayment)) : 0;

        // Loan interest: stop deducting once loan_int_cf reaches 0
        const int_balance_before = loan_int_bf + loan_int_charged;
        const eff_loan_int_paid      = int_balance_before > 0 ? Math.min(loan_int_paid,      int_balance_before) : 0;
        const eff_loan_int_paid_bank = int_balance_before > 0 ? Math.min(loan_int_paid_bank, Math.max(0, int_balance_before - eff_loan_int_paid)) : 0;

        // Commodity: stop deducting once comm_bal_cf reaches 0
        const comm_balance_before = comm_bal_bf + comm_add;
        const eff_comm_repayment      = comm_balance_before > 0 ? Math.min(comm_repayment,      comm_balance_before) : 0;
        const eff_comm_repayment_bank = comm_balance_before > 0 ? Math.min(comm_repayment_bank, Math.max(0, comm_balance_before - eff_comm_repayment)) : 0;

        // C/F recalculations
        const savings_cf      = Math.max(0, savings_bf + savings_add + savings_add_bank - savings_withdrawal);
        const loan_ledger_bal = Math.max(0, loan_balance_before - eff_loan_repayment - eff_loan_repayment_bank);
        const loan_int_cf     = Math.max(0, int_balance_before - eff_loan_int_paid - eff_loan_int_paid_bank);
        const comm_bal_cf     = Math.max(0, comm_balance_before - eff_comm_repayment - eff_comm_repayment_bank);

        // Total salary deduction (bank-paid portions excluded from salary deduction total)
        const total_deduction = savings_add + eff_loan_repayment + eff_loan_int_paid + eff_comm_repayment + form + other_charges;

        const newData = {
          savings_bf, savings_add, savings_add_bank, savings_withdrawal, savings_cf,
          loan_bal_bf, loan_granted, loan_repayment: eff_loan_repayment, loan_repayment_bank: eff_loan_repayment_bank, loan_ledger_bal,
          loan_int_bf, loan_int_charged, loan_int_paid: eff_loan_int_paid, loan_int_paid_bank: eff_loan_int_paid_bank, loan_int_cf,
          comm_bal_bf, comm_add, comm_repayment: eff_comm_repayment, comm_repayment_bank: eff_comm_repayment_bank, comm_bal_cf,
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
        if (eff_loan_repayment + eff_loan_repayment_bank > 0 || eff_loan_int_paid + eff_loan_int_paid_bank > 0) {
          loanSyncs.push({
            memberId:      parseInt(memberId),
            principal_paid: eff_loan_repayment + eff_loan_repayment_bank,
            interest_paid:  eff_loan_int_paid  + eff_loan_int_paid_bank,
          });
        }
        generated++;
      }

      // Sync generated repayments into loan tracking tables
      for (const { memberId, principal_paid, interest_paid } of loanSyncs) {
        await syncLoanRepayment(client, memberId, tgtMonth, tgtYear, principal_paid, interest_paid, 'Auto-generated');
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

// ── Patch a single member's entry for a month ─────────────────────────────────
// Admin can update any column value (savings_add, loan_granted, comm_add, etc.)
// and the system recalculates all C/F figures automatically.
async function patchMonthEntry(req, res) {
  const { member_id, month, year, changes } = req.body;
  // changes = { savings_add: 5000, loan_granted: 200000, ... }
  if (!member_id || !month || !year || !changes || typeof changes !== 'object') {
    return res.status(400).json({ error: 'member_id, month, year, and changes object are required' });
  }

  const m = parseInt(month);
  const y = parseInt(year);

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Load all existing data for this member/month
    const existing = await client.query(
      'SELECT column_key, amount FROM monthly_trans WHERE member_id=$1 AND month=$2 AND year=$3',
      [member_id, m, y]
    );
    const data = {};
    for (const r of existing.rows) data[r.column_key] = parseFloat(r.amount) || 0;

    // Apply the changes
    for (const [key, val] of Object.entries(changes)) {
      data[key] = parseFloat(val) || 0;
    }

    const g = (k) => data[k] || 0;

    // Recalculate all C/F values from the updated inputs
    const savings_bf         = g('savings_bf');
    const savings_add        = g('savings_add');
    const savings_add_bank   = g('savings_add_bank');
    const savings_withdrawal = g('savings_withdrawal');
    const savings_cf         = Math.max(0, savings_bf + savings_add + savings_add_bank - savings_withdrawal);

    const loan_bal_bf        = g('loan_bal_bf');
    const loan_granted       = g('loan_granted');
    const loan_balance_before = loan_bal_bf + loan_granted;
    const loan_repayment_raw  = g('loan_repayment');
    const loan_repayment_bank_raw = g('loan_repayment_bank');
    const loan_repayment      = loan_balance_before > 0 ? Math.min(loan_repayment_raw,      loan_balance_before) : 0;
    const loan_repayment_bank = loan_balance_before > 0 ? Math.min(loan_repayment_bank_raw, Math.max(0, loan_balance_before - loan_repayment)) : 0;
    const loan_ledger_bal     = Math.max(0, loan_balance_before - loan_repayment - loan_repayment_bank);

    // Interest: charge on new loans only (flat-rate model)
    const loan_int_bf         = g('loan_int_bf');
    const loan_int_charged    = loan_granted > 0
      ? (() => {
          // fetch interest rate from settings at runtime
          return data['loan_int_charged'] || 0; // keep existing if no new loan
        })()
      : g('loan_int_charged');
    const int_balance_before  = loan_int_bf + loan_int_charged;
    const loan_int_paid_raw   = g('loan_int_paid');
    const loan_int_paid_bank_raw = g('loan_int_paid_bank');
    const loan_int_paid       = int_balance_before > 0 ? Math.min(loan_int_paid_raw,      int_balance_before) : 0;
    const loan_int_paid_bank  = int_balance_before > 0 ? Math.min(loan_int_paid_bank_raw, Math.max(0, int_balance_before - loan_int_paid)) : 0;
    const loan_int_cf         = Math.max(0, int_balance_before - loan_int_paid - loan_int_paid_bank);

    const comm_bal_bf         = g('comm_bal_bf');
    const comm_add            = g('comm_add');
    const comm_balance_before = comm_bal_bf + comm_add;
    const comm_repayment_raw  = g('comm_repayment');
    const comm_repayment_bank_raw = g('comm_repayment_bank');
    const comm_repayment      = comm_balance_before > 0 ? Math.min(comm_repayment_raw,      comm_balance_before) : 0;
    const comm_repayment_bank = comm_balance_before > 0 ? Math.min(comm_repayment_bank_raw, Math.max(0, comm_balance_before - comm_repayment)) : 0;
    const comm_bal_cf         = Math.max(0, comm_balance_before - comm_repayment - comm_repayment_bank);

    const form          = g('form');
    const other_charges = g('other_charges');
    const total_deduction = savings_add + loan_repayment + loan_int_paid + comm_repayment + form + other_charges;

    const finalData = {
      savings_bf, savings_add, savings_add_bank, savings_withdrawal, savings_cf,
      loan_bal_bf, loan_granted, loan_repayment, loan_repayment_bank, loan_ledger_bal,
      loan_int_bf, loan_int_charged, loan_int_paid, loan_int_paid_bank, loan_int_cf,
      comm_bal_bf, comm_add, comm_repayment, comm_repayment_bank, comm_bal_cf,
      form, other_charges, total_deduction,
    };

    for (const [key, amount] of Object.entries(finalData)) {
      await client.query(`
        INSERT INTO monthly_trans (member_id, column_key, amount, month, year)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (member_id, column_key, month, year)
        DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()
      `, [member_id, key, amount, m, y]);
    }

    await client.query('COMMIT');
    res.json({ message: 'Entry updated and recalculated', data: finalData });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

module.exports = { getDeductions, upsertDeductions, uploadTransCSV, getTransColumns, updateTransColumn, generateNextMonth, patchMonthEntry };
