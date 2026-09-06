import prisma from "../../lib/prisma.js";
import { resolveCrmScopeWhere } from "../../services/crm/scopeService.js";
import {
  computeOpenPipeline, computeWeightedPipeline, computePipelineStageTotals, computeWonValue,
  computeLostValue, computeWinRate, computeAvgDealSize, computeDealCountByOwner,
  computePipelineConcentrationByCompany, computeForecastBuckets,
} from "../../services/sales/calculationService.js";

// Every number here comes from a live query already filtered to the
// caller's organization AND record scope (never "query everything, then
// hide it in the response") — matching Phase 2's crmSummaryService.js
// discipline. Deleted/archived Deals are excluded by buildWhere() below.
async function loadScopedDeals(req) {
  const scopeWhere = resolveCrmScopeWhere(req, "deals", { ownerField: "ownerMembershipId" });
  return prisma.deal.findMany({ where: { organizationId: req.organizationId, archived: false, ...scopeWhere } });
}

export async function pipelineSummary(req, res) {
  const deals = await loadScopedDeals(req);
  res.json({
    openPipeline: computeOpenPipeline(deals),
    weightedPipeline: computeWeightedPipeline(deals),
    byStage: computePipelineStageTotals(deals),
    won: computeWonValue(deals, { from: req.query.from, to: req.query.to }),
    lost: computeLostValue(deals, { from: req.query.from, to: req.query.to }),
    winRate: computeWinRate(deals, { from: req.query.from, to: req.query.to }),
    avgDealSize: computeAvgDealSize(deals),
    byOwner: computeDealCountByOwner(deals),
    concentrationByCompany: computePipelineConcentrationByCompany(deals),
  });
}

// Forecast: authorized Deals only (already enforced by loadScopedDeals),
// active organization only, excludes archived and Lost Deals, never mixes
// currencies, deterministic date-bucket source — never called an "AI
// prediction" anywhere in this response.
export async function forecast(req, res) {
  const deals = await loadScopedDeals(req);
  res.json({ source: "deterministic-expected-close-date", buckets: computeForecastBuckets(deals) });
}
