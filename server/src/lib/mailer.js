import nodemailer from "nodemailer";

// Local development uses Mailpit (no auth, no TLS). Backend Phase 13: a real
// provider is configured with SMTP_HOST/SMTP_PORT, SMTP_USER and the
// SMTP_PASSWORD secret; SMTP_SECURE=true for implicit TLS (port 465),
// otherwise STARTTLS is required whenever credentials are sent.
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASSWORD;
const secure = process.env.SMTP_SECURE === "true";
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "127.0.0.1",
  port: Number(process.env.SMTP_PORT) || 1026,
  secure,
  ...(user && pass ? { auth: { user, pass }, requireTLS: !secure } : { ignoreTLS: true }),
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
