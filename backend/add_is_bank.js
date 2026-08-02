const { Client } = require('pg');
require('dotenv').config({ path: './.env' });

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log('Adding is_bank column to savings table...');
  try {
    await client.query(`ALTER TABLE savings ADD COLUMN IF NOT EXISTS is_bank BOOLEAN DEFAULT FALSE`);
    console.log('Column added successfully.');
  } catch (e) {
    console.error('Error adding column:', e);
  }

  await client.end();
}
run();
