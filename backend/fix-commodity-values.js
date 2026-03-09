require('dotenv').config();
const db = require('./src/db');

async function fixCommodityValues() {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    
    console.log('Fixing commodity monthly_trans values...');
    
    // Get all members who have commodity records
    const members = await client.query(`
      SELECT DISTINCT member_id FROM commodity
    `);
    
    let fixed = 0;
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    
    for (const memberRow of members.rows) {
      const memberId = memberRow.member_id;
      
      // Calculate correct total commodity balance for this member
      const balanceRes = await client.query(
        'SELECT COALESCE(SUM(amount), 0) AS total FROM commodity WHERE member_id = $1',
        [memberId]
      );
      const correctTotal = parseFloat(balanceRes.rows[0].total);
      
      // Update monthly_trans with correct value
      await client.query(`
        INSERT INTO monthly_trans (member_id, column_key, amount, month, year)
        VALUES ($1, 'comm_bal_cf', $2, $3, $4)
        ON CONFLICT (member_id, column_key, month, year)
        DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()
      `, [memberId, correctTotal, currentMonth, currentYear]);
      
      console.log(`Fixed member ${memberId}: commodity balance = ${correctTotal}`);
      fixed++;
    }
    
    await client.query('COMMIT');
    console.log(`✅ Fixed ${fixed} member commodity balances`);
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error:', err.message);
  } finally {
    client.release();
    process.exit(0);
  }
}

fixCommodityValues();