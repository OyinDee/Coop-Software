const db = require('../db');

async function getDashboard(req, res) {
  try {
    const [membersRes, savingsRes, loansRes, interestRes, topSaversRes, activeLoansRes] = await Promise.all([
      db.query('SELECT COUNT(*) FROM members WHERE is_active = TRUE'),
      db.query(`
        SELECT COALESCE(SUM(amount), 0) AS total 
        FROM (
          SELECT DISTINCT ON (member_id) member_id, amount
          FROM monthly_trans 
          WHERE column_key IN ('savings_cf', 'savings_bf') AND amount > 0
          ORDER BY member_id, year DESC, month DESC
        ) latest_savings
      `),
      db.query(`
        SELECT COALESCE(SUM(amount), 0) AS total 
        FROM (
          SELECT DISTINCT ON (member_id) member_id, amount
          FROM monthly_trans 
          WHERE column_key IN ('loan_ledger_bal', 'loan_bal_bf') AND amount > 0
          ORDER BY member_id, year DESC, month DESC
        ) latest_loans
      `),
      db.query(`
        SELECT COALESCE(SUM(amount), 0) AS total 
        FROM (
          SELECT DISTINCT ON (member_id) member_id, amount
          FROM monthly_trans 
          WHERE column_key IN ('loan_int_cf', 'loan_int_bf') AND amount > 0
          ORDER BY member_id, year DESC, month DESC
        ) latest_loan_interest
      `),
      db.query(`
        SELECT m.full_name, m.ledger_no, 
          COALESCE(latest.amount, 0) AS total_savings
        FROM members m
        LEFT JOIN (
          SELECT DISTINCT ON (member_id) member_id, amount
          FROM monthly_trans 
          WHERE column_key IN ('savings_cf', 'savings_bf') AND amount > 0
          ORDER BY member_id, year DESC, month DESC
        ) latest ON latest.member_id = m.id
        ORDER BY total_savings DESC
        LIMIT 5
      `),
      db.query(`
        SELECT m.full_name, m.ledger_no,
          COALESCE(loan_bal.amount, 0) AS loan_balance,
          COALESCE(loan_int.amount, 0) AS interest_due,
          CASE WHEN loan_bal.amount > 0 OR loan_int.amount > 0 THEN 1 ELSE 0 END AS loan_count
        FROM members m
        LEFT JOIN (
          SELECT DISTINCT ON (member_id) member_id, amount
          FROM monthly_trans 
          WHERE column_key IN ('loan_ledger_bal', 'loan_bal_bf') AND amount > 0
          ORDER BY member_id, year DESC, month DESC
        ) loan_bal ON loan_bal.member_id = m.id
        LEFT JOIN (
          SELECT DISTINCT ON (member_id) member_id, amount
          FROM monthly_trans 
          WHERE column_key IN ('loan_int_cf', 'loan_int_bf') AND amount > 0
          ORDER BY member_id, year DESC, month DESC
        ) loan_int ON loan_int.member_id = m.id
        WHERE loan_bal.amount > 0 OR loan_int.amount > 0
        ORDER BY loan_balance DESC
        LIMIT 5
      `),
    ]);

    // new members this month
    const now = new Date();
    const newThisMonthRes = await db.query(
      `SELECT COUNT(*) FROM members WHERE is_active = TRUE AND EXTRACT(MONTH FROM created_at) = $1 AND EXTRACT(YEAR FROM created_at) = $2`,
      [now.getMonth() + 1, now.getFullYear()]
    );

    res.json({
      totalMembers: parseInt(membersRes.rows[0].count),
      newThisMonth: parseInt(newThisMonthRes.rows[0].count),
      totalSavings: parseFloat(savingsRes.rows[0].total),
      loanOutstanding: parseFloat(loansRes.rows[0].total),
      interestDue: parseFloat(interestRes.rows[0].total),
      topSavers: topSaversRes.rows,
      activeLoans: activeLoansRes.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getDashboard };
