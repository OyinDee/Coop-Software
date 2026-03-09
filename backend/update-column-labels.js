require('dotenv').config();
const db = require('./src/db');

async function updateColumnLabels() {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    
    console.log('Updating balance_columns labels for better deductions context...');
    
    // Update the fixed column labels to be more context-neutral
    await client.query(`
      UPDATE balance_columns SET label = CASE 
        WHEN key = 'loans' THEN 'Loans'
        WHEN key = 'loan_interest' THEN 'Loan Interest' 
        WHEN key = 'commodity' THEN 'Commodity'
        WHEN key = 'savings' THEN 'Savings'
        WHEN key = 'shares' THEN 'Shares'
        ELSE label
      END
      WHERE key IN ('loans', 'loan_interest', 'commodity', 'savings', 'shares')
    `);
    
    await client.query('COMMIT');
    console.log('✅ Updated column labels successfully');
    
    // Show the updated columns
    const result = await db.query('SELECT key, label, type FROM balance_columns ORDER BY sort_order, id');
    console.log('Updated columns:');
    result.rows.forEach(r => {
      console.log(`  ${r.key} -> "${r.label}" (${r.type})`);
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error:', err.message);
  } finally {
    client.release();
    process.exit(0);
  }
}

updateColumnLabels();