const db = require('../db');

async function getLoans(req, res) {
  try {
    const result = await db.query(`
      SELECT l.*, m.full_name, m.ledger_no
      FROM loans l
      JOIN members m ON m.id = l.member_id
      WHERE l.status = 'active'
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
  const { member_id, principal, months, monthly_payment } = req.body;
  if (!member_id || !principal) {
    return res.status(400).json({ error: 'member_id and principal are required' });
  }

  try {
    const p = parseFloat(principal);

    // Fetch current interest rate from settings (default 5%)
    const settingsRes = await db.query(
      "SELECT value FROM app_settings WHERE key = 'loan_interest_rate'"
    );
    const rate = settingsRes.rows[0] ? parseFloat(settingsRes.rows[0].value) / 100 : 0.05;

    let m;
    let monthly_principal;

    if (months) {
      m = parseInt(months);
      monthly_principal = p / m;
    } else if (monthly_payment) {
      // monthly_payment is the total monthly repayment (principal + interest)
      const totalRepayment = parseFloat(monthly_payment);
      m = Math.ceil((p * (1 + rate)) / totalRepayment);
      monthly_principal = p / m;
    } else {
      return res.status(400).json({ error: 'Either months or monthly_payment required' });
    }

    const total_interest = p * rate;
    const monthly_interest = total_interest / m;

    const result = await db.query(`
      INSERT INTO loans (member_id, principal, months, remaining_balance, monthly_principal, total_interest, monthly_interest, interest_paid, months_paid, interest_rate, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,$8,'active')
      RETURNING *
    `, [member_id, p, m, p, monthly_principal, total_interest, monthly_interest, rate]);

    res.status(201).json({ loan: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
  try {
    await db.query('DELETE FROM loans WHERE id=$1', [id]);
    res.json({ message: 'Loan deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    if (loan.status !== 'active') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Loan is not active' }); }

    // Use provided amounts, or fall back to scheduled monthly amounts
    const principalAmount = principal_paid !== undefined
      ? parseFloat(principal_paid)
      : parseFloat(loan.monthly_principal);
    const interestAmount = interest_paid !== undefined
      ? parseFloat(interest_paid)
      : parseFloat(loan.monthly_interest);

    const newBalance = Math.max(0, parseFloat(loan.remaining_balance) - principalAmount);
    const newInterestPaid = parseFloat(loan.interest_paid) + interestAmount;
    const newMonthsPaid = loan.months_paid + 1;
    const newStatus = newBalance <= 0 ? 'cleared' : 'active';

    await client.query(`
      UPDATE loans SET remaining_balance=$1, interest_paid=$2, months_paid=$3, status=$4, updated_at=NOW()
      WHERE id=$5
    `, [newBalance, newInterestPaid, newMonthsPaid, newStatus, id]);

    await client.query(`
      INSERT INTO loan_repayments (loan_id, member_id, principal_paid, interest_paid, month, year, description)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
    `, [id, loan.member_id, principalAmount, interestAmount, month, year, description || null]);

    await client.query('COMMIT');
    res.json({ message: 'Repayment recorded', newBalance, newStatus });
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
