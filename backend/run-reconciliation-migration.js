const db = require('./src/db');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  try {
    console.log('Creating reconciliation_data table...');
    
    const sql = fs.readFileSync(path.join(__dirname, 'create-reconciliation-table.sql'), 'utf8');
    await db.query(sql);
    
    console.log('✓ Reconciliation table created successfully');
    process.exit(0);
  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();