// Plain, minimal HTML templates — Mailpit renders whatever is sent, and
// nothing here needs marketing polish, just correct, unambiguous content.
// Every function returns { subject, html, text }; callers pass the result
// straight into outboxService.recordOutboxEvent()'s payload.
const APP_NAME = "Caspira CRM";
const wrap = (bodyHtml) => `<div style="font-family:sans-serif;font-size:14px;color:#111"><p><strong>${APP_NAME}</strong></p>${bodyHtml}</div>`;

export function invitationEmail({ organizationName, inviterName, roleName, acceptUrl, expiresAt }) {
  return {
    subject: `You've been invited to join ${organizationName} on ${APP_NAME}`,
    html: wrap(`
      <p>${inviterName} invited you to join <strong>${organizationName}</strong> as <strong>${roleName}</strong>.</p>
      <p><a href="${acceptUrl}">Accept invitation</a></p>
      <p style="color:#666">This link expires ${new Date(expiresAt).toUTCString()} and can only be used once.</p>
    `),
  };
}

export function inviteLinkAcceptedEmail({ organizationName, memberEmail, memberName }) {
  return {
    subject: `${memberName || memberEmail} joined ${organizationName} via an invite link`,
    html: wrap(`<p><strong>${memberName || memberEmail}</strong> (${memberEmail}) just joined <strong>${organizationName}</strong> using an organization invite link.</p>`),
  };
}

export function emailVerificationEmail({ name, verifyUrl }) {
  return {
    subject: `Verify your email — ${APP_NAME}`,
    html: wrap(`<p>Hi ${name},</p><p>Please confirm this is your email address:</p><p><a href="${verifyUrl}">Verify email</a></p>`),
  };
}

export function passwordResetEmail({ name, resetUrl }) {
  return {
    subject: `Reset your password — ${APP_NAME}`,
    html: wrap(`
      <p>Hi ${name},</p>
      <p>A password reset was requested for your account. If this was you:</p>
      <p><a href="${resetUrl}">Reset password</a></p>
      <p style="color:#666">If you didn't request this, you can safely ignore this email — your password won't change unless you click the link above.</p>
    `),
  };
}

export function passwordChangedEmail({ name }) {
  return {
    subject: `Your password was changed — ${APP_NAME}`,
    html: wrap(`<p>Hi ${name},</p><p>Your password was just changed. If this wasn't you, contact your workspace administrator immediately.</p>`),
  };
}

const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Two-factor authentication turned on or off for the account.
export function twoFactorChangedEmail({ name, enabled }) {
  const what = enabled ? "turned on" : "turned off";
  return {
    subject: `Two-factor authentication was ${what} — ${APP_NAME}`,
    html: wrap(`<p>Hi ${escapeHtml(name)},</p><p>Two-factor authentication was just ${what} for your account. If this wasn't you, contact your workspace administrator immediately.</p>`),
  };
}

export function newMembershipEmail({ name, organizationName, roleName }) {
  return {
    subject: `You're now a member of ${organizationName}`,
    html: wrap(`<p>Hi ${name},</p><p>You've been added to <strong>${organizationName}</strong> as <strong>${roleName}</strong>.</p>`),
  };
}

export function suspiciousRefreshReuseEmail({ name }) {
  return {
    subject: `Security alert: unusual sign-in activity — ${APP_NAME}`,
    html: wrap(`
      <p>Hi ${name},</p>
      <p>We detected an attempt to reuse an already-rotated session on your account and revoked every active session as a precaution.
      Please log in again. If this wasn't you, consider changing your password.</p>
    `),
  };
}
