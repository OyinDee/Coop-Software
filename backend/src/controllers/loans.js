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
    let m;
    let monthly_principal;

    if (months) {
      m = parseInt(months);
      monthly_principal = p / m;
    } else if (monthly_payment) {
      monthly_principal = parseFloat(monthly_payment);
      m = Math.ceil(p / monthly_principal);
    } else {
      return res.status(400).json({ error: 'Either months or monthly_payment required' });
    }

    const total_interest = p * 0.05;
    const monthly_interest = total_interest / m;

    const result = await db.query(`
      INSERT INTO loans (member_id, principal, months, remaining_balance, monthly_principal, total_interest, monthly_interest, interest_paid, months_paid, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,'active')
      RETURNING *
    `, [member_id, p, m, p, monthly_principal, total_interest, monthly_interest]);

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
  const { month, year } = req.body;
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const loanRes = await client.query('SELECT * FROM loans WHERE id=$1 FOR UPDATE', [id]);
    const loan = loanRes.rows[0];
    if (!loan) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Loan not found' }); }
    if (loan.status !== 'active') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Loan is not active' }); }

    const newBalance = Math.max(0, parseFloat(loan.remaining_balance) - parseFloat(loan.monthly_principal));
    const newInterestPaid = parseFloat(loan.interest_paid) + parseFloat(loan.monthly_interest);
    const newMonthsPaid = loan.months_paid + 1;
    const newStatus = newBalance <= 0 ? 'cleared' : 'active';

    await client.query(`
      UPDATE loans SET remaining_balance=$1, interest_paid=$2, months_paid=$3, status=$4, updated_at=NOW()
      WHERE id=$5
    `, [newBalance, newInterestPaid, newMonthsPaid, newStatus, id]);

    await client.query(`
      INSERT INTO loan_repayments (loan_id, member_id, principal_paid, interest_paid, month, year)
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [id, loan.member_id, loan.monthly_principal, loan.monthly_interest, month, year]);

    await client.query('COMMIT');
    res.json({ message: 'Repayment recorded', newBalance, newStatus });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

module.exports = { getLoans, getMemberLoans, createLoan, updateLoan, deleteLoan, addRepayment };
