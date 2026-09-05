import nodemailer from "nodemailer";

// Local-only transactional email via Mailpit. Never a real provider
// (Gmail/Outlook/SendGrid/etc.) in this phase — see docs/BACKEND_PHASE1.md.
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "127.0.0.1",
  port: Number(process.env.SMTP_PORT) || 1026,
  secure: false,
  ignoreTLS: true,
});

export async function sendMail({ to, subject, html, text }) {
  return transporter.sendMail({
    from: process.env.SMTP_FROM || "Caspira CRM <no-reply@caspira-crm.local>",
    to,
    subject,
    html,
    text: text || html?.replace(/<[^>]+>/g, " "),
  });
}

export async function verifyMailerConnection() {
  await transporter.verify();
}

export default transporter;
