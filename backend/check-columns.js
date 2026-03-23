require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : false,
});

async function checkMonthlyTrans() {
  try {
    await client.connect();
    const result = await client.query('SELECT DISTINCT column_key FROM monthly_trans ORDER BY column_key');
    console.log('Available column_keys in monthly_trans:');
    result.rows.forEach((row, i) => {
      console.log(`${i + 1}. ${row.column_key}`);
    });
    await client.end();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    await client.end();
    process.exit(1);
  }
}

checkMonthlyTrans();
