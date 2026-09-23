// Idempotent Sales fixture import for LOCAL DEVELOPMENT ONLY — never run in
// production. Mirrors the *shape* of the frontend's curated Sales fixtures
// (mockCatalogData.js's CURATED_ITEMS, mockPriceBookData.js's
// CURATED_PRICE_BOOKS, mockQuoteData.js's CURATED_QUOTES) as a small,
// explicitly-labeled, hand-curated dataset — a direct Node import of the
// frontend modules was attempted first and rejected: those files use
// Vite-only extensionless relative imports (`./mockUsersData`, no `.js`),
// which plain Node's ESM loader does not resolve
// (`ERR_MODULE_NOT_FOUND` when run outside Vite). This mirrors Phase 2's
// seedCrmFixtures.js precedent (a hand-curated dataset matching field
// shapes) rather than porting a frontend fixture-generating function.
//
// Usage: SALES_FIXTURE_ORG_ID=<real org id> node prisma/seedSalesFixtures.js
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { nextDocumentNumber } from "../src/services/sales/documentNumberService.js";
import { computeLineTotals, computeDocumentTotals } from "../src/services/sales/moneyService.js";

// Same 30s transaction limit as the app (src/lib/prisma.js) — document
// creation spans several queries and the dev database may be remote.
const prisma = new PrismaClient({ transactionOptions: { timeout: 30000, maxWait: 10000 } });

const FIXTURE_CATALOG_ITEMS = [
  { name: "Platform Subscription", sku: "PLAT-SUB", type: "Product", category: "Software", standardPrice: 499, currency: "USD", costPreview: 150, billingModel: "Recurring", billingInterval: "Monthly" },
  { name: "Onboarding Service", sku: "ONBOARD-SVC", type: "Service", category: "Professional Services", standardPrice: 2500, currency: "USD", costPreview: 900, billingModel: "One Time" },
];

const FIXTURE_PRICE_BOOK = { name: "Standard Price Book", code: "STANDARD", currency: "USD", priority: 10 };

async function findOrCreateCatalogItem(organizationId, membershipId, fixture) {
  const existing = await prisma.catalogItem.findFirst({ where: { organizationId, sku: fixture.sku } });
  if (existing) return existing;
  return prisma.catalogItem.create({
    data: { organizationId, name: fixture.name, sku: fixture.sku, type: fixture.type, category: fixture.category, standardPrice: fixture.standardPrice, currency: fixture.currency, costPreview: fixture.costPreview, billingModel: fixture.billingModel, billingInterval: fixture.billingInterval, status: "Active", ownerMembershipId: membershipId, createdByMembershipId: membershipId, updatedByMembershipId: membershipId },
  });
}

async function findOrCreatePriceBook(organizationId, membershipId) {
  const existing = await prisma.priceBook.findFirst({ where: { organizationId, code: FIXTURE_PRICE_BOOK.code } });
  if (existing) return existing;
  return prisma.priceBook.create({
    data: { organizationId, name: FIXTURE_PRICE_BOOK.name, code: FIXTURE_PRICE_BOOK.code, currency: FIXTURE_PRICE_BOOK.currency, priority: FIXTURE_PRICE_BOOK.priority, status: "Active", ownerMembershipId: membershipId, createdByMembershipId: membershipId, updatedByMembershipId: membershipId },
  });
}

async function findOrCreateDeal(organizationId, membershipId, catalogItems, pipelineId, pipelineStageId) {
  const dealName = "Fixture Deal — Platform Rollout";
  const existing = await prisma.deal.findFirst({ where: { organizationId, name: dealName } });
  if (existing) return existing;

  return prisma.$transaction(async (tx) => {
    const dealNumber = await nextDocumentNumber(tx, organizationId, "Deal");
    const deal = await tx.deal.create({
      data: { organizationId, dealNumber, name: dealName, stage: "Discovery", status: "Open", pipelineId, pipelineStageId, currency: "USD", value: 12000, probability: 10, ownerMembershipId: membershipId, createdByMembershipId: membershipId, updatedByMembershipId: membershipId },
    });
    await tx.dealLineItem.create({ data: { dealId: deal.id, catalogItemId: catalogItems[0].id, quantity: 12, unitPrice: catalogItems[0].standardPrice, nameSnapshot: catalogItems[0].name, skuSnapshot: catalogItems[0].sku, taxCategory: "Standard" } });
    return deal;
  });
}

async function findOrCreateQuote(organizationId, membershipId, deal, catalogItems, priceBook) {
  const existing = await prisma.quote.findFirst({ where: { organizationId, dealId: deal.id } });
  if (existing) return existing;

  return prisma.$transaction(async (tx) => {
    const quoteNumber = await nextDocumentNumber(tx, organizationId, "Quote");
    const lineFixtures = [
      { catalogItemId: catalogItems[0].id, name: catalogItems[0].name, quantity: 12, unitPrice: catalogItems[0].standardPrice, taxCategory: "Standard" },
      { catalogItemId: catalogItems[1].id, name: catalogItems[1].name, quantity: 1, unitPrice: catalogItems[1].standardPrice, taxCategory: "Standard" },
    ];
    const lineResults = lineFixtures.map((l) => computeLineTotals({ quantity: l.quantity, unitPrice: l.unitPrice, taxCategory: l.taxCategory, currency: "USD" }));
    const totals = computeDocumentTotals(lineResults, { currency: "USD" });

    const quote = await tx.quote.create({
      data: {
        organizationId, quoteNumber, version: 1, title: "Fixture Quote — Platform Rollout", status: "Draft", currency: "USD",
        dealId: deal.id, priceBookId: priceBook.id, ownerMembershipId: membershipId, createdByMembershipId: membershipId, updatedByMembershipId: membershipId,
        lineItems: { create: lineFixtures.map((l, i) => ({ catalogItemId: l.catalogItemId, name: l.name, quantity: l.quantity, listPrice: l.unitPrice, unitPrice: l.unitPrice, taxCategory: l.taxCategory, order: i, lineSubtotal: lineResults[i].lineSubtotal, taxAmount: lineResults[i].taxAmount, lineTotal: lineResults[i].lineTotal })) },
      },
    });
    return tx.quote.update({ where: { id: quote.id }, data: totals });
  });
}

async function main() {
  const organizationId = process.env.SALES_FIXTURE_ORG_ID;
  if (!organizationId) { console.error("SALES_FIXTURE_ORG_ID is required — this script never guesses which organization to seed."); process.exit(1); }
  if (process.env.NODE_ENV === "production") { console.error("Refusing to run fixture import with NODE_ENV=production."); process.exit(1); }

  const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!organization) { console.error(`No organization found with id ${organizationId}.`); process.exit(1); }

  const membership = await prisma.organizationMembership.findFirst({ where: { organizationId, status: "Active" }, orderBy: { createdAt: "asc" } });
  if (!membership) { console.error(`Organization ${organizationId} has no active membership to own the fixture records.`); process.exit(1); }

  const pipeline = await prisma.pipeline.findFirst({ where: { organizationId, isDefault: true, archivedAt: null } });
  if (!pipeline) { console.error(`Organization ${organizationId} has no default Pipeline yet — visit the Pipelines or Deals list once first to trigger lazy seeding, then rerun this script.`); process.exit(1); }
  const firstStage = await prisma.pipelineStage.findFirst({ where: { pipelineId: pipeline.id, classification: "Open" }, orderBy: { displayOrder: "asc" } });

  console.log(`Importing Sales fixtures into "${organization.name}" (${organizationId}), owned by membership ${membership.id}...`);

  const catalogItems = [];
  for (const fixture of FIXTURE_CATALOG_ITEMS) {
    if (!["USD", "EUR", "GBP", "INR", "IDR"].includes(fixture.currency)) { console.error(`Skipping "${fixture.name}" — invalid currency "${fixture.currency}".`); continue; }
    catalogItems.push(await findOrCreateCatalogItem(organizationId, membership.id, fixture));
  }
  const priceBook = await findOrCreatePriceBook(organizationId, membership.id);
  const deal = await findOrCreateDeal(organizationId, membership.id, catalogItems, pipeline.id, firstStage?.id);
  const quote = await findOrCreateQuote(organizationId, membership.id, deal, catalogItems, priceBook);

  // Recalculate and compare: the fixture's own hand-computed expectation
  // vs. the server's actual computeDocumentTotals() result, reported as a
  // mismatch rather than silently trusted — this is exactly the kind of
  // drift-detection the spec asks for ("recalculate and compare totals,
  // report fixture calculation mismatches").
  const expectedSubtotal = 12 * 499 + 1 * 2500;
  if (Number(quote.subtotal) !== expectedSubtotal) {
    console.warn(`Fixture calculation mismatch: expected subtotal ${expectedSubtotal}, server computed ${quote.subtotal}.`);
  } else {
    console.log(`Fixture totals verified: subtotal ${quote.subtotal}, grandTotal ${quote.grandTotal}.`);
  }

  console.log(`Done. ${catalogItems.length} catalog items, 1 price book, 1 deal, 1 quote checked/imported (idempotent — rerun freely).`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
