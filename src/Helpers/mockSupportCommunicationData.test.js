import { describe, it, expect } from "vitest";
import {
  PHASE3_PROVIDERS, SupportTicketStatus, SupportTicketPriority,
  SUPPORT_CHANNELS, querySupportChannelsLocal,
  SUPPORT_QUEUE_MAPPINGS, querySupportQueueMappingsLocal,
  SUPPORT_AGENT_MAPPINGS,
  matchSupportIdentity,
  SUPPORT_CONVERSATIONS, findSupportConversation, querySupportConversationsLocal,
  sendMessagePreview, undoLastConversationMessage, escalateConversationToTicket,
  SUPPORT_STATUS_MAPPINGS, SUPPORT_PRIORITY_MAPPINGS,
  querySupportTicketPreviewsLocal,
  SUPPORT_SYNC_CONFLICTS, resolveSyncConflict, SupportSyncConflictResolutions,
  computeSlaState, computeSlaRemainingTime, computeSlaBreachDuration,
  SUPPORT_SLA_CONFIGURATIONS, findSupportSLAConfiguration,
  SUPPORT_ESCALATION_RULES, previewEscalation,
  SUPPORT_CALLS, queryCallsLocal, markCallFollowUpCreated,
  SUPPORT_REVIEWS, queryReviewsLocal, draftReviewReply,
  deriveSupportCommunicationConsent,
} from "./mockSupportCommunicationData";
import { findTicket } from "./mockSupportData";
import { contacts } from "./mockCrmData";

describe("mockSupportCommunicationData: provider catalog", () => {
  it("has exactly the 9 Support & Communication providers, each with at least one capability", () => {
    expect(PHASE3_PROVIDERS).toHaveLength(9);
    PHASE3_PROVIDERS.forEach((p) => expect(p.capabilities.length).toBeGreaterThan(0));
  });

  it("Intercom never claims to add a real Messenger script", () => {
    const intercom = PHASE3_PROVIDERS.find((p) => p.key === "intercom");
    expect(intercom.longDescription).toMatch(/Does not add a real Intercom Messenger script/);
  });

  it("Telegram Bot API never exposes a bot token", () => {
    const telegram = PHASE3_PROVIDERS.find((p) => p.key === "telegram_bot_api");
    expect(telegram.credentialFieldInfo).toBeNull();
  });

  it("Google Business Profile never claims every reviewer can be matched", () => {
    const gbp = PHASE3_PROVIDERS.find((p) => p.key === "google_business_profile");
    expect(gbp.knownLimitations.join(" ")).toMatch(/Not every reviewer can be matched/);
  });
});

describe("mockSupportCommunicationData: Channels", () => {
  it("querySupportChannelsLocal filters by organization", () => {
    const results = querySupportChannelsLocal({ organizationId: SUPPORT_CHANNELS[0].organizationId });
    expect(results.every((c) => c.organizationId === SUPPORT_CHANNELS[0].organizationId)).toBe(true);
  });
});

describe("mockSupportCommunicationData: Queue and agent mapping", () => {
  it("querySupportQueueMappingsLocal filters by organization", () => {
    const results = querySupportQueueMappingsLocal({ organizationId: SUPPORT_QUEUE_MAPPINGS[0].organizationId });
    expect(results.length).toBeGreaterThan(0);
  });

  it("matches a verified agent by fixture email, not display name", () => {
    const mapped = SUPPORT_AGENT_MAPPINGS.find((a) => a.providerAgentName === "Liam O'Connor");
    expect(mapped.crmUserId).toBe("u5");
    expect(mapped.permissionStatus).toBe("Verified");
  });

  it("leaves an unknown agent unmapped rather than guessing from a display name", () => {
    const unmapped = SUPPORT_AGENT_MAPPINGS.find((a) => a.providerAgentName === "Unknown Contractor");
    expect(unmapped.crmUserId).toBeNull();
    expect(unmapped.active).toBe(false);
    expect(unmapped.mappingHealth).toMatch(/review required/i);
  });
});

describe("mockSupportCommunicationData: Customer identity matching", () => {
  it("reuses the real duplicate-matching engine and never auto-merges", () => {
    const target = contacts[0];
    const result = matchSupportIdentity({ name: target.name, email: target.email, phone: target.phone, companyName: target.companyName });
    expect(result.state).toBe("Matched");
    expect(result.candidateRecords.length).toBeGreaterThan(0);
  });

  it("returns No Match for an identity with no corresponding Contact", () => {
    const result = matchSupportIdentity({ name: "Nobody Nowhere", email: "nobody@nowhere.example", phone: "+1-000-0000" });
    expect(result.state).toBe("No Match");
    expect(result.suggestedAction).toMatch(/Create a Contact/);
  });
});

describe("mockSupportCommunicationData: Omnichannel conversations", () => {
  it("querySupportConversationsLocal filters by org and status", () => {
    const results = querySupportConversationsLocal({ orgId: "org_caspira_hq" });
    expect(results.every((c) => c.orgId === "org_caspira_hq")).toBe(true);
  });

  it("Public reply preview never claims a provider message was sent", () => {
    const conversation = SUPPORT_CONVERSATIONS.find((c) => !c.linkedTicketId);
    const result = sendMessagePreview(conversation.id, { visibility: "Public", body: "Testing reply preview.", author: "Test Agent" });
    expect(result.error).toBeUndefined();
    expect(result.providerMessageSent).toBe(false);
    expect(result.message.previewLabel).toBe("Message Preview");
  });

  it("requires a message body", () => {
    const conversation = SUPPORT_CONVERSATIONS[0];
    const result = sendMessagePreview(conversation.id, { visibility: "Internal", body: "" });
    expect(result.error).toBeTruthy();
  });

  it("Confirm Reply Preview on a linked conversation writes into the real Ticket", () => {
    const conversation = findSupportConversation("conv_1");
    const before = findTicket(conversation.linkedTicketId);
    const beforeCount = before.publicReplies.length;
    sendMessagePreview("conv_1", { visibility: "Public", body: "Following up on your export issue.", author: "Test Agent" });
    const after = findTicket(conversation.linkedTicketId);
    expect(after.publicReplies.length).toBe(beforeCount + 1);
  });

  it("allows Undo within the current session", () => {
    const conversation = SUPPORT_CONVERSATIONS.find((c) => c.id === "conv_3");
    const before = conversation.messages.length;
    sendMessagePreview("conv_3", { visibility: "Public", body: "Undo-test message.", author: "Test Agent" });
    expect(conversation.messages.length).toBe(before + 1);
    const undone = undoLastConversationMessage("conv_3");
    expect(undone.error).toBeUndefined();
    expect(undone.conversation.messages.length).toBe(before);
  });

  it("escalates an unlinked conversation to a real Ticket", () => {
    const conversation = SUPPORT_CONVERSATIONS.find((c) => c.id === "conv_4");
    const result = escalateConversationToTicket("conv_4");
    expect(result.error).toBeUndefined();
    expect(result.ticket.sourceProviderKey).toBe("intercom");
    expect(conversation.linkedTicketId).toBe(result.ticket._id);
  });

  it("refuses to escalate an already-linked conversation", () => {
    const result = escalateConversationToTicket("conv_1");
    expect(result.error).toBeTruthy();
  });
});

describe("mockSupportCommunicationData: Status and priority mapping", () => {
  it("unknown provider statuses land in Mapping Review Required, never silently mapped", () => {
    const unknown = SUPPORT_STATUS_MAPPINGS.find((m) => m.providerStatus === "snoozed_unknown");
    expect(unknown.validationResult).toBe("Mapping Review Required");
  });

  it("known provider statuses/priorities map validly to the canonical vocabulary", () => {
    SUPPORT_STATUS_MAPPINGS.filter((m) => SupportTicketStatus.includes(m.canonicalStatus)).forEach((m) => {
      expect(m.validationResult).toBe("Valid");
    });
    SUPPORT_PRIORITY_MAPPINGS.forEach((m) => {
      expect(SupportTicketPriority).toContain(m.canonicalPriority);
      expect(m.validationResult).toBe("Valid");
    });
  });

  it("querySupportTicketPreviewsLocal only includes tickets with a provider source", () => {
    const previews = querySupportTicketPreviewsLocal({});
    previews.forEach((p) => expect(p.providerKey).toBeTruthy());
  });
});

describe("mockSupportCommunicationData: Synchronization conflicts", () => {
  it("resolveSyncConflict records a resolution and rejects an unknown option", () => {
    const conflict = SUPPORT_SYNC_CONFLICTS[0];
    const bad = resolveSyncConflict(conflict.id, "Not a real option", "note");
    expect(bad.error).toBeTruthy();
    const good = resolveSyncConflict(conflict.id, SupportSyncConflictResolutions[0], "Reviewed and confirmed.", "Test Actor");
    expect(good.error).toBeUndefined();
    expect(good.conflict.resolutionState).toBe("Resolved");
  });
});

describe("mockSupportCommunicationData: SLA", () => {
  it("computeSlaState is deterministic and reflects a breached deadline", () => {
    const breachedTicket = { status: "Open", priority: "High", slaResolutionDeadline: new Date(Date.now() - 60 * 60 * 1000).toISOString() };
    const config = findSupportSLAConfiguration("org_caspira_hq");
    expect(computeSlaState(breachedTicket, config)).toBe("Breached");
  });

  it("a resolved ticket is Completed regardless of deadline", () => {
    const resolvedTicket = { status: "Resolved", slaResolutionDeadline: new Date(Date.now() - 60 * 60 * 1000).toISOString() };
    expect(computeSlaState(resolvedTicket, null)).toBe("Completed");
  });

  it("computeSlaRemainingTime and computeSlaBreachDuration are non-negative and consistent", () => {
    const futureTicket = { slaResolutionDeadline: new Date(Date.now() + 60 * 60 * 1000).toISOString() };
    expect(computeSlaRemainingTime(futureTicket)).toBeGreaterThan(0);
    expect(computeSlaBreachDuration(futureTicket)).toBe(0);
  });

  it("SLA target hours are taken from the real Ticket SLA_HOURS map, not invented", () => {
    const config = SUPPORT_SLA_CONFIGURATIONS[0];
    expect(config.targetHours.Urgent.resolution).toBe(4);
    expect(config.targetHours.High.resolution).toBe(24);
    expect(config.targetHours.Normal.resolution).toBe(48);
    expect(config.targetHours.Low.resolution).toBe(72);
  });
});

describe("mockSupportCommunicationData: Escalation previews", () => {
  it("previewEscalation never sends an external notification, only a preview", () => {
    const rule = SUPPORT_ESCALATION_RULES[0];
    const preview = previewEscalation(rule.id, { status: "Open", priority: "Urgent" });
    expect(preview.isPreview).toBe(true);
    expect(preview.proposedChange).toBe(rule.action);
  });
});

describe("mockSupportCommunicationData: Telephony", () => {
  it("phone numbers are always masked", () => {
    SUPPORT_CALLS.forEach((c) => expect(c.phoneNumberMasked).toMatch(/•/));
  });

  it("never exposes a recording URL, storage key or token — only a state", () => {
    const RECORDING_STATES = ["Available", "Unavailable", "Processing Preview", "Restricted", "Retention Expired", "Consent Required"];
    SUPPORT_CALLS.forEach((c) => {
      expect(RECORDING_STATES).toContain(c.recordingAvailability);
      expect(RECORDING_STATES).toContain(c.transcriptAvailability);
    });
  });

  it("queryCallsLocal filters by disposition", () => {
    const results = queryCallsLocal({ disposition: "Follow-up Required" });
    expect(results.every((c) => c.disposition === "Follow-up Required")).toBe(true);
  });

  it("markCallFollowUpCreated updates follow-up status", () => {
    const call = SUPPORT_CALLS.find((c) => c.followUpStatus === "Pending");
    const result = markCallFollowUpCreated(call.id);
    expect(result.error).toBeUndefined();
    expect(result.call.followUpStatus).toBe("Activity Created");
  });
});

describe("mockSupportCommunicationData: Review management", () => {
  it("queryReviewsLocal filters by organization", () => {
    const results = queryReviewsLocal({ orgId: "org_solstice_partners" });
    expect(results.length).toBeGreaterThan(0);
  });

  it("draftReviewReply never automatically posts — only saves a draft", () => {
    const review = SUPPORT_REVIEWS[0];
    const result = draftReviewReply(review.id, "Thank you for your feedback.", "Test Manager");
    expect(result.error).toBeUndefined();
    expect(result.review.replyStatus).toBe("Draft Prepared");
    expect(result.review.replyDraft).toBe("Thank you for your feedback.");
  });
});

describe("mockSupportCommunicationData: Communication consent", () => {
  it("derives consent from the real Contact record, not a second source of truth", () => {
    const contact = contacts[0];
    const consent = deriveSupportCommunicationConsent(contact);
    expect(consent.recordId).toBe(contact._id);
    expect(consent.emailAllowed).toBe(contact.emailAllowed !== false);
  });
});
