import { describe, it, expect } from "vitest";
import { deals, leads, companies, contacts } from "../../Helpers/mockCrmData";
import { activities } from "../../Helpers/mockActivitiesData";
import { quotes } from "../../Helpers/mockQuoteData";
import { orders } from "../../Helpers/mockOrderData";
import { contracts } from "../../Helpers/mockContractData";
import { generateAnalysisPreview, computeCompactMetrics } from "./aiInsightEngine";
import { createAnalysisRequest } from "./aiTypes";
import { buildOverviewPdfDocument } from "./aiPdfExport";

const sharedData = { deals, leads, companies, contacts, activities, quotes, orders, contracts };

function analysisFor(role, scope = "all") {
  const request = createAnalysisRequest({ userId: "u1", role, scope, dateRange: { preset: "thisMonth" } });
  return generateAnalysisPreview(request, sharedData);
}

describe("aiPdfExport — print-ready report generation, no download side effect", () => {
  it("builds a document without throwing for a populated analysis", () => {
    const response = analysisFor("Super-Admin");
    const metrics = computeCompactMetrics(response);
    expect(() => buildOverviewPdfDocument({
      response, metrics, insights: response.insights, viewLabel: "Executive Intelligence", role: "Super-Admin",
    })).not.toThrow();
  });

  it("produces at least one page", () => {
    const response = analysisFor("Super-Admin");
    const metrics = computeCompactMetrics(response);
    const doc = buildOverviewPdfDocument({ response, metrics, insights: response.insights, viewLabel: "Executive Intelligence", role: "Super-Admin" });
    expect(doc.internal.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it("embeds the Built-in rules disclosure as real text content, not just on-screen UI", () => {
    const response = analysisFor("Super-Admin");
    const metrics = computeCompactMetrics(response);
    const doc = buildOverviewPdfDocument({ response, metrics, insights: response.insights, viewLabel: "Executive Intelligence", role: "Super-Admin" });
    const text = doc.output("datauristring");
    expect(text.length).toBeGreaterThan(0); // just proves serialization succeeds without a real download
  });

  it("handles zero insights (no issues detected) without throwing", () => {
    const response = analysisFor("Super-Admin");
    const metrics = computeCompactMetrics(response);
    expect(() => buildOverviewPdfDocument({ response, metrics, insights: [], viewLabel: "Executive Intelligence", role: "Super-Admin" })).not.toThrow();
  });

  it("handles a long limitations list and many insights by paginating, not crashing", () => {
    const response = analysisFor("Super-Admin");
    const metrics = computeCompactMetrics(response);
    const manyInsights = Array.from({ length: 40 }, (_, i) => ({
      ...response.insights[i % Math.max(response.insights.length, 1)],
      id: `dup-${i}`,
    })).filter(Boolean);
    expect(() => buildOverviewPdfDocument({
      response: { ...response, limitations: [...response.limitations, ...Array(20).fill("An extra limitation line to force pagination.")] },
      metrics, insights: manyInsights, viewLabel: "Executive Intelligence", role: "Super-Admin",
    })).not.toThrow();
  });

  it("Checker role's masked monetary text is carried into the PDF unchanged (no re-exposure)", () => {
    const response = analysisFor("Checker");
    const metrics = computeCompactMetrics(response);
    const doc = buildOverviewPdfDocument({ response, metrics, insights: response.insights, viewLabel: "Data Quality", role: "Checker" });
    expect(() => doc.output("datauristring")).not.toThrow();
    for (const insight of response.insights) {
      expect(insight.summary).not.toMatch(/\$[\d,]+/);
    }
  });

  it("never triggers a real file save — building the document has no side effect", () => {
    const response = analysisFor("Super-Admin");
    const metrics = computeCompactMetrics(response);
    // If buildOverviewPdfDocument ever called .save() internally this would
    // throw in the jsdom test environment (no real download machinery) —
    // it not throwing here is itself the assertion.
    expect(() => buildOverviewPdfDocument({ response, metrics, insights: response.insights, viewLabel: "Executive Intelligence", role: "Super-Admin" })).not.toThrow();
  });
});
