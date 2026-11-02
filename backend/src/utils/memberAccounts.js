const bcrypt = require('bcryptjs');
const db = require('../db');

const DEFAULT_MEMBER_PASSWORD = process.env.MEMBER_DEFAULT_PASSWORD || 'member123';

let cachedHash = null;

async function getDefaultMemberHash() {
  if (!cachedHash) {
    cachedHash = await bcrypt.hash(DEFAULT_MEMBER_PASSWORD, 10);
  }
  return cachedHash;
}

// Creates the portal login for a member if it does not exist yet.
// `runner` lets callers reuse a transaction client.
async function ensureMemberAccount(memberId, runner = db) {
  const passwordHash = await getDefaultMemberHash();
  await runner.query(
    `INSERT INTO member_accounts (member_id, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (member_id) DO NOTHING`,
    [memberId, passwordHash]
  );
}

module.exports = { DEFAULT_MEMBER_PASSWORD, getDefaultMemberHash, ensureMemberAccount };
