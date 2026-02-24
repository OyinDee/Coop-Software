const db = require('../db');

async function getDashboard(req, res) {
  try {
    const [membersRes, savingsRes, loansRes, interestRes, topSaversRes, activeLoansRes] = await Promise.all([
      db.query('SELECT COUNT(*) FROM members WHERE is_active = TRUE'),
      db.query('SELECT COALESCE(SUM(amount), 0) AS total FROM savings'),
      db.query("SELECT COALESCE(SUM(remaining_balance), 0) AS total FROM loans WHERE status = 'active'"),
      db.query("SELECT COALESCE(SUM(total_interest - interest_paid), 0) AS total FROM loans WHERE status = 'active'"),
      db.query(`
        SELECT m.full_name, m.ledger_no, COALESCE(SUM(s.amount), 0) AS total_savings
        FROM members m
        JOIN savings s ON s.member_id = m.id
        GROUP BY m.id
        ORDER BY total_savings DESC
        LIMIT 5
      `),
      db.query(`
        SELECT m.full_name, m.ledger_no,
          COALESCE(SUM(l.remaining_balance), 0) AS loan_balance,
          COALESCE(SUM(l.total_interest - l.interest_paid), 0) AS interest_due,
          COUNT(l.id) AS loan_count
        FROM members m
        JOIN loans l ON l.member_id = m.id AND l.status = 'active'
        GROUP BY m.id
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
