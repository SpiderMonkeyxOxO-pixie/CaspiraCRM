import prisma from "../lib/prisma.js";

// Customer Portal access (Backend Phase 4; reused by the Projects and
// Finance portal APIs). Runs after authenticateCookie. The caller must have
// a PortalAccount — an internal organization membership never counts, and
// a portal account never grants internal access (internal routes require a
// membership, which portal users don't have).
//
// Which organization: `organizationId` from the query/body when given,
// otherwise the customer's only portal account. A Suspended account is
// refused on its very next request. The first successful request of an
// Invited account marks it Active.
const LAST_ACCESS_THROTTLE_MS = 5 * 60 * 1000;

export async function requirePortalAccount(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ code: "AUTH_REQUIRED", message: "Log in to use the customer portal." });
    const organizationId = req.query?.organizationId || req.body?.organizationId || null;
    const accounts = await prisma.portalAccount.findMany({ where: { userId: req.user.id, ...(organizationId && { organizationId }) } });
    if (!accounts.length) return res.status(403).json({ code: "PORTAL_ACCESS_DENIED", message: "This login doesn't have customer portal access." });
    if (accounts.length > 1) return res.status(400).json({ code: "PORTAL_ORGANIZATION_REQUIRED", message: "Choose which organization's portal to use (organizationId)." });
    let account = accounts[0];
    if (account.status === "Suspended") return res.status(403).json({ code: "PORTAL_ACCESS_SUSPENDED", message: "Your portal access has been suspended." });

    const now = new Date();
    const data = {};
    if (account.status === "Invited") Object.assign(data, { status: "Active", activatedAt: now });
    if (!account.lastAccessAt || now - account.lastAccessAt > LAST_ACCESS_THROTTLE_MS) data.lastAccessAt = now;
    if (Object.keys(data).length) account = await prisma.portalAccount.update({ where: { id: account.id }, data });

    req.portal = account;
    req.organizationId = account.organizationId;
    next();
  } catch (err) {
    next(err);
  }
}
