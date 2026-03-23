const db = require('../db');
const { parse } = require('csv-parse/sync');

// Headers that identify the member — not stored as financial data
const IDENTITY_HEADERS = new Set(['s/n', 'month', 'l/no', 'ippis no', 'name', 'staff no']);

function normalizeLabel(h) {
  return h.toLowerCase()
    .replace(/\s+/g, ' ')
    // Remove content in parentheses and brackets for better matching
    .replace(/\s*\(.*?\)\s*/g, '')
    .replace(/\s*\[.*?\]\s*/g, '')
    .replace(/\s*\{.*?\}\s*/g, '')
    .trim();
}

function canonicalizeLabel(h) {
  return String(h || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\//g, ' ')
    // Remove content in parentheses and brackets for better matching
    .replace(/\s*\(.*?\)\s*/g, '')
    .replace(/\s*\[.*?\]\s*/g, '')
    .replace(/\s*\{.*?\}\s*/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function parseAmountCell(val) {
  if (val === null || val === undefined) return { amount: 0, formulaError: false };
  const text = String(val).replace(/\"/g, '').trim();
  if (!text) return { amount: 0, formulaError: false, empty: true };
  if (/^#(REF|VALUE|DIV\/0|N\/A|NAME\?|NUM|NULL)!?$/i.test(text)) {
    return { amount: null, formulaError: true, empty: false };
  }
  return { amount: parseAmount(text), formulaError: false, empty: false };
}

function computeDerivedValue(key, amounts) {
  const g = (k) => parseFloat(amounts[k]) || 0;
  if (key === 'total_deduction') {
    return g('savings_add') + g('savings_add_bank') + g('loan_repayment') + g('loan_repayment_bank') + g('loan_int_paid') + g('loan_int_paid_bank') + g('comm_repayment') + g('comm_repayment_bank') + g('form') + g('other_charges');
  }
  if (key === 'to_payroll') {
    return g('total_deduction') - g('total_payment_bank');
  }
  if (key === 'differences') {
    return g('total_deduction') - g('payroll_deduction');
  }
  return null;
}

function matchPatternKey(rawLabel) {
  const s = canonicalizeLabel(rawLabel);

  if (/^savings\s+b\s*f(\s+\w+)*$/.test(s)) return 'savings_bf';
  if (s.includes('add') && s.includes('sav') && s.includes('during') && s.includes('month') && s.includes('bank')) return 'savings_add_bank';
  if (s.includes('add') && s.includes('sav') && s.includes('during') && s.includes('month')) return 'savings_add';
  if (s.includes('less') && s.includes('withdraw')) return 'savings_withdrawal';
  if (s.includes('net') && s.includes('saving') && (s.includes('c f') || s.includes('cf'))) return 'savings_cf';

  if (s.includes('loan') && s.includes('prin') && s.includes('bal') && s.includes('b') && s.includes('f')) return 'loan_bal_bf';
  if (s.includes('add') && s.includes('loan') && s.includes('granted') && s.includes('month')) return 'loan_granted';
  if (s.includes('less') && s.includes('loan') && s.includes('principal') && s.includes('repayment') && s.includes('bank')) return 'loan_repayment_bank';
  if (s.includes('less') && s.includes('loan') && s.includes('principal') && s.includes('repayment')) return 'loan_repayment';
  if (s.includes('loan') && s.includes('ledger') && s.includes('bal')) return 'loan_ledger_bal';
  if (s.includes('loan') && s.includes('status')) return 'loan_status';
  if (s.includes('ln') && s.includes('duration') && s.includes('left')) return 'ln_duration_left';

  if (s.includes('loan') && s.includes('interest') && s.includes('balance') && s.includes('b') && s.includes('f')) return 'loan_int_bf';
  if (s.includes('interest') && s.includes('charged') && s.includes('loan') && s.includes('month')) return 'loan_int_charged';
  if (s.includes('less') && s.includes('loan') && s.includes('interest') && s.includes('paid') && s.includes('bank')) return 'loan_int_paid_bank';
  if (s.includes('less') && s.includes('loan') && s.includes('interest') && s.includes('paid')) return 'loan_int_paid';
  if (s.includes('loan') && s.includes('interest') && s.includes('balance') && (s.includes('c f') || s.includes('cf'))) return 'loan_int_cf';

  if (s.includes('commodity') && s.includes('sales') && s.includes('bal') && s.includes('b') && s.includes('f')) return 'comm_bal_bf';
  if (s.includes('add') && (s.includes('comm') || s.includes('commodity')) && s.includes('sales') && s.includes('month')) return 'comm_add';
  if (s.includes('less') && (s.includes('comm') || s.includes('commodity')) && s.includes('sales') && s.includes('repay') && s.includes('bank')) return 'comm_repayment_bank';
  if (s.includes('less') && (s.includes('comm') || s.includes('commodity')) && s.includes('sales') && s.includes('repay')) return 'comm_repayment';
  if (s.includes('comm') && s.includes('sales') && s.includes('bal') && (s.includes('c f') || s.includes('cf'))) return 'comm_bal_cf';
  if (s.includes('comm') && s.includes('status')) return 'comm_gad_status';
  if (s.includes('com') && s.includes('gad') && s.includes('duration') && s.includes('left')) return 'com_gad_duration_left';

  if (s === 'form' || s.includes('form fee')) return 'form';
  if (s.includes('other') && s.includes('charge')) return 'other_charges';
  if (s.includes('total') && s.includes('deduction')) return 'total_deduction';
  if (s.includes('total') && s.includes('payment') && s.includes('bank')) return 'total_payment_bank';
  if (s.includes('to') && s.includes('payroll')) return 'to_payroll';
  if (s.includes('payroll') && s.includes('deduction')) return 'payroll_deduction';
  if (s.includes('difference')) return 'differences';

  return null;
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
  'add sav during the month':                     'savings_add',
  'add: sav during the month':                    'savings_add',
  'add sav. during the month':                    'savings_add',
  'add: sav. during the month':                   'savings_add',
  'add savings during the month (bank)':          'savings_add_bank',
  'add: savings during the month (bank)':         'savings_add_bank',
  'add sav during the month (bank)':              'savings_add_bank',
  'add: sav during the month (bank)':             'savings_add_bank',
  'add sav. during the month (bank)':             'savings_add_bank',
  'add: sav. during the month (bank)':            'savings_add_bank',
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
  'less: loan interest paid':                     'loan_int_paid',
  'less loan interest paid':                      'loan_int_paid',
  'loan interest paid':                           'loan_int_paid',
  'less loan interest paid (bank)':              'loan_int_paid_bank',
  'less: loan interest paid  (bank)':            'loan_int_paid_bank',
  'less: loan interest paid (bank)':             'loan_int_paid_bank',
  'less: loan interest paid ( bank)':            'loan_int_paid_bank',
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
  'total payment (bank)':                        'total_payment_bank',
  'to payroll':                                  'to_payroll',
  'from payroll payroll deduction':              'payroll_deduction',
  '(from payroll) payroll deduction':            'payroll_deduction',
  'payroll deduction':                           'payroll_deduction',
  'differences':                                 'differences',
  'differences (if not 0.00 adjust)':            'differences',
  'difference':                                  'differences',
  'total deduction':                             'total_deduction',
  'total deductions':                            'total_deduction',
};

// Resolve a CSV header label to a canonical key, checking aliases first
function resolveKey(label, labelToKey) {
  const norm = normalizeLabel(label);
  const canon = canonicalizeLabel(label);
  // 1. Check alias table (covers all known Excel header variants)
  if (LABEL_ALIASES[norm]) return LABEL_ALIASES[norm];
  if (LABEL_ALIASES[canon]) return LABEL_ALIASES[canon];
  // 2. Check existing trans_columns by label
  if (labelToKey[norm]) return labelToKey[norm];
  if (labelToKey[canon]) return labelToKey[canon];
  // 3. Pattern matching for highly specific/verbose headers
  const patternKey = matchPatternKey(label);
  if (patternKey) return patternKey;
  // 3. Fall back to auto-generated key from label
  return null;
}

// ── Get enabled trans columns with caching ─────────────────────────────────────────
async function getTransColumns(req, res) {
  try {
    // Add cache control headers
    res.set('Cache-Control', 'public, max-age=300'); // Cache for 5 minutes
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

// Called after CSV upload or month generation so loan tracking stays current.
async function syncLoanRepayment(client, memberId, month, year, principalPaid, interestPaid, description) {
  if (principalPaid <= 0 && interestPaid <= 0) {
    // No repayment made - apply penalty
    const loanRes = await client.query(
      "SELECT id, remaining_balance, total_interest, interest_paid AS int_paid, months_paid, months_remaining FROM loans WHERE member_id=$1 AND status='active' ORDER BY created_at ASC LIMIT 1",
      [memberId]
    );
    if (!loanRes.rows.length) return;
    
    const loan = loanRes.rows[0];
    
    // Get penalty percentage from settings (default 10%)
    const penaltyRateRes = await client.query("SELECT value FROM app_settings WHERE key='loan_penalty_rate'");
    const penaltyRate = parseFloat(penaltyRateRes.rows[0]?.value || '10') / 100;
    
    // Calculate penalty: 10% of remaining interest only
    const remainingInterest = parseFloat(loan.total_interest) - parseFloat(loan.int_paid);
    const penaltyAmount = remainingInterest * penaltyRate;
    
    // Add penalty to loan balance and distribute over remaining months
    const newBalance = parseFloat(loan.remaining_balance) + penaltyAmount;
    const newMonthsRemaining = Math.max(0, parseInt(loan.months_remaining || 0));
    
    // Update loan with penalty and new balance
    await client.query(
      'UPDATE loans SET remaining_balance=$1, total_interest=total_interest+$2, months_remaining=$3, updated_at=NOW() WHERE id=$4',
      [newBalance, penaltyAmount, newMonthsRemaining, loan.id]
    );
    
    // Add penalty as a loan repayment entry for tracking
    await client.query(
      'INSERT INTO loan_repayments (loan_id, member_id, principal_paid, interest_paid, month, year, description) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [loan.id, memberId, 0, penaltyAmount, month, year, `Penalty for unpaid month (${(penaltyRate * 100)}% of remaining interest)`]
    );
    
    return;
  }
  
  // Original logic for when repayment is made
  const loanRes = await client.query(
    "SELECT id, remaining_balance, interest_paid AS int_paid, months_paid, months_remaining FROM loans WHERE member_id=$1 AND status='active' ORDER BY created_at ASC LIMIT 1",
    [memberId]
  );
  if (!loanRes.rows.length) return;
  const loan = loanRes.rows[0];
  const newBalance = Math.max(0, parseFloat(loan.remaining_balance) - principalPaid);
  const newMonthsRemaining = Math.max(0, parseInt(loan.months_remaining || 0) - 1);
  const newStatus  = newBalance <= 0 ? 'cleared' : 'active';
  await client.query(
    'UPDATE loans SET remaining_balance=$1, interest_paid=interest_paid+$2, months_paid=months_paid+1, months_remaining=$3, status=$4, updated_at=NOW() WHERE id=$5',
    [newBalance, interestPaid, newMonthsRemaining, newStatus, loan.id]
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

    const headerRow = records[0].map((h) => (h || '').trim());

    const existingCols = await db.query('SELECT key, label FROM trans_columns');
    const labelToKey = {};
    for (const row of existingCols.rows) {
      labelToKey[normalizeLabel(row.label)] = row.key;
      labelToKey[canonicalizeLabel(row.label)] = row.key;
    }

    const lNoIdx     = headerRow.findIndex((h) => normalizeLabel(h) === 'l/no');
    const staffNoIdx = headerRow.findIndex((h) => normalizeLabel(h) === 'staff no');
    const ippisIdx   = headerRow.findIndex((h) => normalizeLabel(h) === 'ippis no');
    const snIdx      = headerRow.findIndex((h) => normalizeLabel(h) === 's/n');
    const nameIdx    = headerRow.findIndex((h) => normalizeLabel(h) === 'name');

    if (lNoIdx === -1) {
      return res.status(400).json({ error: 'CSV must have an L/No column' });
    }

    const financialCols = [];
    const newColInserts = { ledgers: [], labels: [], sorts: [] };
    for (let i = 0; i < headerRow.length; i++) {
      const h = headerRow[i];
      if (!h || IDENTITY_HEADERS.has(normalizeLabel(h))) continue;

      let colKey = resolveKey(h, labelToKey);
      if (!colKey) {
        colKey = makeKey(h).slice(0, 150) || `col_${i}`;
        newColInserts.ledgers.push(colKey);
        newColInserts.labels.push(h);
        newColInserts.sorts.push(i);
        labelToKey[normalizeLabel(h)] = colKey;
        labelToKey[canonicalizeLabel(h)] = colKey;
      } else {
        const canonMeta = CANONICAL_LABELS[colKey];
        if (canonMeta) {
          newColInserts.ledgers.push(colKey);
          newColInserts.labels.push(canonMeta.label);
          newColInserts.sorts.push(canonMeta.sort);
        }
      }
      financialCols.push({ idx: i, key: colKey });
    }

    if (newColInserts.ledgers.length > 0) {
      await db.query(
        `INSERT INTO trans_columns (key, label, sort_order)
         SELECT * FROM UNNEST($1::text[], $2::text[], $3::int[])
         ON CONFLICT (key) DO NOTHING`,
        [newColInserts.ledgers, newColInserts.labels, newColInserts.sorts]
      );
    }

    const allMembers = await db.query('SELECT id, LOWER(ledger_no) AS ln, LOWER(staff_no) AS sn FROM members');
    const byLedger = new Map();
    const byStaff  = new Map();
    for (const r of allMembers.rows) {
      if (r.ln) byLedger.set(r.ln, r.id);
      if (r.sn) byStaff.set(r.sn,  r.id);
    }

    const dataRows = [];
    const newMembers = [];

    for (let rowIdx = 1; rowIdx < records.length; rowIdx++) {
      const row = records[rowIdx];
      if (!row || row.length === 0) continue;
      const snVal  = snIdx  >= 0 ? (row[snIdx]  || '').trim() : '';
      const lNoVal = lNoIdx >= 0 ? (row[lNoIdx] || '').trim() : '';
      if (snVal && isNaN(Number(snVal))) continue;
      if (!snVal && !lNoVal) continue;

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

      const tMemberIds = [];
      const tColKeys   = [];
      const tAmounts   = [];
      const tMonths    = [];
      const tYears     = [];

      let matched   = 0;
      let unmatched = 0;
      let formulaResolved = 0;
      let formulaFallback = 0;
      const unmatchedRows = [];

      const loanSyncMap = new Map();
      const durationOverrides = new Map();

      for (const dr of dataRows) {
        const memberId = dr.existId ||
                         byLedger.get(dr.lNoVal.toLowerCase()) ||
                         (dr.staffNo ? byStaff.get(dr.staffNo.toLowerCase()) : null);
        if (!memberId) { unmatched++; unmatchedRows.push(dr.lNoVal || dr.staffNo); continue; }

        const rowAmounts = {};
        const rowValueQuality = {};
        const formulaKeys = new Set();

        for (const col of financialCols) {
          const raw = col.idx < dr.row.length ? dr.row[col.idx] : '';
          const parsed = parseAmountCell(raw);
          const quality = parsed.formulaError ? 1 : (parsed.empty ? 0 : 2);

          if (rowAmounts[col.key] === undefined || quality > (rowValueQuality[col.key] ?? -1)) {
            rowAmounts[col.key] = parsed.formulaError ? 0 : parsed.amount;
            rowValueQuality[col.key] = quality;
          }

          if (parsed.formulaError) {
            formulaKeys.add(col.key);
          }
        }

        for (const key of formulaKeys) {
          const derived = computeDerivedValue(key, rowAmounts);
          if (derived !== null) {
            rowAmounts[key] = derived;
            formulaResolved++;
          } else {
            formulaFallback++;
          }
        }

        if (rowAmounts.ln_duration_left !== undefined) {
          const monthsLeft = Math.max(0, Math.round(parseFloat(rowAmounts.ln_duration_left) || 0));
          durationOverrides.set(memberId, monthsLeft);
        }

        for (const [colKey, amtRaw] of Object.entries(rowAmounts)) {
          const amt = parseFloat(amtRaw) || 0;
          tMemberIds.push(memberId);
          tColKeys.push(colKey);
          tAmounts.push(amt);
          tMonths.push(m);
          tYears.push(y);
          if (colKey === 'loan_repayment' || colKey === 'loan_repayment_bank') {
            const e = loanSyncMap.get(memberId) || { principal_paid: 0, interest_paid: 0 };
            e.principal_paid += amt;
            loanSyncMap.set(memberId, e);
          } else if (colKey === 'loan_int_paid' || colKey === 'loan_int_paid_bank') {
            const e = loanSyncMap.get(memberId) || { principal_paid: 0, interest_paid: 0 };
            e.interest_paid += amt;
            loanSyncMap.set(memberId, e);
          }
        }
        matched++;
      }

      if (tMemberIds.length > 0) {
        await client.query(
          `INSERT INTO monthly_trans (member_id, column_key, amount, month, year)
           SELECT * FROM UNNEST($1::int[], $2::text[], $3::numeric[], $4::int[], $5::int[])
           ON CONFLICT (member_id, column_key, month, year)
           DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()`,
          [tMemberIds, tColKeys, tAmounts, tMonths, tYears]
        );
      }

      // Create actual savings records from CSV data for proper display
      const savingsRecords = [];
      for (let i = 0; i < tMemberIds.length; i++) {
        if (tColKeys[i] === 'savings_add') {
          savingsRecords.push([
            tMemberIds[i],           // member_id
            tAmounts[i],             // amount
            tMonths[i],              // month
            tYears[i],               // year
            `Monthly Savings - ${m}/${y}` // description
          ]);
        } else if (tColKeys[i] === 'savings_bf') {
          savingsRecords.push([
            tMemberIds[i],           // member_id
            tAmounts[i],             // amount
            tMonths[i],              // month
            tYears[i],               // year
            `Opening Balance - ${m}/${y}` // description
          ]);
        }
      }

      if (savingsRecords.length > 0) {
        // Convert array of arrays to separate arrays for UNNEST
        const savMemberIds = savingsRecords.map(r => r[0]);
        const savAmounts = savingsRecords.map(r => r[1]);
        const savMonths = savingsRecords.map(r => r[2]);
        const savYears = savingsRecords.map(r => r[3]);
        const savDescriptions = savingsRecords.map(r => r[4]);
        
        await client.query(
          `INSERT INTO savings (member_id, amount, month, year, description)
           SELECT * FROM UNNEST($1::int[], $2::numeric[], $3::int[], $4::int[], $5::text[])
           ON CONFLICT (member_id, month, year) 
           DO UPDATE SET amount = EXCLUDED.amount, description = EXCLUDED.description`,
          [savMemberIds, savAmounts, savMonths, savYears, savDescriptions]
        );
      }

      for (const [memberId, { principal_paid, interest_paid }] of loanSyncMap) {
        await syncLoanRepayment(client, memberId, m, y, principal_paid, interest_paid, null);
      }

      for (const [memberId, monthsLeft] of durationOverrides) {
        await client.query(
          `UPDATE loans
           SET months_remaining = $1, updated_at = NOW()
           WHERE member_id = $2 AND status = 'active'`,
          [monthsLeft, memberId]
        );
      }

      const expiredLoansRes = await client.query(`
        SELECT DISTINCT m.id, m.full_name, m.ledger_no
        FROM loans l
        JOIN members m ON m.id = l.member_id
        WHERE l.months_remaining = 0 
          AND l.remaining_balance > 0 
          AND l.status = 'active'
          AND m.is_active = TRUE
      `);

      const deactivatedMembers = [];
      for (const row of expiredLoansRes.rows) {
        await client.query(
          `UPDATE members
           SET is_active = FALSE, deactivation_reason = 'loan_complete', updated_at = NOW()
           WHERE id = $1`,
          [row.id]
        );
        deactivatedMembers.push(`${row.ledger_no} (${row.full_name})`);
      }

      await client.query('COMMIT');
      const created = newMembers.length;
      let message = `Imported ${matched} member${matched !== 1 ? 's' : ''}${created ? ` (${created} new member${created !== 1 ? 's' : ''} created)` : ''}${unmatched ? ` (${unmatched} unmatched)` : ''}`;
      if (deactivatedMembers.length > 0) {
        message += `\n\nDEACTIVATED (loan duration = 0 with outstanding balance): ${deactivatedMembers.join(', ')}`;
      }
      
      console.log('Upload successful, sending response:', { matched, created, unmatched });
      res.json({
        ok: true,
        matched,
        created,
        unmatched,
        formulaResolved,
        formulaFallback,
        unmatchedRows,
        deactivated: deactivatedMembers.length,
        deactivatedMembers,
        message,
      });
    } catch (err) {
      console.error('Upload error:', err);
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Final upload error:', err);
    res.status(500).json({ error: err.message });
  }
}

// ── Get deductions for a month (reads from monthly_trans) ────────────────────
async function getDeductions(req, res) {
  const { month, year } = req.query;
  const m = parseInt(month) || new Date().getMonth() + 1;
  const y = parseInt(year)  || new Date().getFullYear();

  try {
    // Get only the required columns for reports
    const membersResult = await db.query(`
      SELECT 
        m.id, 
        m.ledger_no, 
        m.staff_no, 
        m.gifmis_no,
        m.full_name,
        COALESCE(mt_savings.amount, 0) AS savings,
        COALESCE(mt_savings_bank.amount, 0) AS savings_bank,
        COALESCE(mt_loan_repayment.amount, 0) AS loan_repayment,
        COALESCE(mt_loan_repayment_bank.amount, 0) AS loan_repayment_bank,
        COALESCE(mt_loan_interest.amount, 0) AS loan_interest,
        COALESCE(mt_commodity.amount, 0) AS commodity_repayment,
        COALESCE(mt_form.amount, 0) AS membership_loan_form,
        COALESCE(mt_other.amount, 0) AS other_charges,
        -- Calculate total deduction as sum of all components
        (COALESCE(mt_savings.amount, 0) + 
         COALESCE(mt_savings_bank.amount, 0) +
         COALESCE(mt_loan_repayment.amount, 0) + 
         COALESCE(mt_loan_repayment_bank.amount, 0) +
         COALESCE(mt_loan_interest.amount, 0) + 
         COALESCE(mt_commodity.amount, 0) + 
         COALESCE(mt_form.amount, 0) + 
         COALESCE(mt_other.amount, 0)) AS total_deductions
      FROM members m
      LEFT JOIN monthly_trans mt_savings ON mt_savings.member_id = m.id AND mt_savings.column_key = 'savings_add' AND mt_savings.month = $1 AND mt_savings.year = $2
      LEFT JOIN monthly_trans mt_savings_bank ON mt_savings_bank.member_id = m.id AND mt_savings_bank.column_key = 'savings_add_bank' AND mt_savings_bank.month = $1 AND mt_savings_bank.year = $2
      LEFT JOIN monthly_trans mt_loan_repayment ON mt_loan_repayment.member_id = m.id AND mt_loan_repayment.column_key = 'loan_repayment' AND mt_loan_repayment.month = $1 AND mt_loan_repayment.year = $2
      LEFT JOIN monthly_trans mt_loan_repayment_bank ON mt_loan_repayment_bank.member_id = m.id AND mt_loan_repayment_bank.column_key = 'loan_repayment_bank' AND mt_loan_repayment_bank.month = $1 AND mt_loan_repayment_bank.year = $2
      LEFT JOIN monthly_trans mt_loan_interest ON mt_loan_interest.member_id = m.id AND mt_loan_interest.column_key = 'loan_int_paid' AND mt_loan_interest.month = $1 AND mt_loan_interest.year = $2
      LEFT JOIN monthly_trans mt_commodity ON mt_commodity.member_id = m.id AND mt_commodity.column_key = 'comm_repayment' AND mt_commodity.month = $1 AND mt_commodity.year = $2
      LEFT JOIN monthly_trans mt_form ON mt_form.member_id = m.id AND mt_form.column_key = 'form' AND mt_form.month = $1 AND mt_form.year = $2
      LEFT JOIN monthly_trans mt_other ON mt_other.member_id = m.id AND mt_other.column_key = 'other_charges' AND mt_other.month = $1 AND mt_other.year = $2
      WHERE m.is_active = TRUE
      ORDER BY m.ledger_no
    `, [m, y]);

    const hasData = membersResult.rows.some(row => 
      row.savings > 0 || row.savings_bank > 0 || row.loan_repayment > 0 || row.loan_repayment_bank > 0 || 
      row.loan_interest > 0 || row.commodity_repayment > 0 || row.membership_loan_form > 0 || row.other_charges > 0
    );

    // Define the fixed columns for reports
    const columns = [
      { key: 'ledger_no', label: 'L/No', enabled: true, sort_order: 1 },
      { key: 'full_name', label: 'Name', enabled: true, sort_order: 2 },
      { key: 'staff_no', label: 'Staff No', enabled: true, sort_order: 3 },
      { key: 'gifmis_no', label: 'GIFMIS No', enabled: true, sort_order: 4 },
      { key: 'savings', label: 'SAVINGS', enabled: true, sort_order: 5 },
      { key: 'savings_bank', label: 'SAVINGS (BANK)', enabled: true, sort_order: 6 },
      { key: 'loan_repayment', label: 'LOAN REPAYMENT', enabled: true, sort_order: 7 },
      { key: 'loan_repayment_bank', label: 'LOAN REPAYMENT (BANK)', enabled: true, sort_order: 8 },
      { key: 'loan_interest', label: 'LN INTEREST', enabled: true, sort_order: 9 },
      { key: 'commodity_repayment', label: 'COMMODITY REPAYMENT', enabled: true, sort_order: 10 },
      { key: 'membership_loan_form', label: 'MEMBERSHIP/LOAN FORM', enabled: true, sort_order: 11 },
      { key: 'other_charges', label: 'OTHER CHARGES', enabled: true, sort_order: 12 },
      { key: 'total_deductions', label: 'TOTAL DEDUCTIONS', enabled: true, sort_order: 13 }
    ];

    res.json({ columns, members: membersResult.rows, month: m, year: y, hasData });
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

// ── Upload reconciliation CSV from payroll ───────────────────────────────────
async function uploadReconciliationCSV(req, res) {
  const { month, year } = req.body;
  const m = parseInt(month);
  const y = parseInt(year);

  if (!m || !y || !req.file) {
    return res.status(400).json({ error: 'file, month, and year are required' });
  }

  try {
    const records = parse(req.file.buffer, {
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
    });

    if (records.length < 2) {
      return res.status(400).json({ error: 'CSV is too short' });
    }

    // Expected format: Staff No, Member Name, Total Amount
    const headerRow = records[0].map((h) => (h || '').trim().toLowerCase());
    const staffNoIdx = headerRow.findIndex((h) => h.includes('staff'));
    const amountIdx = headerRow.findIndex((h) => h.includes('amount') || h.includes('total'));

    if (staffNoIdx === -1 || amountIdx === -1) {
      return res.status(400).json({ error: 'CSV must have Staff No and Total Amount columns' });
    }

    // Parse reconciliation data
    const reconciliationData = {};
    let processed = 0;

    for (let i = 1; i < records.length; i++) {
      const row = records[i];
      if (!row || row.length === 0) continue;

      const staffNo = String(row[staffNoIdx] || '').trim();
      const amount = parseFloat((row[amountIdx] || '').replace(/[,"]/g, '')) || 0;
      const staffKey = staffNo.toLowerCase();

      if (staffKey && !isNaN(amount)) {
        reconciliationData[staffKey] = (reconciliationData[staffKey] || 0) + amount;
        processed++;
      }
    }

    // Store reconciliation data
    await db.query(
      `INSERT INTO reconciliation_data (month, year, data, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (month, year)
       DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [m, y, JSON.stringify(reconciliationData)]
    );

    res.json({
      message: `Reconciliation data uploaded for ${processed} members`,
      processed,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── Get reconciliation data for a month ──────────────────────────────────────
async function getReconciliationData(req, res) {
  const { month, year } = req.query;
  const m = parseInt(month) || new Date().getMonth() + 1;
  const y = parseInt(year) || new Date().getFullYear();

  try {
    const result = await db.query(
      'SELECT data FROM reconciliation_data WHERE month=$1 AND year=$2',
      [m, y]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No reconciliation data found' });
    }

    res.json({
      reconciliation: result.rows[0].data,
      month: m,
      year: y,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
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

        // Total deduction (includes both salary and bank payments)
        const total_deduction = savings_add + savings_add_bank + eff_loan_repayment + eff_loan_repayment_bank + eff_loan_int_paid + eff_loan_int_paid_bank + eff_comm_repayment + eff_comm_repayment_bank + form + other_charges;

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
    const total_deduction = savings_add + savings_add_bank + loan_repayment + loan_repayment_bank + loan_int_paid + loan_int_paid_bank + comm_repayment + comm_repayment_bank + form + other_charges;

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

module.exports = { 
  getDeductions, 
  upsertDeductions, 
  uploadTransCSV, 
  getTransColumns, 
  updateTransColumn, 
  generateNextMonth, 
  patchMonthEntry,
  uploadReconciliationCSV,
  getReconciliationData
};
