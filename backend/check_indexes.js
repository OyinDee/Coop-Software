const { Client } = require('pg');
require('dotenv').config({ path: './.env' });

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const r = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
  console.log('TABLES:', r.rows.map(row => row.table_name));

  await client.end();
}
run();
