// Script to migrate legacy loan balances and repayments from monthly_trans to loans and loan_repayments tables
// Run with: node backend/scripts/migrate-legacy-loans.js

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../src/db');

async function migrateLegacyLoans() {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // 1. Find all members with a loan principal balance (loan_bal_bf or loan_granted)
    const membersRes = await client.query(`
      SELECT DISTINCT member_id FROM monthly_trans
      WHERE column_key IN ('loan_bal_bf', 'loan_granted')
    `);
    const memberIds = membersRes.rows.map(r => r.member_id);
    let createdLoans = 0, createdRepayments = 0;

    for (const memberId of memberIds) {
      // Find the latest month/year with a loan balance for this member
      const balRes = await client.query(`
        SELECT month, year, SUM(CASE WHEN column_key='loan_bal_bf' THEN amount ELSE 0 END) AS bal_bf,
               SUM(CASE WHEN column_key='loan_granted' THEN amount ELSE 0 END) AS granted
        FROM monthly_trans
        WHERE member_id=$1 AND column_key IN ('loan_bal_bf', 'loan_granted')
        GROUP BY month, year
        ORDER BY year DESC, month DESC LIMIT 1
      `, [memberId]);
      if (!balRes.rows.length) continue;
      const { month, year, bal_bf, granted } = balRes.rows[0];
      const principal = parseFloat(bal_bf) + parseFloat(granted);
      if (principal <= 0) continue;

      // Check if a loan already exists for this member for this period
      const exists = await client.query(
        'SELECT id FROM loans WHERE member_id=$1 AND principal=$2 AND status IN (\'active\', \'cleared\')',
        [memberId, principal]
      );
      if (exists.rows.length) continue;

      // Insert loan
      const months = 12; // Default to 12 months if unknown
      const total_interest = Math.round(principal * 0.05); // Default 5% interest
      const monthly_principal = principal / months;
      const monthly_interest = total_interest / months;
      const result = await client.query(`
        INSERT INTO loans (member_id, principal, months, remaining_balance, monthly_principal, total_interest, monthly_interest, interest_paid, months_paid, months_remaining, interest_rate, status, date_issued)
        VALUES ($1,$2,$3,$2,$4,$5,$6,0,0,$3,0.05,'active', NOW())
        RETURNING id
      `, [memberId, principal, months, monthly_principal, total_interest, monthly_interest]);
      const loanId = result.rows[0].id;
      createdLoans++;

      // 2. Find all repayments for this member
      const repayRes = await client.query(`
        SELECT month, year, 
          SUM(CASE WHEN column_key='loan_repayment' THEN amount ELSE 0 END) AS principal_paid,
          SUM(CASE WHEN column_key='loan_int_paid' THEN amount ELSE 0 END) AS interest_paid
        FROM monthly_trans
        WHERE member_id=$1 AND column_key IN ('loan_repayment', 'loan_int_paid')
        GROUP BY month, year
        ORDER BY year, month
      `, [memberId]);
      for (const row of repayRes.rows) {
        if (parseFloat(row.principal_paid) > 0 || parseFloat(row.interest_paid) > 0) {
          await client.query(`
            INSERT INTO loan_repayments (loan_id, member_id, principal_paid, interest_paid, month, year, description)
            VALUES ($1,$2,$3,$4,$5,$6,'Migrated from monthly_trans')
          `, [loanId, memberId, row.principal_paid, row.interest_paid, row.month, row.year]);
          createdRepayments++;
        }
      }
    }

    await client.query('COMMIT');
    console.log(`Migration complete: ${createdLoans} loans, ${createdRepayments} repayments created.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
  } finally {
    client.release();
  }
}

migrateLegacyLoans();
