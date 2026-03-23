require('dotenv').config();
const db = require('./src/db');

async function checkLoanTable() {
  try {
    // Check loans table structure
    const result = await db.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'loans' 
      ORDER BY ordinal_position
    `);
    
    console.log('Loans table structure:');
    result.rows.forEach((row, i) => {
      console.log(`${i + 1}. ${row.column_name} (${row.data_type})`);
    });

    // Check if there's any loan data
    const loanData = await db.query('SELECT * FROM loans LIMIT 3');
    console.log('\nSample loan data:');
    console.log(loanData.rows);

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

checkLoanTable();
