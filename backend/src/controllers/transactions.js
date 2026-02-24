const db = require('../db');

async function getTransactions(req, res) {
  const { month, year } = req.query;
  try {
    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year) || new Date().getFullYear();

    // Loan active in month M/Y if:
    //   issue_ym <= query_ym  AND  query_ym - issue_ym < months
    // where *_ym = year*12 + month
    const result = await db.query(`
      SELECT
        m.ledger_no,
        m.full_name,
        -- Savings: actual record or carry-forward from most recent past record
        COALESCE(
          s.amount,
          (SELECT sv.amount FROM savings sv
           WHERE sv.member_id = m.id
             AND (sv.year < $2 OR (sv.year = $2 AND sv.month < $1))
           ORDER BY sv.year DESC, sv.month DESC LIMIT 1),
          0
        ) AS savings,
        CASE
          WHEN s.id IS NOT NULL THEN FALSE
          WHEN (
            SELECT 1 FROM savings sv WHERE sv.member_id = m.id
              AND (sv.year < $2 OR (sv.year = $2 AND sv.month < $1))
            LIMIT 1
          ) IS NOT NULL THEN TRUE
          ELSE NULL
        END AS savings_carried,
        COALESCE(sh.amount, 0) AS shares,
        COALESCE(c.amount, 0)  AS commodity,
        -- Loan principal: loans that have started, not yet cleared, and within their scheduled term
        COALESCE((
          SELECT SUM(l.monthly_principal) FROM loans l
          WHERE l.member_id = m.id
            AND l.status = 'active'
            AND (EXTRACT(YEAR FROM l.date_issued)::int * 12 + EXTRACT(MONTH FROM l.date_issued)::int) <= ($2 * 12 + $1)
            AND ($2 * 12 + $1) < (EXTRACT(YEAR FROM l.date_issued)::int * 12 + EXTRACT(MONTH FROM l.date_issued)::int + l.months)
        ), 0) AS loan_principal_due,
        -- Loan interest: same set of loans
        COALESCE((
          SELECT SUM(l.monthly_interest) FROM loans l
          WHERE l.member_id = m.id
            AND l.status = 'active'
            AND (EXTRACT(YEAR FROM l.date_issued)::int * 12 + EXTRACT(MONTH FROM l.date_issued)::int) <= ($2 * 12 + $1)
            AND ($2 * 12 + $1) < (EXTRACT(YEAR FROM l.date_issued)::int * 12 + EXTRACT(MONTH FROM l.date_issued)::int + l.months)
        ), 0) AS loan_interest_due
      FROM members m
      LEFT JOIN savings  s  ON s.member_id  = m.id AND s.month  = $1 AND s.year  = $2
      LEFT JOIN shares   sh ON sh.member_id = m.id AND sh.month = $1 AND sh.year = $2
      LEFT JOIN commodity c ON c.member_id  = m.id AND c.month  = $1 AND c.year  = $2
      WHERE m.is_active = TRUE
      ORDER BY m.ledger_no
    `, [m, y]);

    res.json({ transactions: result.rows, month: m, year: y });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getMemberTransactions(req, res) {
  const { memberId } = req.params;
  try {
    const savingsResult = await db.query(
      'SELECT *, \'savings\' as type FROM savings WHERE member_id=$1 ORDER BY year DESC, month DESC',
      [memberId]
    );
    const repaymentResult = await db.query(
      'SELECT *, \'repayment\' as type FROM loan_repayments WHERE member_id=$1 ORDER BY year DESC, month DESC',
      [memberId]
    );
    res.json({ savings: savingsResult.rows, repayments: repaymentResult.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getMonthlyReport(req, res) {
  const { month, year } = req.query;
  const m = parseInt(month) || new Date().getMonth() + 1;
  const y = parseInt(year) || new Date().getFullYear();

  try {
    const [savingsRes, loansRes, commodityRes] = await Promise.all([
      // Savings: actual records + carried-forward amounts for members without a record
      db.query(`
        SELECT COALESCE(SUM(
          COALESCE(
            s.amount,
            (SELECT sv.amount FROM savings sv
             WHERE sv.member_id = mem.id
               AND (sv.year < $2 OR (sv.year = $2 AND sv.month < $1))
             ORDER BY sv.year DESC, sv.month DESC LIMIT 1),
            0
          )
        ), 0) AS total
        FROM members mem
        LEFT JOIN savings s ON s.member_id = mem.id AND s.month = $1 AND s.year = $2
        WHERE mem.is_active = TRUE
      `, [m, y]),
      // Loans: active loans within their scheduled term
      db.query(`
        SELECT
          COALESCE(SUM(monthly_principal), 0) AS principal,
          COALESCE(SUM(monthly_interest),  0) AS interest
        FROM loans l
        WHERE l.status = 'active'
          AND (EXTRACT(YEAR FROM l.date_issued)::int * 12 + EXTRACT(MONTH FROM l.date_issued)::int) <= ($2 * 12 + $1)
          AND ($2 * 12 + $1) < (EXTRACT(YEAR FROM l.date_issued)::int * 12 + EXTRACT(MONTH FROM l.date_issued)::int + l.months)
      `, [m, y]),
      db.query('SELECT COALESCE(SUM(amount),0) as total FROM commodity WHERE month=$1 AND year=$2', [m, y]),
    ]);

    res.json({
      month: m, year: y,
      totalSavings: parseFloat(savingsRes.rows[0].total),
      totalLoanPrincipal: parseFloat(loansRes.rows[0].principal),
      totalLoanInterest: parseFloat(loansRes.rows[0].interest),
      totalCommodity: parseFloat(commodityRes.rows[0].total),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getTransactions, getMemberTransactions, getMonthlyReport };
