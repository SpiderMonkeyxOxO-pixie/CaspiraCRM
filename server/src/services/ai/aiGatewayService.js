import { getProvider } from "./providerRegistry.js";
import { buildNarrativeMessages, buildExploreMessages } from "./prompts.js";
import { truncateRecords, verifyNoNewNumbers } from "./guardrails.js";
import { exploreFindingsSchema } from "./schemas.js";

const NARRATIVE_MAX_TOKENS = 400;
const EXPLORE_MAX_TOKENS = 900;
const REQUEST_TIMEOUT_MS = 25000;

class AiGatewayError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Races the provider call against its own timeout rather than relying
// solely on the SDK correctly honoring the AbortSignal — the signal is
// still passed through so a compliant SDK can cancel its underlying HTTP
// request, but the timeout itself is enforced independently of that.
async function withTimeout(fn) {
  const controller = new AbortController();
  let timer;
  const timeoutPromise = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AiGatewayError("The AI provider took too long to respond.", 504));
    }, REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([fn(controller.signal), timeoutPromise]);
  } catch (err) {
    if (err instanceof AiGatewayError) throw err;
    throw new AiGatewayError(err.message || "The AI provider request failed.", err.status || 502);
  } finally {
    clearTimeout(timer);
  }
}

export async function generateNarrative({ providerId, model, executiveSummary, facts }) {
  const provider = getProvider(providerId);
  const { system, prompt } = buildNarrativeMessages({ executiveSummary, facts });
  const result = await withTimeout((signal) => provider.complete({ system, prompt, maxTokens: NARRATIVE_MAX_TOKENS, model, signal }));

  const { verified } = verifyNoNewNumbers(result.text, facts);
  // Fail-closed: an unverifiable narrative never reaches the user — the
  // deterministic summary they already trust is shown instead.
  const narrative = verified && result.text.trim() ? result.text.trim() : executiveSummary;

  return {
    narrative,
    numbersVerified: verified,
    provider: { id: provider.id, label: provider.label, model: result.modelUsed },
  };
}

function collectKnownRecordIds(records) {
  const ids = new Set();
  for (const list of Object.values(records || {})) {
    if (!Array.isArray(list)) continue;
    for (const record of list) if (record?._id) ids.add(String(record._id));
  }
  return ids;
}

export async function generateExploration({ providerId, model, role, scopeLabel, question, records }) {
  const provider = getProvider(providerId);
  const { records: scopedRecords, truncated } = truncateRecords(records);
  const knownIds = collectKnownRecordIds(scopedRecords);

  const { system, prompt } = buildExploreMessages({ records: scopedRecords, role, scopeLabel, question });
  const result = await withTimeout((signal) => provider.complete({ system, prompt, maxTokens: EXPLORE_MAX_TOKENS, model, signal }));

  let parsed;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    throw new AiGatewayError("The AI provider returned a response that could not be parsed.", 502);
  }
  const validated = exploreFindingsSchema.safeParse(parsed);
  if (!validated.success) throw new AiGatewayError("The AI provider's response did not match the expected format.", 502);

  // The model's JSON is untrusted input from here on — every citation and
  // suggested action must resolve against records we actually sent it.
  const findings = validated.data.findings.map((finding) => {
    const citedRecordIds = finding.citedRecordIds.filter((id) => knownIds.has(id));
    const suggestedAction = finding.suggestedAction && knownIds.has(finding.suggestedAction.affectedRecordId)
      ? finding.suggestedAction
      : undefined;
    return { ...finding, citedRecordIds, suggestedAction };
  });

  return {
    findings,
    truncated,
    provider: { id: provider.id, label: provider.label, model: result.modelUsed },
  };
}
