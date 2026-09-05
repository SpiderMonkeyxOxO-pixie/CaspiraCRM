// In-memory mock Marketing "database" — same pattern as the other mock*Data files.
// Segment membership and campaign attribution are computed live against the
// real CRM company/contact/lead records rather than duplicated data.
import { faker } from "@faker-js/faker";
import { companies, contacts, leads, createLeadRecord } from "./mockCrmData";

const id = () => faker.database.mongodbObjectId();

function makeCampaign(overrides = {}) {
  const startDate = faker.date.recent({ days: 30 });
  return {
    _id: id(),
    name: faker.company.catchPhrase(),
    channel: faker.helpers.arrayElement(["Email", "Social", "Search", "Event", "Referral"]),
    status: faker.helpers.arrayElement(["Draft", "Active", "Paused", "Completed"]),
    startDate: startDate.toISOString(),
    endDate: faker.date.soon({ days: 30, refDate: startDate }).toISOString(),
    budget: faker.number.int({ min: 1000, max: 20000 }),
    goal: faker.number.int({ min: 20, max: 200 }),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

export const campaigns = faker.helpers.multiple(() => makeCampaign(), { count: 5 });

// Attribute a handful of existing leads to campaigns so attribution/reporting
// has something real to show without needing every lead to have one.
leads.slice(0, 8).forEach((lead, i) => {
  lead.campaignId = campaigns[i % campaigns.length]._id;
});

export function findCampaign(campaignId) {
  return campaigns.find((c) => c._id === campaignId);
}

export function createCampaignRecord(payload) {
  const campaign = makeCampaign({ ...payload, status: "Draft" });
  campaigns.unshift(campaign);
  return campaign;
}

export function updateCampaignRecord(campaignId, changes) {
  const campaign = findCampaign(campaignId);
  if (!campaign) return null;
  Object.assign(campaign, changes);
  return campaign;
}

export function campaignStats(campaignId) {
  const campaignLeads = leads.filter((l) => l.campaignId === campaignId);
  return {
    leadsGenerated: campaignLeads.length,
    converted: campaignLeads.filter((l) => l.status === "Converted").length,
  };
}

// ---- Segments ----
// A segment is a saved filter over companies; membership (contacts) is
// computed live so it never goes stale relative to real CRM data.
export const segments = [];

function computeSegmentContacts(field, value) {
  const matchingCompanyIds = companies.filter((c) => c[field] === value).map((c) => c._id);
  return contacts.filter((c) => matchingCompanyIds.includes(c.companyId));
}

export function createSegmentRecord({ name, field, value }) {
  const segment = { _id: id(), name, field, value, createdAt: new Date().toISOString() };
  segments.unshift(segment);
  return segment;
}

export function deleteSegmentRecord(segmentId) {
  const idx = segments.findIndex((s) => s._id === segmentId);
  if (idx === -1) return false;
  segments.splice(idx, 1);
  return true;
}

export function segmentsWithCounts() {
  return segments.map((s) => ({ ...s, memberCount: computeSegmentContacts(s.field, s.value).length }));
}

export function segmentMembers(segmentId) {
  const segment = segments.find((s) => s._id === segmentId);
  if (!segment) return [];
  return computeSegmentContacts(segment.field, segment.value);
}

// ---- Forms ----
export const forms = [
  { _id: id(), name: "Website Contact Form", fields: ["name", "email", "company"], submissions: 0, campaignId: campaigns[0]._id, createdAt: new Date().toISOString() },
  { _id: id(), name: "Demo Request Form", fields: ["name", "email", "company", "phone"], submissions: 0, campaignId: campaigns[1]._id, createdAt: new Date().toISOString() },
];

export function findForm(formId) {
  return forms.find((f) => f._id === formId);
}

export function createFormRecord(payload) {
  const form = { _id: id(), submissions: 0, createdAt: new Date().toISOString(), ...payload };
  forms.unshift(form);
  return form;
}

export function submitFormLeadRecord(formId, leadData) {
  const form = findForm(formId);
  if (!form) return null;
  const lead = createLeadRecord({
    ...leadData,
    source: "Website",
    campaignId: form.campaignId,
    status: "New",
  });
  form.submissions = (form.submissions || 0) + 1;
  return { form, lead };
}

// ---- Templates ----
export const templates = [
  { _id: id(), name: "Welcome Email", subject: "Welcome to the team!", body: "Hi {{name}}, thanks for your interest...", createdAt: new Date().toISOString() },
];

export function createTemplateRecord(payload) {
  const template = { _id: id(), createdAt: new Date().toISOString(), ...payload };
  templates.unshift(template);
  return template;
}
