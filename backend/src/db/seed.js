require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const bcrypt = require('bcryptjs');
const db = require('./index');

async function seed() {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Seed admin
    const passwordHash = await bcrypt.hash('admin123', 10);
    await client.query(`
      INSERT INTO admins (username, password_hash, full_name)
      VALUES ($1, $2, $3)
      ON CONFLICT (username) DO NOTHING;
    `, ['admin', passwordHash, 'Administrator']);

    // Seed members
    const members = [
      ['SCMS/001', 'SS0000', null, 'SSANU, FUOYE', 'Male', 'Married', null, null, null, 'FIDELITY', null, null, null, null],
      ['SCMS/002', 'SS0090', null, 'ADOHOJE, EMMANUEL USMAN', 'Male', 'Married', '08012345678', null, '2016-01-01', 'UBA', null, null, null, null],
      ['SCMS/003', 'SS0481', null, 'ADEMOLA, MUTIU ADEKUNLE', 'Male', 'Married', null, null, null, 'FBN', null, null, null, null],
      ['SCMS/007', 'SS0112', 'FUO12351', 'IBRAHIM, AHMED BELLO', 'Male', 'Married', '08012345678', 'ahmed.ibrahim@fuoye.edu.ng', '2016-08-01', 'ACCESS', '0123456789', 'Engineering', 'Fatima Ibrahim', 'Wife'],
      ['SCMS/012', 'SS0203', null, 'OKAFOR, NGOZI PATRICIA', 'Female', 'Single', null, null, null, 'GTB', null, 'Sciences', null, null],
    ];

    const memberIds = {};
    for (const m of members) {
      const res = await client.query(`
        INSERT INTO members (ledger_no, staff_no, gifmis_no, full_name, gender, marital_status, phone, email, date_of_admission, bank, account_number, department, next_of_kin, next_of_kin_relation)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (ledger_no) DO UPDATE SET full_name = EXCLUDED.full_name
        RETURNING id, ledger_no;
      `, m);
      memberIds[res.rows[0].ledger_no] = res.rows[0].id;
    }

    // Savings
    const savingsData = [
      [memberIds['SCMS/001'], 200000, 2, 2026, 'Monthly savings'],
      [memberIds['SCMS/002'], 500000, 2, 2026, 'Monthly savings'],
      [memberIds['SCMS/003'], 500000, 2, 2026, 'Monthly savings'],
      [memberIds['SCMS/007'], 310000, 2, 2026, 'Monthly savings'],
      [memberIds['SCMS/012'], 380000, 2, 2026, 'Monthly savings'],
    ];
    for (const s of savingsData) {
      await client.query(`
        INSERT INTO savings (member_id, amount, month, year, description)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (member_id, month, year) DO NOTHING;
      `, s);
    }

    // Shares
    const sharesData = [
      [memberIds['SCMS/007'], 150000, 2, 2026],
    ];
    for (const s of sharesData) {
      await client.query(`
        INSERT INTO shares (member_id, amount, month, year) VALUES ($1,$2,$3,$4)
        ON CONFLICT (member_id, month, year) DO NOTHING;
      `, s);
    }

    // Commodity
    await client.query(`
      INSERT INTO commodity (member_id, amount, description, month, year)
      VALUES ($1, 12000, 'General commodity', 2, 2026);
    `, [memberIds['SCMS/007']]);

    // Loans for SSANU (SCMS/001)
    await client.query(`
      INSERT INTO loans (member_id, principal, months, remaining_balance, monthly_principal, total_interest, monthly_interest, interest_paid, months_paid, status)
      VALUES ($1, 1900000, 12, 1900000, 158333.33, 95000, 7916.67, 0, 0, 'active')
      ON CONFLICT DO NOTHING;
    `, [memberIds['SCMS/001']]);

    // Loans for ADOHOJE (SCMS/002)
    await client.query(`
      INSERT INTO loans (member_id, principal, months, remaining_balance, monthly_principal, total_interest, monthly_interest, interest_paid, months_paid, status)
      VALUES ($1, 50000, 6, 50000, 8333.33, 2500, 416.67, 0, 0, 'active')
      ON CONFLICT DO NOTHING;
    `, [memberIds['SCMS/002']]);

    // Loans for ADEMOLA (SCMS/003)
    await client.query(`
      INSERT INTO loans (member_id, principal, months, remaining_balance, monthly_principal, total_interest, monthly_interest, interest_paid, months_paid, status)
      VALUES ($1, 1000000, 12, 1000000, 83333.33, 50000, 4166.67, 0, 0, 'active')
      ON CONFLICT DO NOTHING;
    `, [memberIds['SCMS/003']]);

    // 2 Loans for IBRAHIM (SCMS/007)
    await client.query(`
      INSERT INTO loans (member_id, principal, months, remaining_balance, monthly_principal, total_interest, monthly_interest, interest_paid, months_paid, status)
      VALUES ($1, 500000, 12, 500000, 41666.67, 25000, 2083.33, 0, 0, 'active')
      ON CONFLICT DO NOTHING;
    `, [memberIds['SCMS/007']]);
    await client.query(`
      INSERT INTO loans (member_id, principal, months, remaining_balance, monthly_principal, total_interest, monthly_interest, interest_paid, months_paid, status)
      VALUES ($1, 250000, 6, 250000, 41666.67, 12500, 2083.33, 0, 0, 'active')
      ON CONFLICT DO NOTHING;
    `, [memberIds['SCMS/007']]);

    await client.query('COMMIT');
    console.log('Seed completed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
    throw err;
  } finally {
    client.release();
    process.exit(0);
  }
}

seed().catch(console.error);
