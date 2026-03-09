const db = require('../db');

// Helper: recalculate loan_ledger_bal and loan_int_cf from existing monthly_trans values
async function recalcLoanTrans(client, member_id, month, year) {
  const res = await client.query(`
    SELECT column_key, amount FROM monthly_trans
    WHERE member_id=$1 AND month=$2 AND year=$3
      AND column_key IN ('loan_bal_bf','loan_granted','loan_repayment','loan_repayment_bank',
                         'loan_int_bf','loan_int_charged','loan_int_paid','loan_int_paid_bank')
  `, [member_id, month, year]);
  const v = {};
  for (const r of res.rows) v[r.column_key] = parseFloat(r.amount) || 0;

  const loanBefore  = (v.loan_bal_bf || 0) + (v.loan_granted || 0);
  const effRepay    = Math.min(v.loan_repayment || 0, loanBefore);
  const effRepayBnk = Math.min(v.loan_repayment_bank || 0, Math.max(0, loanBefore - effRepay));
  const loan_ledger_bal = Math.max(0, loanBefore - effRepay - effRepayBnk);

  const intBefore  = (v.loan_int_bf || 0) + (v.loan_int_charged || 0);
  const effIntPaid = Math.min(v.loan_int_paid || 0, intBefore);
  const effIntBnk  = Math.min(v.loan_int_paid_bank || 0, Math.max(0, intBefore - effIntPaid));
  const loan_int_cf = Math.max(0, intBefore - effIntPaid - effIntBnk);

  for (const [key, val] of [['loan_ledger_bal', loan_ledger_bal], ['loan_int_cf', loan_int_cf]]) {
    await client.query(`
      INSERT INTO monthly_trans (member_id, column_key, amount, month, year)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (member_id, column_key, month, year)
      DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()
    `, [member_id, key, val, month, year]);
  }
}

async function getLoans(req, res) {
  try {
    const result = await db.query(`
      SELECT l.*, m.full_name, m.ledger_no
      FROM loans l
      JOIN members m ON m.id = l.member_id
      WHERE l.status = 'active'
        OR (l.status = 'cleared' AND l.interest_paid < l.total_interest)
      ORDER BY l.created_at DESC
    `);
    res.json({ loans: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getMemberLoans(req, res) {
  const { memberId } = req.params;
  try {
    const result = await db.query(
      'SELECT * FROM loans WHERE member_id = $1 ORDER BY created_at ASC',
      [memberId]
    );
    res.json({ loans: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createLoan(req, res) {
  const { member_id, principal, months, monthly_payment, month, year } = req.body;
  if (!member_id || !principal) {
    return res.status(400).json({ error: 'member_id and principal are required' });
  }

  // Month/year when loan is issued (default: current month)
  const now = new Date();
  const issuedMonth = parseInt(month) || (now.getMonth() + 1);
  const issuedYear  = parseInt(year)  || now.getFullYear();

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const p = parseFloat(principal);

    // Fetch current interest rate from settings (default 5%)
    const settingsRes = await client.query(
      "SELECT value FROM app_settings WHERE key = 'loan_interest_rate'"
    );
    const rate = settingsRes.rows[0] ? parseFloat(settingsRes.rows[0].value) / 100 : 0.05;

    let m;
    let monthly_principal;

    if (months) {
      m = parseInt(months);
      monthly_principal = p / m;
    } else if (monthly_payment) {
      const totalRepayment = parseFloat(monthly_payment);
      m = Math.ceil((p * (1 + rate)) / totalRepayment);
      monthly_principal = p / m;
    } else {
      return res.status(400).json({ error: 'Either months or monthly_payment required' });
    }

    const total_interest = p * rate;
    const monthly_interest = total_interest / m;

    const result = await client.query(`
      INSERT INTO loans (member_id, principal, months, remaining_balance, monthly_principal, total_interest, monthly_interest, interest_paid, months_paid, interest_rate, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,$8,'active')
      RETURNING *
    `, [member_id, p, m, p, monthly_principal, total_interest, monthly_interest, rate]);

    // Set loan_granted for the issued month (additive — support multiple loans in one month)
    await client.query(`
      INSERT INTO monthly_trans (member_id, column_key, amount, month, year)
      VALUES ($1, 'loan_granted', $2, $3, $4)
      ON CONFLICT (member_id, column_key, month, year)
      DO UPDATE SET amount = monthly_trans.amount + EXCLUDED.amount, updated_at = NOW()
    `, [member_id, p, issuedMonth, issuedYear]);

    // Set loan_int_charged for the issued month (flat-rate: full interest charged at inception)
    await client.query(`
      INSERT INTO monthly_trans (member_id, column_key, amount, month, year)
      VALUES ($1, 'loan_int_charged', $2, $3, $4)
      ON CONFLICT (member_id, column_key, month, year)
      DO UPDATE SET amount = monthly_trans.amount + EXCLUDED.amount, updated_at = NOW()
    `, [member_id, total_interest, issuedMonth, issuedYear]);

    // Recalculate loan_ledger_bal and loan_int_cf for the issued month
    await recalcLoanTrans(client, member_id, issuedMonth, issuedYear);

    await client.query('COMMIT');
    res.status(201).json({ loan: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

async function updateLoan(req, res) {
  const { id } = req.params;
  const { status } = req.body;
  try {
    const result = await db.query(
      'UPDATE loans SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
      [status, id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Loan not found' });
    res.json({ loan: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteLoan(req, res) {
  const { id } = req.params;

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Get the loan record before deletion
    const oldRecord = await client.query('SELECT * FROM loans WHERE id=$1', [id]);
    if (!oldRecord.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }

    const old = oldRecord.rows[0];
    const oldPrincipal = parseFloat(old.principal);
    const oldTotalInterest = parseFloat(old.total_interest) || 0;

    // Get the issued month/year from date_issued
    const issuedDate  = old.date_issued ? new Date(old.date_issued) : new Date();
    const issuedMonth = issuedDate.getMonth() + 1;
    const issuedYear  = issuedDate.getFullYear();

    // Delete from loans table
    await client.query('DELETE FROM loans WHERE id=$1', [id]);

    // Reduce loan_granted and loan_int_charged for the issued month
    await client.query(`
      INSERT INTO monthly_trans (member_id, column_key, amount, month, year)
      VALUES ($1, 'loan_granted', $2, $3, $4)
      ON CONFLICT (member_id, column_key, month, year)
      DO UPDATE SET amount = GREATEST(0, monthly_trans.amount - EXCLUDED.amount), updated_at = NOW()
    `, [old.member_id, oldPrincipal, issuedMonth, issuedYear]);

    await client.query(`
      INSERT INTO monthly_trans (member_id, column_key, amount, month, year)
      VALUES ($1, 'loan_int_charged', $2, $3, $4)
      ON CONFLICT (member_id, column_key, month, year)
      DO UPDATE SET amount = GREATEST(0, monthly_trans.amount - EXCLUDED.amount), updated_at = NOW()
    `, [old.member_id, oldTotalInterest, issuedMonth, issuedYear]);

    // Recalculate loan_ledger_bal and loan_int_cf
    await recalcLoanTrans(client, old.member_id, issuedMonth, issuedYear);

    await client.query('COMMIT');
    res.json({ message: 'Deleted' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

async function addRepayment(req, res) {
  const { id } = req.params;
  const { month, year, principal_paid, interest_paid, description } = req.body;
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const loanRes = await client.query('SELECT * FROM loans WHERE id=$1 FOR UPDATE', [id]);
    const loan = loanRes.rows[0];
    if (!loan) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Loan not found' }); }
    const interestStillOwed = parseFloat(loan.total_interest) - parseFloat(loan.interest_paid) > 0;
    if (loan.status !== 'active' && !interestStillOwed) {
      await client.query('ROLLBACK'); return res.status(400).json({ error: 'Loan is fully settled' });
    }

    // For cleared loans, only interest payments are allowed (principal already 0)
    const principalAmount = loan.status === 'cleared'
      ? 0
      : (principal_paid !== undefined ? parseFloat(principal_paid) : parseFloat(loan.monthly_principal));
    const interestAmount = interest_paid !== undefined
      ? parseFloat(interest_paid)
      : parseFloat(loan.monthly_interest);

    const newBalance = Math.max(0, parseFloat(loan.remaining_balance) - principalAmount);
    const newInterestPaid = Math.min(
      parseFloat(loan.total_interest),
      parseFloat(loan.interest_paid) + interestAmount
    );
    const newMonthsPaid = loan.months_paid + 1;
    // Keep cleared if principal already 0; flip active→cleared if principal hits 0
    const newStatus = newBalance <= 0 ? 'cleared' : 'active';
    // Fully settled when both principal and interest are paid
    const fullySettled = newBalance <= 0 && newInterestPaid >= parseFloat(loan.total_interest);
    const finalStatus = fullySettled ? 'cleared' : newStatus;

    await client.query(`
      UPDATE loans SET remaining_balance=$1, interest_paid=$2, months_paid=$3, status=$4, updated_at=NOW()
      WHERE id=$5
    `, [newBalance, newInterestPaid, newMonthsPaid, finalStatus, id]);

    await client.query(`
      INSERT INTO loan_repayments (loan_id, member_id, principal_paid, interest_paid, month, year, description)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
    `, [id, loan.member_id, principalAmount, interestAmount, month, year, description || null]);

    await client.query('COMMIT');
    res.json({ message: 'Repayment recorded', newBalance, newStatus: finalStatus });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

async function getRepayments(req, res) {
  const { id } = req.params;
  try {
    const loanRes = await db.query(`
      SELECT l.*, m.full_name, m.ledger_no
      FROM loans l JOIN members m ON m.id = l.member_id
      WHERE l.id = $1
    `, [id]);
    if (!loanRes.rows[0]) return res.status(404).json({ error: 'Loan not found' });

    const repayRes = await db.query(`
      SELECT * FROM loan_repayments WHERE loan_id = $1 ORDER BY year ASC, month ASC, created_at ASC
    `, [id]);

    res.json({ loan: loanRes.rows[0], repayments: repayRes.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getLoans, getMemberLoans, createLoan, updateLoan, deleteLoan, addRepayment, getRepayments };
