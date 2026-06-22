const db = require('../db');
const { parse } = require('csv-parse/sync');

// Headers that identify the member — not stored as financial data
const IDENTITY_HEADERS = new Set([
  's/n', 'month', 'l/no', 'ippis no', 'name', 'staff no',
  'gender', 'marital status', 'phone', 'phone no', 'gsm no', 'gsm',
  'email', 'e-mail', 'bank', 'account', 'account number', 'acct',
  'department', 'next of kin', 'kin', 'relation', 'date of admission'
]);
const toDateOrNull = (v) => {
  if (!v || typeof v !== 'string') return null;
  const s = v.trim();
  return s === '' ? null : s;
};

function normalizeLabel(h) {
  return h.toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalizeLabel(h) {
  return String(h || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\//g, ' ')
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
    return g('savings_add') + g('savings_add_bank') + g('loan_repayment') + g('loan_repayment_bank') 
         + g('loan_int_paid') + g('loan_int_paid_bank') + g('comm_repayment') + g('comm_repayment_bank') 
         + g('form') + g('other_charges');
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

const LABEL_ALIASES = {
  'savings b/f': 'savings_bf', 'savings bf': 'savings_bf', 'savings b f': 'savings_bf',
  'add savings during the month': 'savings_add', 'add: savings during the month': 'savings_add',
  'add sav during the month': 'savings_add', 'add: sav during the month': 'savings_add',
  'add sav. during the month': 'savings_add', 'add: sav. during the month': 'savings_add',
  'add savings during the month (bank)': 'savings_add_bank', 'add: savings during the month (bank)': 'savings_add_bank',
  'add sav during the month (bank)': 'savings_add_bank', 'add: sav during the month (bank)': 'savings_add_bank',
  'add sav. during the month (bank)': 'savings_add_bank', 'add: sav. during the month (bank)': 'savings_add_bank',
  'less withdrawal': 'savings_withdrawal', 'less: withdrawal': 'savings_withdrawal',
  'net saving c/f': 'savings_cf', 'net savings c/f': 'savings_cf', 'savings c/f': 'savings_cf', 'savings cf': 'savings_cf',
  
  'loan prin. bal. b/f': 'loan_bal_bf', 'loan principal balance b/f': 'loan_bal_bf',
  'loan prin bal b/f': 'loan_bal_bf', 'loan bal b/f': 'loan_bal_bf', 'loan bal bf': 'loan_bal_bf', 'loan b/f': 'loan_bal_bf',
  'add loan granted this month (auto)': 'loan_granted', 'add: loan granted this month (auto)': 'loan_granted',
  'add: loan granted this month': 'loan_granted', 'loan granted this month': 'loan_granted',
  'less loan principal repayment': 'loan_repayment', 'less: loan principal repayment': 'loan_repayment',
  'loan principal repayment': 'loan_repayment', 'loan repayment': 'loan_repayment',
  'less loan principal repayment (bank)': 'loan_repayment_bank', 'less: loan principal repayment (bank)': 'loan_repayment_bank',
  'loan repayment (bank)': 'loan_repayment_bank',
  'loan ledger bal.': 'loan_ledger_bal', 'loan ledger bal': 'loan_ledger_bal', 'loan ledger balance': 'loan_ledger_bal',
  
  'loan interest balance b/f': 'loan_int_bf', 'loan int balance b/f': 'loan_int_bf',
  'loan int b/f': 'loan_int_bf', 'loan interest b/f': 'loan_int_bf',
  'add interest charged on loan granted this month': 'loan_int_charged',
  'add:interest charged on loan granted this month:': 'loan_int_charged',
  'add: interest charged on loan granted this month:': 'loan_int_charged',
  'interest charged on loan granted this month': 'loan_int_charged', 'loan int charged': 'loan_int_charged',
  'less loan interest paid this month': 'loan_int_paid', 'less: loan interest paid this month': 'loan_int_paid',
  'loan interest paid this month': 'loan_int_paid', 'loan int paid': 'loan_int_paid', 'ln int paid': 'loan_int_paid',
  'less: loan interest paid': 'loan_int_paid', 'less loan interest paid': 'loan_int_paid', 'loan interest paid': 'loan_int_paid',
  'less loan interest paid (bank)': 'loan_int_paid_bank', 'less: loan interest paid  (bank)': 'loan_int_paid_bank',
  'less: loan interest paid (bank)': 'loan_int_paid_bank', 'less: loan interest paid ( bank)': 'loan_int_paid_bank',
  'loan interest paid (bank)': 'loan_int_paid_bank',
  'loan interest balance c/f': 'loan_int_cf', 'loan int balance c/f': 'loan_int_cf',
  'loan int c/f': 'loan_int_cf', 'loan interest c/f': 'loan_int_cf', 'loan int cf': 'loan_int_cf',
  
  'commodity sales bal. b/f': 'comm_bal_bf', 'commodity sales bal b/f': 'comm_bal_bf',
  'comm. sales bal. b/f': 'comm_bal_bf', 'comm sales bal b/f': 'comm_bal_bf',
  'commodity bal. b/f': 'comm_bal_bf', 'commodity b/f': 'comm_bal_bf',
  'add comm. sales during the month': 'comm_add', 'add: comm. sales during the month': 'comm_add',
  'commodity sales during the month': 'comm_add', 'comm sales during the month': 'comm_add',
  'less commodity sales repayment': 'comm_repayment', 'less: commodity sales repayment': 'comm_repayment',
  'less: commodity sales repayment ': 'comm_repayment', 'commodity sales repayment': 'comm_repayment', 'comm repayment': 'comm_repayment',
  'less commodity sales repayment (bank)': 'comm_repayment_bank', 'less: comm. sales repay. (bank)': 'comm_repayment_bank',
  'less: commodity sales repay. (bank)': 'comm_repayment_bank', 'comm. sales repay. (bank)': 'comm_repayment_bank',
  'comm. sales bal. c/f': 'comm_bal_cf', 'commodity sales bal. c/f': 'comm_bal_cf',
  'comm sales bal c/f': 'comm_bal_cf', 'commodity c/f': 'comm_bal_cf',
  
  'form': 'form', 'form fee': 'form',
  'other charges': 'other_charges', 'other charge': 'other_charges',
  'total payment (bank)': 'total_payment_bank', 'to payroll': 'to_payroll',
  'from payroll payroll deduction': 'payroll_deduction', '(from payroll) payroll deduction': 'payroll_deduction',
  'payroll deduction': 'payroll_deduction', 'differences': 'differences',
  'differences (if not 0.00 adjust)': 'differences', 'difference': 'differences',
  'total deduction': 'total_deduction', 'total deductions': 'total_deduction',
};

function resolveKey(label, labelToKey) {
  const norm = normalizeLabel(label);
  const canon = canonicalizeLabel(label);
  if (LABEL_ALIASES[norm]) return LABEL_ALIASES[norm];
  if (LABEL_ALIASES[canon]) return LABEL_ALIASES[canon];
  if (labelToKey[norm]) return labelToKey[norm];
  if (labelToKey[canon]) return labelToKey[canon];
  const patternKey = matchPatternKey(label);
  if (patternKey) return patternKey;
  return null;
}

async function getTransColumns(req, res) {
  try {
    res.set('Cache-Control', 'public, max-age=300');
    const r = await db.query('SELECT * FROM trans_columns ORDER BY sort_order, id');
    res.json({ columns: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

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

// Sync repayments from monthly deductions to loan tracking
async function syncLoanRepayment(client, memberId, month, year, principalPaid, interestPaid, description) {
  // If no payment made, skip
  if (principalPaid <= 0 && interestPaid <= 0) {
    return;
  }
  
  // Get active or partially cleared loans
  const loanRes = await client.query(
    `SELECT id, remaining_balance, total_interest, interest_paid AS int_paid, months_paid, months_remaining, status
     FROM loans
     WHERE member_id=$1
       AND (status='active' OR (status='cleared' AND interest_paid < total_interest))
     ORDER BY created_at ASC
     LIMIT 1`,
    [memberId]
  );
  if (!loanRes.rows.length) return;
  
  const loan = loanRes.rows[0];
  const remainingBalance = parseFloat(loan.remaining_balance) || 0;
  const totalInterest = parseFloat(loan.total_interest) || 0;
  const interestPaidSoFar = parseFloat(loan.int_paid) || 0;
  
  // Apply payment (trust the data, no MIN() caps)
  const principalApplied = loan.status === 'cleared' ? 0 : Math.max(0, principalPaid || 0);
  const interestApplied = Math.max(0, interestPaid || 0);
  const hasPayment = principalApplied > 0 || interestApplied > 0;
  
  if (!hasPayment) return;

  const newBalance = Math.max(0, remainingBalance - principalApplied);
  const newMonthsRemaining = Math.max(0, parseInt(loan.months_remaining || 0) - 1);
  const newStatus = newBalance <= 0 ? 'cleared' : 'active';
  
  await client.query(
    'UPDATE loans SET remaining_balance=$1, interest_paid=$2, months_paid=months_paid+1, months_remaining=$3, status=$4, updated_at=NOW() WHERE id=$5',
    [newBalance, Math.min(totalInterest, interestPaidSoFar + interestApplied), newMonthsRemaining, newStatus, loan.id]
  );

  await client.query(
    'INSERT INTO loan_repayments (loan_id, member_id, principal_paid, interest_paid, month, year, description) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [loan.id, memberId, principalApplied, interestApplied, month, year, description || 'Synced from monthly deductions']
  );
}

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

async function uploadTransCSV(req, res) {
  const { month, year } = req.body;
  const m = parseInt(month);
  const y = parseInt(year);
  
  console.log(`CSV Upload - Processing for month: ${m}, year: ${y}`);
  console.log(`File: ${req.file?.originalname}, Size: ${req.file?.size} bytes`);

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
    console.log('CSV Headers detected:', headerRow);
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
    
    // Member profile fields - with flexible header matching
    const genderIdx = headerRow.findIndex((h) => normalizeLabel(h) === 'gender');
    const maritalIdx = headerRow.findIndex((h) => normalizeLabel(h) === 'marital status');
    const phoneIdx = headerRow.findIndex((h) => {
      const n = normalizeLabel(h);
      return n === 'phone' || n === 'phone no' || n === 'gsm no' || n === 'gsm' || n.includes('phone') || n.includes('gsm');
    });
    const emailIdx = headerRow.findIndex((h) => {
      const n = normalizeLabel(h);
      return n === 'email' || n === 'e-mail' || n.includes('email') || n.includes('fuoye');
    });
    const bankIdx = headerRow.findIndex((h) => normalizeLabel(h) === 'bank');
    const accountIdx = headerRow.findIndex((h) => {
      const n = normalizeLabel(h);
      return n.includes('account') || n.includes('acct') || n === 'account no' || n === 'acct no' || n === 'acct. no';
    });
    const deptIdx = headerRow.findIndex((h) => {
      const n = normalizeLabel(h);
      return n === 'department' || n === 'dept';
    });
    const nextOfKinIdx = headerRow.findIndex((h) => {
      const n = normalizeLabel(h);
      return (n === 'next of kin' || n === 'next of kin name' || 
              (n.includes('next') && n.includes('kin') && !n.includes('relation')));
    });
    const kinRelationIdx = headerRow.findIndex((h) => {
      const n = normalizeLabel(h);
      return (n.includes('relation') && n.includes('kin')) || 
             (n === 'relation') || 
             n.includes('relation (with');
    });
    const admissionDateIdx = headerRow.findIndex((h) => {
      const n = normalizeLabel(h);
      return n.includes('date') && (n.includes('admission') || n.includes('admitted'));
    });

    if (lNoIdx === -1) {
      return res.status(400).json({ error: 'CSV must have an L/No column' });
    }

    // Log detected column indices for debugging
    console.log(`Column indices - L/No: ${lNoIdx}, StaffNo: ${staffNoIdx}, IPPIS: ${ippisIdx}, S/N: ${snIdx}, Name: ${nameIdx}`);
    console.log(`Profile indices - Gender: ${genderIdx}, Marital: ${maritalIdx}, Phone: ${phoneIdx}, Email: ${emailIdx}, Bank: ${bankIdx}, Account: ${accountIdx}, Dept: ${deptIdx}, NextOfKin: ${nextOfKinIdx}, KinRelation: ${kinRelationIdx}, AdmissionDate: ${admissionDateIdx}`);

    const financialColsRaw = [];
    const newColInserts = { ledgers: [], labels: [], sorts: [] };
    for (let i = 0; i < headerRow.length; i++) {
      const h = headerRow[i];
      if (!h || IDENTITY_HEADERS.has(normalizeLabel(h))) continue;
      
      let colKey = resolveKey(h, labelToKey);
      if (colKey === 'total_deduction') continue;
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
      financialColsRaw.push({ idx: i, key: colKey });
    }

    // FIX 1: Deduplicate financialCols by key — last column with a given key wins.
    // Prevents duplicate (member_id, column_key, month, year) entries when two CSV
    // columns resolve to the same canonical key (e.g. trailing empty header columns).
    const seenFinancialKeys = new Map();
    for (const col of financialColsRaw) {
      seenFinancialKeys.set(col.key, col);
    }
    const financialCols = [...seenFinancialKeys.values()];

    if (newColInserts.ledgers.length > 0) {
      // Deduplicate newColInserts by key before inserting
      const uniqueColKeys = new Map();
      for (let i = 0; i < newColInserts.ledgers.length; i++) {
        uniqueColKeys.set(newColInserts.ledgers[i], { label: newColInserts.labels[i], sort: newColInserts.sorts[i] });
      }
      const dedupLedgers = [...uniqueColKeys.keys()];
      const dedupLabels = dedupLedgers.map(k => uniqueColKeys.get(k).label);
      const dedupSorts  = dedupLedgers.map(k => uniqueColKeys.get(k).sort);

      await db.query(
        `INSERT INTO trans_columns (key, label, sort_order)
         SELECT * FROM UNNEST($1::text[], $2::text[], $3::int[])
         ON CONFLICT (key) DO NOTHING`,
        [dedupLedgers, dedupLabels, dedupSorts]
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
      // FIX 2: Strip embedded newlines from name — a newline inside a quoted CSV cell
      // causes csv-parse to emit the row continuation as a separate record with the
      // same L/No, producing duplicate ledger_no entries in newMembers and triggering
      // "ON CONFLICT DO UPDATE command cannot affect row a second time".
      const nameVal  = nameIdx >= 0
        ? (row[nameIdx] || '').trim().replace(/[\r\n]+/g, ' ')
        : '';
      
      // Extract member profile fields
      const gender = genderIdx >= 0 ? (row[genderIdx] || '').trim() : '';
      const marital = maritalIdx >= 0 ? (row[maritalIdx] || '').trim() : '';
      const phone = phoneIdx >= 0 ? (row[phoneIdx] || '').trim() : '';
      const email = emailIdx >= 0 ? (row[emailIdx] || '').trim() : '';
      const bank = bankIdx >= 0 ? (row[bankIdx] || '').trim() : '';
      const account = accountIdx >= 0 ? (row[accountIdx] || '').trim() : '';
      const dept = deptIdx >= 0 ? (row[deptIdx] || '').trim() : '';
      const nextOfKin = nextOfKinIdx >= 0 ? (row[nextOfKinIdx] || '').trim() : '';
      const kinRelation = kinRelationIdx >= 0 ? (row[kinRelationIdx] || '').trim() : '';
      const admissionDate = admissionDateIdx >= 0 ? (row[admissionDateIdx] || '').trim() : '';
      
      // Log profile data extraction for first few rows (debugging)
      if (rowIdx <= 2 && (gender || marital || phone || email || bank || account || nextOfKin || kinRelation)) {
        console.log(`Row ${rowIdx} profile: gender=${gender}, marital=${marital}, phone=${phone}, email=${email}, bank=${bank}, account=${account}, nextOfKin=${nextOfKin}, relation=${kinRelation}`);
      }

      const existId = byLedger.get(lNoVal.toLowerCase()) ||
                      (staffNo ? byStaff.get(staffNo.toLowerCase()) : null);

      if (!existId) {
        if (!lNoVal) continue;
        newMembers.push([
          lNoVal, staffNo || null, ippisVal || null, nameVal || lNoVal,
          gender || null, marital || null, phone || null, email || null,
           toDateOrNull(admissionDate), bank || null, account || null, dept || null,
          nextOfKin || null, kinRelation || null
        ]);
      }
      dataRows.push({
        lNoVal, staffNo, ippisVal, nameVal, existId, row,
        memberId: existId, // will be updated with actual ID after insert
        memberProfile: { gender, marital, phone, email, bank, account, dept, nextOfKin, kinRelation, admissionDate }
      });
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      if (newMembers.length > 0) {
        // FIX 3: Deduplicate newMembers by ledger_no before the bulk UNNEST insert.
        // A quoted cell containing a newline (e.g. a name like "AYENI EBENEZER OJO\n")
        // causes csv-parse to split one logical row into two records, both sharing the
        // same L/No. Without dedup, the UNNEST-based upsert tries to update the same
        // members row twice in a single statement, which Postgres rejects with:
        //   "ON CONFLICT DO UPDATE command cannot affect row a second time"
        const seenNewLedgers = new Set();
        const uniqueNewMembers = newMembers.filter((r) => {
          const key = (r[0] || '').toLowerCase();
          if (seenNewLedgers.has(key)) return false;
          seenNewLedgers.add(key);
          return true;
        });

        const lnArr         = uniqueNewMembers.map(r => r[0]);
        const snArr         = uniqueNewMembers.map(r => r[1]);
        const giArr         = uniqueNewMembers.map(r => r[2]);
        const fnArr         = uniqueNewMembers.map(r => r[3]);
        const genderArr     = uniqueNewMembers.map(r => r[4]);
        const maritalArr    = uniqueNewMembers.map(r => r[5]);
        const phoneArr      = uniqueNewMembers.map(r => r[6]);
        const emailArr      = uniqueNewMembers.map(r => r[7]);
        const admissionArr  = uniqueNewMembers.map(r => toDateOrNull(r[8]));
        const bankArr       = uniqueNewMembers.map(r => r[9]);
        const accountArr    = uniqueNewMembers.map(r => r[10]);
        const deptArr       = uniqueNewMembers.map(r => r[11]);
        const nextOfKinArr  = uniqueNewMembers.map(r => r[12]);
        const kinRelationArr = uniqueNewMembers.map(r => r[13]);
        
        const ins = await client.query(
          `INSERT INTO members (ledger_no, staff_no, gifmis_no, full_name, gender, marital_status, phone, email, date_of_admission, bank, account_number, department, next_of_kin, next_of_kin_relation, is_active)
           SELECT unnest($1::text[]), unnest($2::text[]), unnest($3::text[]), unnest($4::text[]), unnest($5::text[]), unnest($6::text[]), unnest($7::text[]), unnest($8::text[]), unnest($9::date[]), unnest($10::text[]), unnest($11::text[]), unnest($12::text[]), unnest($13::text[]), unnest($14::text[]), TRUE
           ON CONFLICT (ledger_no) DO UPDATE
             SET staff_no  = COALESCE(EXCLUDED.staff_no,  members.staff_no),
                 gifmis_no = COALESCE(EXCLUDED.gifmis_no, members.gifmis_no),
                 gender = COALESCE(EXCLUDED.gender, members.gender),
                 marital_status = COALESCE(EXCLUDED.marital_status, members.marital_status),
                 phone = COALESCE(EXCLUDED.phone, members.phone),
                 email = COALESCE(EXCLUDED.email, members.email),
                 date_of_admission = COALESCE(EXCLUDED.date_of_admission, members.date_of_admission),
                 bank = COALESCE(EXCLUDED.bank, members.bank),
                 account_number = COALESCE(EXCLUDED.account_number, members.account_number),
                 department = COALESCE(EXCLUDED.department, members.department),
                 next_of_kin = COALESCE(EXCLUDED.next_of_kin, members.next_of_kin),
                 next_of_kin_relation = COALESCE(EXCLUDED.next_of_kin_relation, members.next_of_kin_relation),
                 updated_at = NOW()
           RETURNING id, LOWER(ledger_no) AS ln, LOWER(COALESCE(staff_no,'')) AS sn`,
          [lnArr, snArr, giArr, fnArr, genderArr, maritalArr, phoneArr, emailArr, admissionArr, bankArr, accountArr, deptArr, nextOfKinArr, kinRelationArr]
        );
        for (const r of ins.rows) {
          if (r.ln) byLedger.set(r.ln, r.id);
          if (r.sn && r.sn !== '') byStaff.set(r.sn, r.id);
        }
      }

      // Update existing members with profile information from CSV
      for (const dr of dataRows) {
        if (!dr.existId && !dr.memberProfile) continue;
        const memberId = dr.existId ||
                         byLedger.get(dr.lNoVal.toLowerCase()) ||
                         (dr.staffNo ? byStaff.get(dr.staffNo.toLowerCase()) : null);
        if (!memberId) continue;

        const prof = dr.memberProfile || {};
        if (prof.gender || prof.marital || prof.phone || prof.email || prof.bank || prof.account || prof.dept || prof.nextOfKin || prof.kinRelation) {
          try {
            await client.query(
              `UPDATE members SET
                gender = COALESCE(NULLIF($1, ''), gender),
                marital_status = COALESCE(NULLIF($2, ''), marital_status),
                phone = COALESCE(NULLIF($3, ''), phone),
                email = COALESCE(NULLIF($4, ''), email),
                bank = COALESCE(NULLIF($5, ''), bank),
                account_number = COALESCE(NULLIF($6, ''), account_number),
                department = COALESCE(NULLIF($7, ''), department),
                next_of_kin = COALESCE(NULLIF($8, ''), next_of_kin),
                next_of_kin_relation = COALESCE(NULLIF($9, ''), next_of_kin_relation),
                updated_at = NOW()
               WHERE id = $10`,
              [prof.gender || '', prof.marital || '', prof.phone || '', prof.email || '',
               prof.bank || '', prof.account || '', prof.dept || '', prof.nextOfKin || '',
               prof.kinRelation || '', memberId]
            );
          } catch (updateErr) {
            console.error(`Failed to update member profile for ID ${memberId}:`, updateErr.message);
            throw updateErr;
          }
        }
      }
      console.log(`Profile data update complete`);

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
          if (amtRaw !== undefined && amtRaw !== null && amtRaw !== '') {
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
        }
        matched++;
      }

      if (tMemberIds.length > 0) {
        const dedupMap = new Map();
        for (let i = 0; i < tMemberIds.length; ++i) {
          const key = `${tMemberIds[i]}|${tColKeys[i]}|${tMonths[i]}|${tYears[i]}`;
          dedupMap.set(key, tAmounts[i]);
        }
        const dMemberIds = [], dColKeys = [], dAmounts = [], dMonths = [], dYears = [];
        for (const k of dedupMap.keys()) {
          const [member_id, colKey, month, year] = k.split('|');
          dMemberIds.push(parseInt(member_id));
          dColKeys.push(colKey);
          dAmounts.push(dedupMap.get(k));
          dMonths.push(parseInt(month));
          dYears.push(parseInt(year));
        }
        await client.query(
          `INSERT INTO monthly_trans (member_id, column_key, amount, month, year)
           SELECT * FROM UNNEST($1::int[], $2::text[], $3::numeric[], $4::int[], $5::int[])
           ON CONFLICT (member_id, column_key, month, year)
           DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()`,
          [dMemberIds, dColKeys, dAmounts, dMonths, dYears]
        );
      }

      // FIX: Only insert savings_add (monthly contribution) into the savings table.
      // savings_bf is a carried-forward balance, NOT a new savings record.
      // Including both savings_bf and savings_add produced two rows per member with
      // the same (member_id, month, year) in the UNNEST array, causing Postgres to
      // throw "ON CONFLICT DO UPDATE command cannot affect row a second time".
      // Also deduplicate by member_id in case the same member appears twice in the
      // data (e.g. from a split CSV row due to an embedded newline in a name cell).
      const savingsMap = new Map(); // member_id -> [member_id, amount, month, year, description]
      for (let i = 0; i < tMemberIds.length; i++) {
        if (tColKeys[i] === 'savings_add') {
          savingsMap.set(tMemberIds[i], [
            tMemberIds[i], tAmounts[i], tMonths[i], tYears[i],
            `Monthly Savings - ${m}/${y}`
          ]);
        }
      }

      if (savingsMap.size > 0) {
        const savingsRecords = [...savingsMap.values()];
        const savMemberIds   = savingsRecords.map(r => r[0]);
        const savAmounts     = savingsRecords.map(r => r[1]);
        const savMonths      = savingsRecords.map(r => r[2]);
        const savYears       = savingsRecords.map(r => r[3]);
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
          `UPDATE loans SET months_remaining = $1, updated_at = NOW()
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
          `UPDATE members SET is_active = FALSE, deactivation_reason = 'loan_complete', updated_at = NOW()
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
      
      console.log('Upload successful');
      res.json({
        ok: true, matched, created, unmatched, formulaResolved, formulaFallback,
        unmatchedRows, deactivated: deactivatedMembers.length, deactivatedMembers, message,
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

async function getDeductions(req, res) {
  const { month, year } = req.query;
  const m = parseInt(month) || new Date().getMonth() + 1;
  const y = parseInt(year)  || new Date().getFullYear();

  try {
    const membersResult = await db.query(`
      SELECT 
        m.id, m.ledger_no, m.staff_no, m.gifmis_no, m.full_name,
        COALESCE(mt_savings.amount, 0) AS savings,
        COALESCE(mt_savings_bank.amount, 0) AS savings_bank,
        COALESCE(mt_loan_repayment.amount, 0) AS loan_repayment,
        COALESCE(mt_loan_repayment_bank.amount, 0) AS loan_repayment_bank,
        (COALESCE(mt_loan_interest.amount, 0) + COALESCE(mt_loan_interest_bank.amount, 0)) AS loan_interest,
        (COALESCE(mt_commodity.amount, 0) + COALESCE(mt_commodity_bank.amount, 0)) AS commodity_repayment,
        COALESCE(mt_form.amount, 0) AS membership_loan_form,
        COALESCE(mt_other.amount, 0) AS other_charges,
        (COALESCE(mt_savings.amount, 0) + COALESCE(mt_savings_bank.amount, 0) +
         COALESCE(mt_loan_repayment.amount, 0) + COALESCE(mt_loan_repayment_bank.amount, 0) +
         COALESCE(mt_loan_interest.amount, 0) + COALESCE(mt_loan_interest_bank.amount, 0) +
         COALESCE(mt_commodity.amount, 0) + COALESCE(mt_commodity_bank.amount, 0) +
         COALESCE(mt_form.amount, 0) + COALESCE(mt_other.amount, 0)) AS total_deductions
      FROM members m
      LEFT JOIN monthly_trans mt_savings ON mt_savings.member_id = m.id AND mt_savings.column_key = 'savings_add' AND mt_savings.month = $1 AND mt_savings.year = $2
      LEFT JOIN monthly_trans mt_savings_bank ON mt_savings_bank.member_id = m.id AND mt_savings_bank.column_key = 'savings_add_bank' AND mt_savings_bank.month = $1 AND mt_savings_bank.year = $2
      LEFT JOIN monthly_trans mt_loan_repayment ON mt_loan_repayment.member_id = m.id AND mt_loan_repayment.column_key = 'loan_repayment' AND mt_loan_repayment.month = $1 AND mt_loan_repayment.year = $2
      LEFT JOIN monthly_trans mt_loan_repayment_bank ON mt_loan_repayment_bank.member_id = m.id AND mt_loan_repayment_bank.column_key = 'loan_repayment_bank' AND mt_loan_repayment_bank.month = $1 AND mt_loan_repayment_bank.year = $2
      LEFT JOIN monthly_trans mt_loan_interest ON mt_loan_interest.member_id = m.id AND mt_loan_interest.column_key = 'loan_int_paid' AND mt_loan_interest.month = $1 AND mt_loan_interest.year = $2
      LEFT JOIN monthly_trans mt_loan_interest_bank ON mt_loan_interest_bank.member_id = m.id AND mt_loan_interest_bank.column_key = 'loan_int_paid_bank' AND mt_loan_interest_bank.month = $1 AND mt_loan_interest_bank.year = $2
      LEFT JOIN monthly_trans mt_commodity ON mt_commodity.member_id = m.id AND mt_commodity.column_key = 'comm_repayment' AND mt_commodity.month = $1 AND mt_commodity.year = $2
      LEFT JOIN monthly_trans mt_commodity_bank ON mt_commodity_bank.member_id = m.id AND mt_commodity_bank.column_key = 'comm_repayment_bank' AND mt_commodity_bank.month = $1 AND mt_commodity_bank.year = $2
      LEFT JOIN monthly_trans mt_form ON mt_form.member_id = m.id AND mt_form.column_key = 'form' AND mt_form.month = $1 AND mt_form.year = $2
      LEFT JOIN monthly_trans mt_other ON mt_other.member_id = m.id AND mt_other.column_key = 'other_charges' AND mt_other.month = $1 AND mt_other.year = $2
      WHERE m.is_active = TRUE
      ORDER BY m.ledger_no
    `, [m, y]);

    const hasData = membersResult.rows.some(row => 
      row.savings > 0 || row.savings_bank > 0 || row.loan_repayment > 0 || row.loan_repayment_bank > 0 || 
      row.loan_interest > 0 || row.commodity_repayment > 0 || row.membership_loan_form > 0 || row.other_charges > 0
    );

    const columns = [
      { key: 'ledger_no', label: 'L/No', enabled: true, sort_order: 1 },
      { key: 'full_name', label: 'Name', enabled: true, sort_order: 2 },
      { key: 'staff_no', label: 'Staff No', enabled: true, sort_order: 3 },
      { key: 'gifmis_no', label: 'GIFMIS No', enabled: true, sort_order: 4 },
      { key: 'savings', label: 'SAVINGS (Naira)', enabled: true, sort_order: 5 },
      { key: 'savings_bank', label: 'SAVINGS (BANK) (Naira)', enabled: true, sort_order: 6 },
      { key: 'loan_repayment', label: 'LOAN REPAYMENT (Naira)', enabled: true, sort_order: 7 },
      { key: 'loan_repayment_bank', label: 'LOAN REPAYMENT (BANK) (Naira)', enabled: true, sort_order: 8 },
      { key: 'loan_interest', label: 'LN INTEREST (Naira)', enabled: true, sort_order: 9 },
      { key: 'commodity_repayment', label: 'COMMODITY REPAYMENT (Naira)', enabled: true, sort_order: 10 },
      { key: 'membership_loan_form', label: 'MEMBERSHIP/LOAN FORM (Naira)', enabled: true, sort_order: 11 },
      { key: 'other_charges', label: 'OTHER CHARGES (Naira)', enabled: true, sort_order: 12 }
    ];

    res.json({ columns, members: membersResult.rows, month: m, year: y, hasData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

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

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

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

    const headerRow = records[0].map((h) => (h || '').trim().toLowerCase());
    const staffNoIdx = headerRow.findIndex((h) => h.includes('staff'));
    const amountIdx = headerRow.findIndex((h) => h.includes('amount') || h.includes('total'));

    if (staffNoIdx === -1 || amountIdx === -1) {
      return res.status(400).json({ error: 'CSV must have Staff No and Total Amount columns' });
    }

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

    await db.query(
      `INSERT INTO reconciliation_data (month, year, data, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (month, year)
       DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [m, y, JSON.stringify(reconciliationData)]
    );

    res.json({
      message: `Reconciliation data uploaded for ${processed} members in Nigerian Naira (₦)`,
      processed,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

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
      month: m, year: y,
      currency: 'Nigerian Naira (₦)'
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
      const latest = await db.query(
        'SELECT month, year FROM monthly_trans ORDER BY year DESC, month DESC LIMIT 1'
      );
      if (!latest.rows.length) {
        return res.status(400).json({ error: 'No monthly data found. Upload an opening balances CSV first.' });
      }
      srcMonth = latest.rows[0].month;
      srcYear  = latest.rows[0].year;
    }

    let tgtMonth = srcMonth + 1;
    let tgtYear  = srcYear;
    if (tgtMonth > 12) { tgtMonth = 1; tgtYear++; }

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

    const srcCheck = await db.query(
      'SELECT COUNT(*) AS cnt FROM monthly_trans WHERE month=$1 AND year=$2',
      [srcMonth, srcYear]
    );
    if (parseInt(srcCheck.rows[0].cnt) === 0) {
      return res.status(400).json({ error: `No data found for ${MONTH_NAMES[srcMonth - 1]} ${srcYear}.` });
    }

    const rateRes = await db.query("SELECT value FROM app_settings WHERE key='loan_interest_rate'");
    const interestRate = parseFloat(rateRes.rows[0]?.value || '5') / 100;

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
      const bulkRows = [];
      
      for (const [memberId, prev] of Object.entries(memberData)) {
        const savings_bf           = g(prev, 'savings_cf');
        const savings_add          = g(prev, 'savings_add');
        const savings_add_bank     = 0;
        const savings_withdrawal   = g(prev, 'savings_withdrawal');
        const savings_cf           = savings_bf + savings_add + savings_add_bank - savings_withdrawal;

        const loan_bal_bf          = g(prev, 'loan_ledger_bal');
        const loan_granted         = 0;
        const loan_repayment       = g(prev, 'loan_repayment');
        const loan_repayment_bank  = 0;
        const loan_ledger_bal      = loan_bal_bf + loan_granted - loan_repayment - loan_repayment_bank;

        const loan_int_bf          = g(prev, 'loan_int_cf');
        const loan_int_charged     = loan_granted > 0 ? Math.round(loan_granted * interestRate * 100) / 100 : 0;
        const loan_int_paid        = g(prev, 'loan_int_paid');
        const loan_int_paid_bank   = 0;
        const loan_int_cf          = loan_int_bf + loan_int_charged - loan_int_paid - loan_int_paid_bank;

        const comm_bal_bf          = g(prev, 'comm_bal_cf');
        const comm_add             = 0;
        const comm_repayment       = g(prev, 'comm_repayment');
        const comm_repayment_bank  = 0;
        const comm_bal_cf          = comm_bal_bf + comm_add - comm_repayment - comm_repayment_bank;

        const form                 = 0;
        const other_charges        = 0;
        const total_deduction      = savings_add + savings_add_bank + loan_repayment + loan_repayment_bank 
                                   + loan_int_paid + loan_int_paid_bank + comm_repayment + comm_repayment_bank 
                                   + form + other_charges;

        const newData = {
          savings_bf, savings_add, savings_add_bank, savings_withdrawal, savings_cf,
          loan_bal_bf, loan_granted, loan_repayment, loan_repayment_bank, loan_ledger_bal,
          loan_int_bf, loan_int_charged, loan_int_paid, loan_int_paid_bank, loan_int_cf,
          comm_bal_bf, comm_add, comm_repayment, comm_repayment_bank, comm_bal_cf,
          form, other_charges, total_deduction,
        };
        
        for (const [key, amount] of Object.entries(newData)) {
          bulkRows.push([memberId, key, amount, tgtMonth, tgtYear]);
        }
        
        if (loan_repayment + loan_repayment_bank > 0 || loan_int_paid + loan_int_paid_bank > 0) {
          loanSyncs.push({
            memberId: parseInt(memberId),
            principal_paid: loan_repayment + loan_repayment_bank,
            interest_paid: loan_int_paid + loan_int_paid_bank,
          });
        }
        generated++;
      }

      if (bulkRows.length > 0) {
        const valueStrings = bulkRows.map((_, i) => `($${i*5+1},$${i*5+2},$${i*5+3},$${i*5+4},$${i*5+5})`).join(',');
        const flatValues = bulkRows.flat();
        await client.query(`
          INSERT INTO monthly_trans (member_id, column_key, amount, month, year)
          VALUES ${valueStrings}
          ON CONFLICT (member_id, column_key, month, year)
          DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()
        `, flatValues);
      }

      for (const { memberId, principal_paid, interest_paid } of loanSyncs) {
        await syncLoanRepayment(client, memberId, tgtMonth, tgtYear, principal_paid, interest_paid, 'Auto-generated');
      }

      await client.query('COMMIT');
      res.json({
        message: `Generated ${generated} record${generated !== 1 ? 's' : ''} for ${MONTH_NAMES[tgtMonth - 1]} ${tgtYear} in Nigerian Naira (₦)`,
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

async function patchMonthEntry(req, res) {
  const { member_id, month, year, changes } = req.body;
  if (!member_id || !month || !year || !changes || typeof changes !== 'object') {
    return res.status(400).json({ error: 'member_id, month, year, and changes object are required' });
  }

  const m = parseInt(month);
  const y = parseInt(year);

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT column_key, amount FROM monthly_trans WHERE member_id=$1 AND month=$2 AND year=$3',
      [member_id, m, y]
    );
    const data = {};
    for (const r of existing.rows) data[r.column_key] = parseFloat(r.amount) || 0;

    // Apply changes
    for (const [key, val] of Object.entries(changes)) {
      data[key] = parseFloat(val) || 0;
    }

    // Map new modal keys to legacy backend keys
    const keyMap = {
      savings: 'savings_add',
      savings_bank: 'savings_add_bank',
      loan_repayment: 'loan_repayment',
      loan_repayment_bank: 'loan_repayment_bank',
      loan_interest: 'loan_int_paid',
      commodity_repayment: 'comm_repayment',
      membership_loan_form: 'form',
      other_charges: 'other_charges',
    };
    for (const [newKey, legacyKey] of Object.entries(keyMap)) {
      if (data[newKey] !== undefined) {
        data[legacyKey] = data[newKey];
      }
    }

    const g = (k) => data[k] || 0;
    
    const savings_cf = Math.max(0, g('savings_bf') + g('savings_add') + g('savings_add_bank') - g('savings_withdrawal'));
    const loan_ledger_bal = Math.max(0, g('loan_bal_bf') + g('loan_granted') - g('loan_repayment') - g('loan_repayment_bank'));
    const loan_int_cf = Math.max(0, g('loan_int_bf') + g('loan_int_charged') - g('loan_int_paid') - g('loan_int_paid_bank'));
    const comm_bal_cf = Math.max(0, g('comm_bal_bf') + g('comm_add') - g('comm_repayment') - g('comm_repayment_bank'));
    const total_deduction = g('savings_add') + g('savings_add_bank') + g('loan_repayment') + g('loan_repayment_bank') 
                          + g('loan_int_paid') + g('loan_int_paid_bank') + g('comm_repayment') + g('comm_repayment_bank') 
                          + g('form') + g('other_charges');

    const finalData = {
      savings_bf: g('savings_bf'), savings_add: g('savings_add'), savings_add_bank: g('savings_add_bank'),
      savings_withdrawal: g('savings_withdrawal'), savings_cf,
      loan_bal_bf: g('loan_bal_bf'), loan_granted: g('loan_granted'), loan_repayment: g('loan_repayment'),
      loan_repayment_bank: g('loan_repayment_bank'), loan_ledger_bal,
      loan_int_bf: g('loan_int_bf'), loan_int_charged: g('loan_int_charged'), loan_int_paid: g('loan_int_paid'),
      loan_int_paid_bank: g('loan_int_paid_bank'), loan_int_cf,
      comm_bal_bf: g('comm_bal_bf'), comm_add: g('comm_add'), comm_repayment: g('comm_repayment'),
      comm_repayment_bank: g('comm_repayment_bank'), comm_bal_cf,
      form: g('form'), other_charges: g('other_charges'), total_deduction,
    };

    for (const [key, amount] of Object.entries(finalData)) {
      await client.query(`
        INSERT INTO monthly_trans (member_id, column_key, amount, month, year)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (member_id, column_key, month, year)
        DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()
      `, [member_id, key, amount, m, y]);
    }

    // Propagate changes to subsequent months
    let currM = m;
    let currY = y;
    let currData = finalData;

    while (true) {
      let nextM = currM + 1;
      let nextY = currY;
      if (nextM > 12) {
        nextM = 1;
        nextY++;
      }

      // Check if next month exists
      const nextExisting = await client.query(
        'SELECT column_key, amount FROM monthly_trans WHERE member_id=$1 AND month=$2 AND year=$3',
        [member_id, nextM, nextY]
      );

      if (nextExisting.rows.length === 0) {
        break; // No more months to propagate to
      }

      const nextData = {};
      for (const r of nextExisting.rows) nextData[r.column_key] = parseFloat(r.amount) || 0;

      // Update B/F values from current month's C/F values
      nextData['savings_bf'] = currData.savings_cf;
      nextData['loan_bal_bf'] = currData.loan_ledger_bal;
      nextData['loan_int_bf'] = currData.loan_int_cf;
      nextData['comm_bal_bf'] = currData.comm_bal_cf;

      // Recalculate C/F values for the next month
      const gNext = (k) => nextData[k] || 0;
      
      const savings_cf_next = Math.max(0, gNext('savings_bf') + gNext('savings_add') + gNext('savings_add_bank') - gNext('savings_withdrawal'));
      const loan_ledger_bal_next = Math.max(0, gNext('loan_bal_bf') + gNext('loan_granted') - gNext('loan_repayment') - gNext('loan_repayment_bank'));
      const loan_int_cf_next = Math.max(0, gNext('loan_int_bf') + gNext('loan_int_charged') - gNext('loan_int_paid') - gNext('loan_int_paid_bank'));
      const comm_bal_cf_next = Math.max(0, gNext('comm_bal_bf') + gNext('comm_add') - gNext('comm_repayment') - gNext('comm_repayment_bank'));

      nextData['savings_cf'] = savings_cf_next;
      nextData['loan_ledger_bal'] = loan_ledger_bal_next;
      nextData['loan_int_cf'] = loan_int_cf_next;
      nextData['comm_bal_cf'] = comm_bal_cf_next;

      // Save updated next month
      for (const key of ['savings_bf', 'loan_bal_bf', 'loan_int_bf', 'comm_bal_bf', 'savings_cf', 'loan_ledger_bal', 'loan_int_cf', 'comm_bal_cf']) {
        await client.query(`
          UPDATE monthly_trans SET amount = $1, updated_at = NOW()
          WHERE member_id = $2 AND column_key = $3 AND month = $4 AND year = $5
        `, [nextData[key], member_id, key, nextM, nextY]);
      }

      currM = nextM;
      currY = nextY;
      currData = nextData;
    }

    await client.query('COMMIT');
    const newKeyMap = {
      savings_bank: finalData.savings_add_bank, savings: finalData.savings_add,
      loan_repayment: finalData.loan_repayment, loan_repayment_bank: finalData.loan_repayment_bank,
      loan_interest: finalData.loan_int_paid, commodity_repayment: finalData.comm_repayment,
      membership_loan_form: finalData.form, other_charges: finalData.other_charges,
    };
    res.json({ message: 'Entry updated and recalculations carried forward (Nigerian Naira ₦)', data: { ...finalData, ...newKeyMap } });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

module.exports = { 
  getDeductions, upsertDeductions, uploadTransCSV, getTransColumns, updateTransColumn,
  generateNextMonth, patchMonthEntry, uploadReconciliationCSV, getReconciliationData
};