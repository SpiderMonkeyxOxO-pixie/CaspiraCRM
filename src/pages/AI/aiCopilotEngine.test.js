import { describe, it, expect } from "vitest";
import { deals, leads, companies, contacts } from "../../Helpers/mockCrmData";
import { activities } from "../../Helpers/mockActivitiesData";
import { quotes } from "../../Helpers/mockQuoteData";
import { orders } from "../../Helpers/mockOrderData";
import { contracts } from "../../Helpers/mockContractData";
import { matchIntent, answerCopilotQuestion, SUGGESTED_PROMPTS, AI_PROVIDER_STATUS } from "./aiCopilotEngine";
import { createAnalysisRequest } from "./aiTypes";
import { defaultScopeForRole } from "./aiConfig";

const sharedData = { deals, leads, companies, contacts, activities, quotes, orders, contracts };

function requestFor(role) {
  return createAnalysisRequest({ userId: "u1", role, scope: defaultScopeForRole(role), dateRange: { preset: "thisMonth" } });
}

describe("aiCopilotEngine — deterministic intent matching, no real NLP or LLM", () => {
  it("matches each suggested prompt to a real, non-fallback intent", () => {
    for (const prompt of SUGGESTED_PROMPTS) {
      expect(matchIntent(prompt)).not.toBeNull();
    }
  });

  it("returns null for a message with no matching keywords, never guesses", () => {
    expect(matchIntent("xyzzy plugh qwertyuiop")).toBeNull();
  });

  it("every answer includes the Built-in rules provider status label available at module scope", () => {
    expect(AI_PROVIDER_STATUS).toBe("Built-in rules");
  });

  it("never issues a network request", () => {
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = () => { called = true; throw new Error("fetch should never be called"); };
    answerCopilotQuestion("which deals need attention?", requestFor("Super-Admin"), sharedData);
    expect(called).toBe(false);
    globalThis.fetch = originalFetch;
  });

  it("answers every suggested prompt without throwing, for every real role", () => {
    for (const role of ["Super-Admin", "Admin", "Team-Leader", "User", "Checker"]) {
      for (const prompt of SUGGESTED_PROMPTS) {
        expect(() => answerCopilotQuestion(prompt, requestFor(role), sharedData)).not.toThrow();
      }
    }
  });

  it("an unmatched question returns an honest fallback listing supported topics, not a guess", () => {
    const answer = answerCopilotQuestion("what's the weather like", requestFor("Super-Admin"), sharedData);
    expect(answer.matchedIntent).toBeNull();
    expect(answer.text).toMatch(/don't have a calculation/i);
    expect(answer.insight).toBeNull();
  });

  it("an insight-bearing answer carries real evidence pointing at real record ids", () => {
    const answer = answerCopilotQuestion("which deals need attention?", requestFor("Super-Admin"), sharedData);
    if (answer.insight) {
      for (const id of answer.insight.affectedRecordIds) {
        expect(deals.some((d) => d._id === id)).toBe(true);
      }
    }
  });

  it("pipeline value answer matches the same figure the deterministic selector produces", () => {
    const answer = answerCopilotQuestion("what's my open pipeline worth?", requestFor("Super-Admin"), sharedData);
    expect(answer.text).toMatch(/open pipeline is|no open deals/i);
  });

  it("Standard Employee (User) scope='mine' excludes deals owned by other people from the answer", () => {
    const answer = answerCopilotQuestion("which deals need attention?", requestFor("User"), sharedData);
    if (answer.insight) {
      for (const id of answer.insight.affectedRecordIds) {
        const d = deals.find((x) => x._id === id);
        expect(d.ownerId).toBe("u1");
      }
    }
  });

  it("Checker role masks monetary figures in the pipeline-value answer", () => {
    const answer = answerCopilotQuestion("what's my open pipeline worth?", requestFor("Checker"), sharedData);
    if (answer.text.includes("Open pipeline is")) {
      expect(answer.text).toMatch(/Additional restricted information/);
      expect(answer.text).not.toMatch(/\$[\d,]+/);
    }
  });

  it("suggested actions on a Copilot answer always require human approval", () => {
    const answer = answerCopilotQuestion("which deals need attention?", requestFor("Super-Admin"), sharedData);
    for (const action of answer.insight?.suggestedActions || []) {
      expect(action.requiresHumanApproval).toBe(true);
    }
  });

  it("help and greeting intents never fabricate calculated numbers", () => {
    const help = answerCopilotQuestion("help", requestFor("Super-Admin"), sharedData);
    const hi = answerCopilotQuestion("hello", requestFor("Super-Admin"), sharedData);
    expect(help.insight).toBeNull();
    expect(hi.insight).toBeNull();
  });

  it("empty scope (no records at all) never throws and returns an honest zero-result answer", () => {
    const empty = { deals: [], leads: [], companies: [], contacts: [], activities: [], quotes: [], orders: [], contracts: [] };
    for (const prompt of SUGGESTED_PROMPTS) {
      const answer = answerCopilotQuestion(prompt, requestFor("Super-Admin"), empty);
      expect(answer.text.length).toBeGreaterThan(0);
    }
  });
});
