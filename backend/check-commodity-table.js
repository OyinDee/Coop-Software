require('dotenv').config();
const db = require('./src/db');

async function checkCommodityTable() {
  try {
    // Check commodity table structure
    const result = await db.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'commodity' 
      ORDER BY ordinal_position
    `);
    
    console.log('Commodity table structure:');
    result.rows.forEach((row, i) => {
      console.log(`${i + 1}. ${row.column_name} (${row.data_type})`);
    });

    // Check if there's any commodity data
    const commodityData = await db.query('SELECT * FROM commodity LIMIT 3');
    console.log('\nSample commodity data:');
    console.log(commodityData.rows);

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

checkCommodityTable();
