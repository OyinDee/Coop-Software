require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const db = require('./src/db');
const { parse } = require('csv-parse/sync');
const fs = require('fs');
const path = require('path');

async function test() {
  // Check members columns
  const colRes = await db.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='members'"
  );
  console.log('Members columns:', colRes.rows.map(x => x.column_name).join(', '));

  // Try to find the CSV
  const csvPath = path.join(__dirname, '..', 'trans1.csv');
  if (!fs.existsSync(csvPath)) {
    console.log('No trans1.csv found at', csvPath);
    // Try to simulate a minimal CSV row
  } else {
    console.log('CSV found, parsing...');
    const buf = fs.readFileSync(csvPath);
    try {
      const records = parse(buf, {
        skip_empty_lines: false,
        trim: true,
        relax_column_count: true,
        bom: true,
      });
      console.log('Total rows:', records.length);
      console.log('Header row:', records[0].slice(0, 10));
      console.log('Row 1:', records[1] ? records[1].slice(0, 6) : 'none');
      console.log('Row 2:', records[2] ? records[2].slice(0, 6) : 'none');
    } catch(e) {
      console.error('CSV parse error:', e.message);
    }
  }

  // Test the auto-upsert query
  try {
    const r = await db.query(
      `INSERT INTO members (ledger_no, staff_no, gifmis_no, full_name, is_active)
       VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT (ledger_no) DO UPDATE
         SET staff_no  = COALESCE(EXCLUDED.staff_no, members.staff_no),
             gifmis_no = COALESCE(EXCLUDED.gifmis_no, members.gifmis_no),
             updated_at = NOW()
       RETURNING id`,
      ['TEST/001', 'S001', null, 'Test Member']
    );
    console.log('Auto-create test OK, id=', r.rows[0].id);
    // Clean up
    await db.query("DELETE FROM members WHERE ledger_no='TEST/001'");
  } catch(e) {
    console.error('Auto-create test FAILED:', e.message);
  }

  process.exit(0);
}

test().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
