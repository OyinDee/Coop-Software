const express = require('express');
const db = require('../db');
const router = express.Router();

// Fix commodity negative values
router.post('/fix-commodity', async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    
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
      
      fixed++;
    }
    
    await client.query('COMMIT');
    res.json({ 
      success: true, 
      message: `Fixed ${fixed} member commodity balances`,
      fixed 
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Update column labels to be context-neutral
router.post('/update-column-labels', async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    
    // Update the fixed column labels 
    const result = await client.query(`
      UPDATE balance_columns SET label = CASE 
        WHEN key = 'loans' THEN 'Loans'
        WHEN key = 'loan_interest' THEN 'Loan Interest' 
        WHEN key = 'commodity' THEN 'Commodity'
        WHEN key = 'savings' THEN 'Savings'
        WHEN key = 'shares' THEN 'Shares'
        ELSE label
      END
      WHERE key IN ('loans', 'loan_interest', 'commodity', 'savings', 'shares')
      RETURNING *
    `);
    
    await client.query('COMMIT');
    
    // Get all columns to show current state
    const columns = await db.query('SELECT key, label, type FROM balance_columns ORDER BY sort_order, id');
    
    res.json({ 
      success: true,
      message: 'Updated column labels successfully',
      updated: result.rowCount,
      columns: columns.rows
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;