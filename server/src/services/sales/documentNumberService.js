// Concurrency-safe, organization-scoped, sequential document numbers —
// DEAL-2026-000001, QUOTE-2026-000001, ORDER-2026-000001,
// CONTRACT-2026-000001. One counter row per (organizationId, docType);
// incrementing it is a single `UPDATE ... RETURNING`, which Postgres
// executes under the row's own lock — no separate `SELECT ... FOR UPDATE`
// needed, and never based on `COUNT(*)` of existing documents (which
// breaks under concurrent inserts and after archiving).
//
// Must be called from WITHIN the same transaction that creates the
// document, so a rolled-back create never leaves a number "burned" —
// though even if a number is skipped (e.g. a later step in the same
// transaction fails), it is never reused, matching the "never reused
// after archive or cancellation" requirement.
// Ticket (Backend Phase 4) shares the same per-organization counter table.
const PREFIXES = { Deal: "DEAL", Quote: "QUOTE", Order: "ORDER", Contract: "CONTRACT", Ticket: "TICKET", Invoice: "INV", CreditNote: "CN", Expense: "EXP" };

export async function nextDocumentNumber(tx, organizationId, docType) {
  const prefix = PREFIXES[docType];
  if (!prefix) throw new Error(`Unknown document type "${docType}".`);
  const year = new Date().getFullYear();

  await tx.salesDocumentCounter.upsert({
    where: { organizationId_docType: { organizationId, docType } },
    update: {},
    create: { organizationId, docType, value: 0 },
  });
  const counter = await tx.salesDocumentCounter.update({
    where: { organizationId_docType: { organizationId, docType } },
    data: { value: { increment: 1 } },
  });

  const sequence = String(counter.value).padStart(6, "0");
  return `${prefix}-${year}-${sequence}`;
}
