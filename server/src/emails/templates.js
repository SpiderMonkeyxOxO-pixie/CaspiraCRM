// Plain, minimal HTML templates — Mailpit renders whatever is sent, and
// nothing here needs marketing polish, just correct, unambiguous content.
// Every function returns { subject, html, text }; callers pass the result
// straight into outboxService.recordOutboxEvent()'s payload.
// Every value placed in the HTML goes through e(): names, organization and
// role names and message bodies come from users.
const APP_NAME = "Caspira CRM";
const wrap = (bodyHtml) => `<div style="font-family:sans-serif;font-size:14px;color:#111"><p><strong>${APP_NAME}</strong></p>${bodyHtml}</div>`;
const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function invitationEmail({ organizationName, inviterName, roleName, acceptUrl, expiresAt }) {
  return {
    subject: `You've been invited to join ${organizationName} on ${APP_NAME}`,
    html: wrap(`
      <p>${e(inviterName)} invited you to join <strong>${e(organizationName)}</strong> as <strong>${e(roleName)}</strong>.</p>
      <p><a href="${e(acceptUrl)}">Accept invitation</a></p>
      <p style="color:#666">This link expires ${new Date(expiresAt).toUTCString()} and can only be used once.</p>
    `),
  };
}

export function inviteLinkAcceptedEmail({ organizationName, memberEmail, memberName }) {
  return {
    subject: `${memberName || memberEmail} joined ${organizationName} via an invite link`,
    html: wrap(`<p><strong>${e(memberName || memberEmail)}</strong> (${e(memberEmail)}) just joined <strong>${e(organizationName)}</strong> using an organization invite link.</p>`),
  };
}

export function emailVerificationEmail({ name, verifyUrl }) {
  return {
    subject: `Verify your email — ${APP_NAME}`,
    html: wrap(`<p>Hi ${e(name)},</p><p>Please confirm this is your email address:</p><p><a href="${e(verifyUrl)}">Verify email</a></p>`),
  };
}

export function passwordResetEmail({ name, resetUrl }) {
  return {
    subject: `Reset your password — ${APP_NAME}`,
    html: wrap(`
      <p>Hi ${e(name)},</p>
      <p>A password reset was requested for your account. If this was you:</p>
      <p><a href="${e(resetUrl)}">Reset password</a></p>
      <p style="color:#666">If you didn't request this, you can safely ignore this email — your password won't change unless you click the link above.</p>
    `),
  };
}

export function passwordChangedEmail({ name }) {
  return {
    subject: `Your password was changed — ${APP_NAME}`,
    html: wrap(`<p>Hi ${e(name)},</p><p>Your password was just changed. If this wasn't you, contact your workspace administrator immediately.</p>`),
  };
}

// Two-factor authentication turned on or off for the account.
export function twoFactorChangedEmail({ name, enabled }) {
  const what = enabled ? "turned on" : "turned off";
  return {
    subject: `Two-factor authentication was ${what} — ${APP_NAME}`,
    html: wrap(`<p>Hi ${e(name)},</p><p>Two-factor authentication was just ${what} for your account. If this wasn't you, contact your workspace administrator immediately.</p>`),
  };
}

// A two-factor recovery code was used to sign in.
export function recoveryCodeUsedEmail({ name, remaining }) {
  return {
    subject: `A recovery code was used to sign in — ${APP_NAME}`,
    html: wrap(`<p>Hi ${e(name)},</p><p>Someone signed in to your account with one of your two-factor recovery codes. ${Number(remaining)} unused code(s) are left.</p><p>If this wasn't you, change your password and create new recovery codes now, and contact your workspace administrator.</p>`),
  };
}

export function newMembershipEmail({ name, organizationName, roleName }) {
  return {
    subject: `You're now a member of ${organizationName}`,
    html: wrap(`<p>Hi ${e(name)},</p><p>You've been added to <strong>${e(organizationName)}</strong> as <strong>${e(roleName)}</strong>.</p>`),
  };
}

export function suspiciousRefreshReuseEmail({ name }) {
  return {
    subject: `Security alert: unusual sign-in activity — ${APP_NAME}`,
    html: wrap(`
      <p>Hi ${e(name)},</p>
      <p>We detected an attempt to reuse an already-rotated session on your account and revoked every active session as a precaution.
      Please log in again. If this wasn't you, consider changing your password.</p>
    `),
  };
}

// An agent's public reply on a support ticket, sent to the ticket's contact.
export function ticketReplyEmail({ organizationName, ticketNumber, ticketSubject, contactName, agentName, body }) {
  return {
    subject: `Re: [${ticketNumber}] ${ticketSubject}`,
    html: `<div style="font-family:sans-serif;font-size:14px;color:#111">
      <p>Hi ${e(contactName || "there")},</p>
      <div style="white-space:pre-wrap">${e(body)}</div>
      <p style="margin-top:16px">${e(agentName)}<br>${e(organizationName)} support</p>
      <p style="color:#666;font-size:12px">About your request ${e(ticketNumber)}: ${e(ticketSubject)}. Reply to this email or contact us as usual.</p>
    </div>`,
    text: `Hi ${contactName || "there"},\n\n${body}\n\n${agentName}\n${organizationName} support\n\nAbout your request ${ticketNumber}: ${ticketSubject}.`,
  };
}
