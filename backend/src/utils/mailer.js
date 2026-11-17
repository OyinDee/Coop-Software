const nodemailer = require('nodemailer');
const db = require('../db');

// Builds a nodemailer transport from environment variables or the SMTP
// credentials saved in Settings. Returns { error } when nothing is configured.
async function getMailer() {
  let user = process.env.SMTP_USER;
  let pass = process.env.SMTP_PASS;
  let host = process.env.SMTP_HOST;
  let port = process.env.SMTP_PORT;

  if (!user || !pass) {
    try {
      const res = await db.query(
        "SELECT key, value FROM app_settings WHERE key IN ('smtp_user', 'smtp_pass', 'smtp_host', 'smtp_port')"
      );
      const settings = Object.fromEntries(res.rows.map((r) => [r.key, r.value]));
      if (settings.smtp_user && settings.smtp_pass) {
        user = user || settings.smtp_user;
        pass = pass || settings.smtp_pass;
        host = host || settings.smtp_host;
        port = port || settings.smtp_port;
      }
    } catch (e) {
      console.error('Error fetching SMTP settings from DB:', e);
    }
  }

  if (!user || !pass) {
    return { error: 'Missing SMTP configuration. Set SMTP_USER and SMTP_PASS in environment variables or Settings.' };
  }

  const transportConfig = host ? {
    host,
    port: parseInt(port) || 587,
    secure: parseInt(port) === 465,
    auth: { user, pass },
  } : {
    service: 'gmail',
    auth: { user, pass },
  };

  const transporter = nodemailer.createTransport(transportConfig);

  return { transporter, from: user };
}

module.exports = { getMailer };
