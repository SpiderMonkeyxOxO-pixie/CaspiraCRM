// Backend Phase 10 — provider-neutral embeddings.
//   simulator  deterministic local hashing embedder (tests, simulator mode)
//   openai     /v1/embeddings with the organization's own OpenAI key and the
//              model named in AI_EMBEDDING_MODEL (never hard-coded)
//   disabled   semantic retrieval off; structured and keyword retrieval only
// Model and version are stored with every vector; a different model or
// version is a separate index that requires a reindex job.
import crypto from "node:crypto";
import prisma from "../../../lib/prisma.js";
import { aiMode } from "../../common/mode.js";
import { aiRequest } from "../../common/http.js";
import { AiError, CATEGORIES } from "../../common/errors.js";
import { apiKeyFor, isAiUsable } from "../../connections/connectionService.js";
import { getAiPolicy, assertProviderAllowedByPolicy } from "../../policy/policyService.js";
import { recordUsage, getPriceFor } from "../../usage/usageService.js";

export const SIM_DIMENSIONS = 256;
const STOP = new Set("the a an and or of to in on for with at by from is are was were be been it this that these those as not no your our their his her its we you they i".split(" "));

export function tokenize(text) {
  return String(text || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t));
}

// Deterministic hashing embedding (unigrams + bigrams, signed buckets), L2-normalized.
export function simulatorEmbed(text) {
  const v = new Array(SIM_DIMENSIONS).fill(0);
  const toks = tokenize(text);
  const add = (term, w) => {
    const h = crypto.createHash("sha1").update(term).digest();
    const idx = h.readUInt16BE(0) % SIM_DIMENSIONS;
    v[idx] += (h[2] & 1 ? 1 : -1) * w;
  };
  toks.forEach((t, i) => { add(t, 1); if (i > 0) add(`${toks[i - 1]} ${t}`, 0.5); });
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => Math.round((x / norm) * 1e6) / 1e6);
}

export function embeddingConfig() {
  const provider = (process.env.AI_EMBEDDING_PROVIDER || (aiMode() === "simulator" ? "simulator" : "disabled")).toLowerCase();
  if (provider === "simulator") return { provider: "simulator", model: "sim-hash-embed", version: "1", dimensions: SIM_DIMENSIONS };
  if (provider === "openai" && process.env.AI_EMBEDDING_MODEL) return { provider: "openai", model: process.env.AI_EMBEDDING_MODEL, version: process.env.AI_EMBEDDING_VERSION || "1", dimensions: null };
  return { provider: "disabled", model: null, version: null, dimensions: null };
}

export const semanticEnabled = () => embeddingConfig().provider !== "disabled";

// Embeds a batch for one organization; records usage. → number[][]
export async function embedTexts(organizationId, texts, { useCaseKey = "copilot.embedding" } = {}) {
  const cfg = embeddingConfig();
  if (cfg.provider === "disabled") throw new AiError(CATEGORIES.POLICY, "Semantic retrieval is turned off (no embedding provider is configured).");
  if (cfg.provider === "simulator") {
    const vectors = texts.map(simulatorEmbed);
    await recordUsage({ organizationId, useCaseKey, providerKey: "simulator", modelId: cfg.model, alias: null, mode: "Simulator", usage: { inputTokens: texts.reduce((s, t) => s + Math.ceil(t.length / 4), 0), outputTokens: 0, cachedTokens: 0 }, price: null, outcome: "Succeeded" });
    return vectors;
  }
  // OpenAI with the organization's own verified connection, if policy allows.
  const policy = await getAiPolicy(organizationId);
  const provider = await prisma.aiProvider.findUnique({ where: { key: "openai" } });
  assertProviderAllowedByPolicy(policy, provider);
  const connection = await prisma.aiProviderConnection.findFirst({ where: { organizationId, providerKey: "openai", mode: "Live" } });
  if (!isAiUsable(connection)) throw new AiError(CATEGORIES.POLICY, "Embeddings need a connected OpenAI key for this organization.");
  const started = Date.now();
  const { data } = await aiRequest("https://api.openai.com/v1/embeddings", { headers: { Authorization: `Bearer ${await apiKeyFor(connection)}` }, json: { model: cfg.model, input: texts }, timeoutMs: 30_000 });
  const vectors = (data?.data || []).sort((a, b) => a.index - b.index).map((d) => d.embedding);
  await recordUsage({ organizationId, useCaseKey, providerKey: "openai", modelId: cfg.model, alias: null, mode: "Live", usage: { inputTokens: data?.usage?.prompt_tokens || 0, outputTokens: 0, cachedTokens: 0 }, price: await getPriceFor(organizationId, "openai", cfg.model), outcome: "Succeeded", durationMs: Date.now() - started });
  return vectors;
}
