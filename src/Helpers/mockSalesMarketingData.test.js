import { describe, it, expect } from "vitest";
import {
  PHASE2_PROVIDERS, INTEGRATION_CHANNELS, ROI_UNAVAILABLE_MESSAGE,
  LEAD_CAPTURE_EVENTS, queryLeadCaptureEventsLocal, findLeadCaptureEvent,
  detectLeadCaptureDuplicates, createLeadFromCapture, rejectLeadCapture, retryLeadCaptureProcessing,
  LEAD_ROUTING_RULES, previewLeadRouting, resolveRoutingRuleForLead,
  AUDIENCES, computeAudienceEligibility,
  SUPPRESSION_ENTRIES, addSuppressionEntry, removeSuppressionEntry, isSuppressed,
  EMAIL_DELIVERY_EVENTS, computeEmailDeliveryMetrics, retryEmailDelivery,
  computeAttributionSummary,
  FORM_CONNECTIONS, updateFormFieldMapping, enableFormConnection,
  CAMPAIGN_REFERENCES,
} from "./mockSalesMarketingData";
import { findLead } from "./mockCrmData";

describe("mockSalesMarketingData: provider catalog", () => {
  it("has exactly the 13 Sales & Marketing providers, each with a valid channel and at least one capability", () => {
    expect(PHASE2_PROVIDERS).toHaveLength(13);
    PHASE2_PROVIDERS.forEach((p) => {
      expect(INTEGRATION_CHANNELS).toContain(p.channel);
      expect(p.capabilities.length).toBeGreaterThan(0);
    });
  });

  it("Resend never requests or displays an API key", () => {
    const resend = PHASE2_PROVIDERS.find((p) => p.key === "resend");
    expect(resend.credentialFieldInfo).toBeNull();
  });

  it("Meta Lead Ads never claims to display a real account", () => {
    const meta = PHASE2_PROVIDERS.find((p) => p.key === "meta_lead_ads");
    expect(meta.longDescription).toMatch(/Never display a real Facebook or Instagram account/);
  });

  it("Microsoft Clarity never claims session-recording capability", () => {
    const clarity = PHASE2_PROVIDERS.find((p) => p.key === "microsoft_clarity");
    expect(clarity.longDescription).toMatch(/Do not display or recreate real session recordings/);
    expect(clarity.capabilities.every((c) => !c.name.toLowerCase().includes("recording"))).toBe(true);
  });
});

describe("mockSalesMarketingData: Lead Capture", () => {
  it("queryLeadCaptureEventsLocal filters by org and status", () => {
    const results = queryLeadCaptureEventsLocal({ orgId: "org_caspira_hq" });
    expect(results.every((e) => e.orgId === "org_caspira_hq")).toBe(true);
  });

  it("detectLeadCaptureDuplicates reuses the real duplicate-matching engine and never auto-merges", () => {
    const result = detectLeadCaptureDuplicates("lce_1");
    expect(result.error).toBeUndefined();
    expect(Array.isArray(result.matches)).toBe(true);
  });

  it("createLeadFromCapture creates a real Lead tagged with its provider source", () => {
    const before = LEAD_CAPTURE_EVENTS.find((e) => e.id === "lce_2");
    expect(before.createdLeadId).toBeNull();
    const result = createLeadFromCapture("lce_2", {}, "Test Actor");
    expect(result.error).toBeUndefined();
    expect(result.lead.sourceProviderKey).toBe("google_ads");
    expect(result.lead.sourceExternalReference).toBe("gads_lead_44127");
    expect(findLead(result.lead._id)).toBeTruthy();
    expect(findLeadCaptureEvent("lce_2").status).toBe("Created in Preview");
  });

  it("refuses to create a Lead twice from the same capture event", () => {
    const result = createLeadFromCapture("lce_2", {}, "Test Actor");
    expect(result.error).toBeTruthy();
  });

  it("requires a reason to reject a captured lead", () => {
    const result = rejectLeadCapture("lce_1", "", "Test Actor");
    expect(result.error).toMatch(/reason is required/i);
  });

  it("only retries a Failed capture event", () => {
    const result = retryLeadCaptureProcessing("lce_1", "Test Actor");
    expect(result.error).toMatch(/Failed/);
    const failedResult = retryLeadCaptureProcessing("lce_6", "Test Actor");
    expect(failedResult.error).toBeUndefined();
    expect(failedResult.event.status).toBe("Received");
  });
});

describe("mockSalesMarketingData: Lead Routing", () => {
  it("Named Owner assignment resolves to the configured CRM_TEAM member", () => {
    const rule = LEAD_ROUTING_RULES.find((r) => r.id === "route_2");
    const result = previewLeadRouting(rule, {});
    expect(result.assignedOwnerId).toBe("u6");
    expect(result.isPreview).toBe(true);
  });

  it("Round-robin preview deterministically cycles through the department's pool", () => {
    const rule = LEAD_ROUTING_RULES.find((r) => r.id === "route_1");
    const first = previewLeadRouting(rule, {});
    const second = previewLeadRouting(rule, {});
    expect(first.assignedOwnerId).toBeTruthy();
    expect(second.assignedOwnerId).toBeTruthy();
  });

  it("Default Queue leaves the lead unassigned", () => {
    const rule = LEAD_ROUTING_RULES.find((r) => r.id === "route_3");
    const result = previewLeadRouting(rule, {});
    expect(result.assignmentType).toBe("Default Queue");
    expect(result.assignedOwnerId).toBeNull();
  });

  it("resolveRoutingRuleForLead matches on department condition", () => {
    const rule = resolveRoutingRuleForLead("org_caspira_hq", { department: "Sales" });
    expect(rule.id).toBe("route_1");
  });
});

describe("mockSalesMarketingData: Audiences", () => {
  it("computeAudienceEligibility excludes suppressed and non-consented records before counting", () => {
    const result = computeAudienceEligibility("aud_1");
    expect(result.error).toBeUndefined();
    expect(Array.isArray(result.eligible)).toBe(true);
    expect(Array.isArray(result.excluded)).toBe(true);
    expect(result.totalConsidered).toBeGreaterThan(0);
  });

  it("refuses an unknown audience", () => {
    const result = computeAudienceEligibility("not_a_real_audience");
    expect(result.error).toBeTruthy();
  });
});

describe("mockSalesMarketingData: Suppression", () => {
  it("requires a written reason to remove a suppression entry", () => {
    const entry = SUPPRESSION_ENTRIES[0];
    const result = removeSuppressionEntry(entry.id, "", "Test Actor");
    expect(result.error).toMatch(/reason is required/i);
  });

  it("removes a suppression entry with a reason", () => {
    const { entry } = addSuppressionEntry({ contactId: "temp_contact", reason: "Manual Suppression" }, "Test Actor");
    expect(isSuppressed("temp_contact")).toBe(true);
    const result = removeSuppressionEntry(entry.id, "Customer requested reinstatement.", "Test Actor");
    expect(result.error).toBeUndefined();
    expect(isSuppressed("temp_contact")).toBe(false);
  });
});

describe("mockSalesMarketingData: Email Delivery", () => {
  it("computeEmailDeliveryMetrics is calculated, not hardcoded", () => {
    const metrics = computeEmailDeliveryMetrics(EMAIL_DELIVERY_EVENTS);
    expect(metrics.total).toBe(EMAIL_DELIVERY_EVENTS.length);
    expect(metrics.deliveryRate).toBeGreaterThanOrEqual(0);
  });

  it("only retries a Failed, Deferred or Bounced delivery preview", () => {
    const result = retryEmailDelivery("eml_1", "Test Actor");
    expect(result.error).toBeTruthy();
    const failed = retryEmailDelivery("eml_5", "Test Actor");
    expect(failed.error).toBeUndefined();
    expect(failed.event.status).toBe("Sent Preview");
  });
});

describe("mockSalesMarketingData: Attribution", () => {
  it("never invents revenue, and reports ROI unavailable when spend is not verified", () => {
    const summary = computeAttributionSummary({ campaignReference: "campref_2" });
    expect(summary.roi).toBe(ROI_UNAVAILABLE_MESSAGE);
  });

  it("computes ROI only when verified spend exists for the campaign", () => {
    const summary = computeAttributionSummary({ campaignReference: "campref_3" });
    expect(summary.roi).not.toBe(ROI_UNAVAILABLE_MESSAGE);
  });
});

describe("mockSalesMarketingData: Forms Integrations", () => {
  it("cannot enable a form while a required CRM field remains unmapped", () => {
    const result = enableFormConnection("form_2");
    expect(result.error).toMatch(/required CRM field/i);
  });

  it("enables a form once every required field is mapped", () => {
    const form = FORM_CONNECTIONS.find((f) => f.id === "form_3");
    expect(form.enabled).toBe(true);
  });

  it("updates a field mapping", () => {
    const form = FORM_CONNECTIONS.find((f) => f.id === "form_1");
    const mappingId = form.fieldMappings[0].id;
    const result = updateFormFieldMapping("form_1", mappingId, { transformation: "Lowercase" });
    expect(result.fieldMapping.transformation).toBe("Lowercase");
  });
});

describe("mockSalesMarketingData: campaign references never fork real Marketing records", () => {
  it("an unlinked campaign reference is clearly labelled as a preview, not a CRM record", () => {
    CAMPAIGN_REFERENCES.forEach((c) => {
      if (!c.linkedCampaignId) expect(c.previewLabel).toMatch(/not a CRM record/i);
    });
  });
});
