// SLA clock hooks called by the ticket workflow. Step 3 of the Phase 4
// completion replaces these with versioned policies, business hours and
// persisted SLA clocks; until then tickets keep the legacy fixed windows
// (ticketLifecycleService.slaDeadlines) on the ticket itself.
export async function startClocks() {}
export async function onPublicAgentReply() {}
export async function onCustomerMessage() {}
export async function onStatusChange() {}
export async function onPriorityChange() {}
export async function onResolved() {}
export async function onReopened() {}
export async function onFinished() {}
