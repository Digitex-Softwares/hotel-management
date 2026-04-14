import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (!process.env.MAIL_HOST || !process.env.MAIL_USER) {
    return null;
  }

  transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: Number(process.env.MAIL_PORT || 587),
    secure: String(process.env.MAIL_SECURE || 'false') === 'true',
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS
    }
  });

  return transporter;
}

export async function sendEmail(to, subject, html) {
  const t = getTransporter();
  if (!t) {
    console.log('[email disabled]', { to, subject });
    return;
  }
  await t.sendMail({
    from: process.env.MAIL_FROM || 'no-reply@example.com',
    to,
    subject,
    html
  });
}
