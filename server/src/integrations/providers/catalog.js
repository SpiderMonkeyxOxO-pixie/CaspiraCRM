// Backend Phase 8 — the provider catalog (seeded into IntegrationProvider).
//
// Only providers already in the frontend Integration Center are listed.
// Three kinds:
//   Adapter       — a backend adapter exists (priority list from the Phase 8
//                   prompt). Connectable once OAuth app credentials are
//                   supplied; until then "Not Configured".
//   Catalog Only  — shown in the Integration Center, no backend adapter yet;
//                   not connectable.
//   Blocked       — AI providers: Backend Phase 9 only.
//
// Protocol facts (endpoints, PKCE, webhook signatures, API versions, rate
// limits) come from each provider's official documentation, linked in
// docsUrl / protocol.references. Where a fact could not be re-verified,
// protocol.unverified says so instead of guessing.

const U = "User Connection";
const O = "Organization Connection";
const S = "Service Connection";

// capability(key, name, entityType, crmModule, direction, scopes, extra)
const cap = (key, name, entityType, crmModule, direction, requiredScopes, extra = {}) => ({ key, name, entityType, crmModule, direction, requiredScopes, ...extra });
const PHASE7 = { requiresPhase: 7, unavailableReason: "Requires Backend Phase 7 (document quarantine and malware scanning), which isn't built yet." };

export const ADAPTER_PROVIDERS = [
  {
    key: "google_workspace", name: "Google Workspace", category: "Productivity", apiVersion: "Gmail v1, Calendar v3, Drive v3", authType: "OAuth2",
    description: "Gmail, Google Calendar and Google Drive for one user at a time: explicit message linking, calendar import and chosen files only.",
    ownershipTypes: [U], requiredScopes: ["openid", "email"],
    optionalScopes: ["https://www.googleapis.com/auth/gmail.metadata", "https://www.googleapis.com/auth/gmail.compose", "https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/drive.file"],
    capabilities: [
      cap("gmail.link_message", "Link an email thread (headers only)", "email_thread", "activities", "Import Only", ["https://www.googleapis.com/auth/gmail.metadata"], { explicitSelection: true }),
      cap("gmail.draft", "Create a draft (never sent automatically)", "email_draft", "activities", "Export Only", ["https://www.googleapis.com/auth/gmail.compose"], { requiresConfirmation: true }),
      cap("calendar.import", "Import events from chosen calendars", "calendar_event", "activities", "Import Only", ["https://www.googleapis.com/auth/calendar.readonly"], { incremental: true }),
      cap("drive.import", "Import chosen files", "file", "documents", "Import Only", ["https://www.googleapis.com/auth/drive.file"], PHASE7),
    ],
    webhookSupport: true, incrementalSync: true, sandboxSupport: false,
    docsUrl: "https://developers.google.com/identity/protocols/oauth2/web-server", statusPageUrl: "https://www.google.com/appsstatus/dashboard/",
    dataCategories: ["Email metadata", "Calendar events", "Selected files"], sensitiveWarning: "Mailbox and calendar data belong to the individual user; only explicitly linked messages and chosen calendars are read.",
    protocol: {
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token", revokeUrl: "https://oauth2.googleapis.com/revoke",
      pkce: true, authParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" }, scopeSeparator: " ",
      identityUrl: "https://openidconnect.googleapis.com/v1/userinfo",
      incremental: "Calendar syncToken (410 Gone → full resync preview); Gmail historyId; Drive changes pageToken",
      webhook: { scheme: "channel-token", notes: "Calendar/Drive push channels: compare X-Goog-Channel-Token with the token set at watch time; then fetch changes." },
      rateLimits: "Per-user and per-project quotas; 403 rateLimitExceeded / userRateLimitExceeded and 429 → exponential backoff.",
      references: ["https://developers.google.com/calendar/api/guides/sync", "https://developers.google.com/gmail/api/auth/scopes", "https://developers.google.com/drive/api/guides/api-specific-auth"],
    },
  },
  {
    key: "microsoft_365", name: "Microsoft 365", category: "Productivity", apiVersion: "Microsoft Graph v1.0", authType: "OAuth2",
    description: "Outlook Mail, Outlook Calendar, OneDrive and Microsoft Teams notifications through Microsoft Graph.",
    ownershipTypes: [U, O], requiredScopes: ["openid", "profile", "offline_access", "User.Read"],
    optionalScopes: ["Mail.ReadBasic", "Mail.ReadWrite", "Calendars.Read", "Files.Read", "Team.ReadBasic.All", "Channel.ReadBasic.All", "ChannelMessage.Send"],
    capabilities: [
      cap("outlook.link_message", "Link an email thread (no body)", "email_thread", "activities", "Import Only", ["Mail.ReadBasic"], { explicitSelection: true }),
      cap("outlook.draft", "Create a draft (never sent automatically)", "email_draft", "activities", "Export Only", ["Mail.ReadWrite"], { requiresConfirmation: true }),
      cap("calendar.import", "Import events from chosen calendars", "calendar_event", "activities", "Import Only", ["Calendars.Read"], { incremental: true }),
      cap("onedrive.import", "Import chosen files", "file", "documents", "Import Only", ["Files.Read"], PHASE7),
      cap("teams.notify", "Post an approved notification to a chosen channel", "notification", "notifications", "Export Only", ["Team.ReadBasic.All", "Channel.ReadBasic.All", "ChannelMessage.Send"], { requiresConfirmation: true }),
    ],
    webhookSupport: true, incrementalSync: true, sandboxSupport: true,
    docsUrl: "https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow", statusPageUrl: "https://status.cloud.microsoft/",
    dataCategories: ["Email metadata", "Calendar events", "Selected files", "Channel notifications"], sensitiveWarning: "Organization connections need an administrator; mail and calendar access stays with the connecting user.",
    protocol: {
      authorizationUrl: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize", tokenUrl: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token", revokeUrl: null,
      defaultTenant: "organizations", pkce: true, scopeSeparator: " ", identityUrl: "https://graph.microsoft.com/v1.0/me",
      incremental: "Delta queries (calendarView/delta, messages/delta) with @odata.deltaLink; expired delta → resync preview",
      webhook: { scheme: "graph-client-state", notes: "Validation handshake (validationToken echoed as text/plain); every notification's clientState is compared with the secret set at subscription. Outlook resources: max 10,080 minutes (under 7 days); Teams chatMessage: 4,320 minutes." },
      revocationNotes: "Graph has no per-token revoke endpoint; disconnect deletes stored tokens and the user or admin removes consent in Entra ID.",
      rateLimits: "429 with Retry-After (throttling per app and per tenant).",
      references: ["https://learn.microsoft.com/en-us/graph/api/resources/subscription?view=graph-rest-1.0", "https://learn.microsoft.com/en-us/graph/delta-query-overview", "https://learn.microsoft.com/en-us/graph/throttling"],
    },
  },
  {
    key: "slack", name: "Slack", category: "Internal Communication", apiVersion: "Web API", authType: "OAuth2",
    description: "Human-approved notifications to a chosen workspace channel. Nothing is read from conversations.",
    ownershipTypes: [O], requiredScopes: ["chat:write", "channels:read"], optionalScopes: [],
    capabilities: [cap("slack.notify", "Post an approved notification to a chosen channel", "notification", "notifications", "Export Only", ["chat:write", "channels:read"], { requiresConfirmation: true })],
    webhookSupport: true, incrementalSync: false, sandboxSupport: false,
    docsUrl: "https://docs.slack.dev/authentication/installing-with-oauth", statusPageUrl: "https://slack-status.com/",
    dataCategories: ["Channel list", "Outbound notifications"], sensitiveWarning: "Only the preview you approve is posted; customer personal or financial data needs policy approval.",
    protocol: {
      authorizationUrl: "https://slack.com/oauth/v2/authorize", tokenUrl: "https://slack.com/api/oauth.v2.access", revokeUrl: "https://slack.com/api/auth.revoke",
      pkce: false, pkceNote: "The OAuth v2 install guide doesn't document PKCE; state protects the flow.", scopeSeparator: ",", identityUrl: "https://slack.com/api/auth.test",
      webhook: { scheme: "slack-v0", notes: "X-Slack-Signature = v0=HMAC-SHA256(signing secret, 'v0:' + X-Slack-Request-Timestamp + ':' + raw body); reject timestamps older than 5 minutes." },
      rateLimits: "Per-method tiers; 429 with Retry-After.",
      references: ["https://docs.slack.dev/authentication/verifying-requests-from-slack"],
    },
  },
  {
    key: "github", name: "GitHub", category: "Developer Tools", apiVersion: "REST 2022-11-28", authType: "OAuth2",
    description: "Import Issues from selected repositories into project Tasks.",
    ownershipTypes: [U, O], requiredScopes: ["read:user"], optionalScopes: ["public_repo", "repo"],
    capabilities: [cap("github.issues", "Import Issues from selected repositories as Tasks", "issue", "tasks", "Import Only", ["public_repo"], { incremental: true, twoWayCapable: true })],
    webhookSupport: true, incrementalSync: true, sandboxSupport: false,
    docsUrl: "https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps", statusPageUrl: "https://www.githubstatus.com/",
    dataCategories: ["Issues", "Repository names"], sensitiveWarning: "The repo scope covers private repositories — only request it when private repositories are needed; content is shown only to CRM users with project access.",
    protocol: {
      authorizationUrl: "https://github.com/login/oauth/authorize", tokenUrl: "https://github.com/login/oauth/access_token", revokeUrl: "https://api.github.com/applications/{client_id}/grant",
      pkce: true, scopeSeparator: " ", identityUrl: "https://api.github.com/user", headers: { "X-GitHub-Api-Version": "2022-11-28", Accept: "application/vnd.github+json" },
      incremental: "since= timestamp on issues listing, per repository",
      webhook: { scheme: "github-sha256", notes: "X-Hub-Signature-256 = 'sha256=' + HMAC-SHA256(secret, raw body); X-GitHub-Delivery is the unique delivery id." },
      rateLimits: "5,000 requests/hour per user token; x-ratelimit-remaining / x-ratelimit-reset; secondary limits return 403/429 with retry-after.",
      references: ["https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries", "https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api"],
    },
  },
  {
    key: "jira", name: "Jira", category: "Project Management", apiVersion: "Jira Cloud REST v3", authType: "OAuth2",
    description: "Import issues from chosen Jira projects into project Tasks.",
    ownershipTypes: [U, O], requiredScopes: ["read:me", "offline_access"], optionalScopes: ["read:jira-work", "write:jira-work"],
    capabilities: [cap("jira.issues", "Import issues from chosen projects as Tasks", "issue", "tasks", "Import Only", ["read:jira-work"], { incremental: true })],
    webhookSupport: false, incrementalSync: true, sandboxSupport: false,
    docsUrl: "https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/", statusPageUrl: "https://jira-software.status.atlassian.com/",
    dataCategories: ["Issues", "Project names"], sensitiveWarning: null,
    protocol: {
      authorizationUrl: "https://auth.atlassian.com/authorize", tokenUrl: "https://auth.atlassian.com/oauth/token", revokeUrl: null,
      pkce: false, pkceNote: "The 3LO guide doesn't document PKCE; state protects the flow.", authParams: { audience: "api.atlassian.com", prompt: "consent" }, scopeSeparator: " ",
      identityUrl: "https://api.atlassian.com/me", tenantUrl: "https://api.atlassian.com/oauth/token/accessible-resources",
      refreshNotes: "Rotating refresh tokens (valid 90 days); the new token replaces the old on every refresh.",
      incremental: "JQL `updated >= watermark` polling (bounded)",
      webhook: { scheme: null, notes: "Webhooks for OAuth 2.0 apps are not used in this phase; changes are polled within the policy's sync frequency." },
      rateLimits: "429 with Retry-After.",
      references: ["https://developer.atlassian.com/cloud/jira/platform/rate-limiting/"],
    },
  },
  {
    key: "asana", name: "Asana", category: "Project Management", apiVersion: "REST 1.0", authType: "OAuth2",
    description: "Import tasks from chosen Asana projects into project Tasks.",
    ownershipTypes: [U, O], requiredScopes: ["users:read"], optionalScopes: ["tasks:read", "projects:read"],
    capabilities: [cap("asana.tasks", "Import tasks from chosen projects", "issue", "tasks", "Import Only", ["tasks:read", "projects:read"], { incremental: true })],
    webhookSupport: true, incrementalSync: true, sandboxSupport: false,
    docsUrl: "https://developers.asana.com/docs/oauth", statusPageUrl: "https://status.asana.com/",
    dataCategories: ["Tasks", "Project names"], sensitiveWarning: null,
    protocol: {
      authorizationUrl: "https://app.asana.com/-/oauth_authorize", tokenUrl: "https://app.asana.com/-/oauth_token", revokeUrl: "https://app.asana.com/-/oauth_revoke",
      pkce: true, scopeSeparator: " ", identityUrl: "https://app.asana.com/api/1.0/users/me",
      scopeNotes: "Granular scopes (<resource>:<action>) when the app is configured for them; 'full permissions' apps are refused by the least-privilege policy.",
      incremental: "Events API sync tokens per project",
      webhook: { scheme: "asana-hook", notes: "Handshake echoes X-Hook-Secret; deliveries carry X-Hook-Signature = HMAC-SHA256(hook secret, raw body) hex." },
      rateLimits: "Per-minute limits by plan; 429 with Retry-After.",
      references: ["https://developers.asana.com/docs/webhooks-guide", "https://developers.asana.com/docs/rate-limits"],
    },
  },
  {
    key: "trello", name: "Trello", category: "Project Management", apiVersion: "REST 1", authType: "API Key",
    description: "Import cards from chosen boards into project Tasks.",
    ownershipTypes: [U], requiredScopes: ["read"], optionalScopes: [],
    capabilities: [cap("trello.cards", "Import cards from chosen boards", "issue", "tasks", "Import Only", ["read"], { incremental: true })],
    webhookSupport: true, incrementalSync: true, sandboxSupport: false,
    docsUrl: "https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/", statusPageUrl: "https://trello.status.atlassian.com/",
    dataCategories: ["Cards", "Board names"], sensitiveWarning: null,
    protocol: {
      authorizationUrl: "https://trello.com/1/authorize", pkce: false, tokenInFragment: true, identityUrl: "https://api.trello.com/1/members/me",
      authNotes: "Trello issues a user token for the app's API key through its authorize page; the token is then stored encrypted like any credential.",
      webhook: { scheme: "trello-sha1", notes: "X-Trello-Webhook = base64(HMAC-SHA1(app secret, raw body + callback URL exactly as registered))." },
      rateLimits: "Per key and per token limits over 10-second windows; 429.",
      references: ["https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/"],
    },
  },
  {
    key: "clickup", name: "ClickUp", category: "Project Management", apiVersion: "API v2", authType: "OAuth2",
    description: "Import tasks from chosen ClickUp lists into project Tasks.",
    ownershipTypes: [U, O], requiredScopes: [], optionalScopes: [],
    capabilities: [cap("clickup.tasks", "Import tasks from chosen lists", "issue", "tasks", "Import Only", [], { incremental: true })],
    webhookSupport: true, incrementalSync: true, sandboxSupport: false,
    docsUrl: "https://developer.clickup.com/docs/authentication", statusPageUrl: "https://clickup.statuspage.io/",
    dataCategories: ["Tasks", "List names"], sensitiveWarning: "ClickUp OAuth has no scopes: access follows the authorizing user's workspace permissions.",
    protocol: {
      authorizationUrl: "https://app.clickup.com/api", tokenUrl: "https://api.clickup.com/api/v2/oauth/token", revokeUrl: null, pkce: false, identityUrl: "https://api.clickup.com/api/v2/user",
      webhook: { scheme: "hmac-sha256-hex", header: "x-signature", notes: "X-Signature = HMAC-SHA256(webhook secret, raw body) hex." },
      rateLimits: "Per-token per-minute limits by plan; 429.",
      references: ["https://developer.clickup.com/docs/webhooksignature", "https://developer.clickup.com/docs/rate-limits"],
    },
  },
  {
    key: "dropbox", name: "Dropbox", category: "Documents", apiVersion: "API v2", authType: "OAuth2",
    description: "Import files a person explicitly chooses — through document quarantine and scanning.",
    ownershipTypes: [U], requiredScopes: ["account_info.read"], optionalScopes: ["files.metadata.read", "files.content.read"],
    capabilities: [cap("dropbox.files", "Import chosen files", "file", "documents", "Import Only", ["files.metadata.read", "files.content.read"], PHASE7)],
    webhookSupport: true, incrementalSync: false, sandboxSupport: false,
    docsUrl: "https://developers.dropbox.com/oauth-guide", statusPageUrl: "https://status.dropbox.com/",
    dataCategories: ["Selected files"], sensitiveWarning: "Files never bypass quarantine and malware scanning.",
    protocol: {
      authorizationUrl: "https://www.dropbox.com/oauth2/authorize", tokenUrl: "https://api.dropboxapi.com/oauth2/token", revokeUrl: "https://api.dropboxapi.com/2/auth/token/revoke",
      pkce: true, authParams: { token_access_type: "offline" }, scopeSeparator: " ", identityUrl: "https://api.dropboxapi.com/2/users/get_current_account", identityMethod: "POST",
      webhook: { scheme: "hmac-sha256-hex", header: "x-dropbox-signature", notes: "Verification GET echoes the challenge; notifications carry X-Dropbox-Signature = HMAC-SHA256(app secret, raw body) hex." },
      rateLimits: "429 with Retry-After.",
      references: ["https://www.dropbox.com/developers/reference/webhooks"],
    },
  },
  {
    key: "box", name: "Box", category: "Documents", apiVersion: "API 2.0", authType: "OAuth2",
    description: "Import files a person explicitly chooses — through document quarantine and scanning.",
    ownershipTypes: [U, O], requiredScopes: ["root_readonly"], optionalScopes: [],
    capabilities: [cap("box.files", "Import chosen files", "file", "documents", "Import Only", ["root_readonly"], PHASE7)],
    webhookSupport: true, incrementalSync: false, sandboxSupport: true,
    docsUrl: "https://developer.box.com/guides/authentication/oauth2/", statusPageUrl: "https://status.box.com/",
    dataCategories: ["Selected files"], sensitiveWarning: "Files never bypass quarantine and malware scanning.",
    protocol: {
      authorizationUrl: "https://account.box.com/api/oauth2/authorize", tokenUrl: "https://api.box.com/oauth2/token", revokeUrl: "https://api.box.com/oauth2/revoke",
      pkce: false, scopeSeparator: " ", identityUrl: "https://api.box.com/2.0/users/me",
      webhook: { scheme: "box-v2", notes: "BOX-SIGNATURE-PRIMARY / -SECONDARY = base64(HMAC-SHA256(key, raw body + BOX-DELIVERY-TIMESTAMP)); reject timestamps older than 10 minutes; either key may match (rotation)." },
      rateLimits: "429 with Retry-After.",
      references: ["https://developer.box.com/guides/webhooks/v2/signatures-v2/"],
    },
  },
  {
    key: "docusign", name: "DocuSign", category: "Electronic Signature", apiVersion: "eSignature REST v2.1", authType: "OAuth2",
    description: "Map document envelopes to DocuSign envelopes (sandbox first). Contract activation stays a separate CRM step.",
    ownershipTypes: [O], requiredScopes: ["signature", "extended"], optionalScopes: [],
    capabilities: [cap("docusign.envelopes", "Map envelopes and receive status", "envelope", "documents", "Export Only", ["signature"], PHASE7)],
    webhookSupport: true, incrementalSync: false, sandboxSupport: true,
    docsUrl: "https://developers.docusign.com/platform/auth/authcode/", statusPageUrl: "https://status.docusign.com/",
    dataCategories: ["Envelopes", "Signer status"], sensitiveWarning: "No claim of universal legal validity; external audit evidence is preserved as received.",
    protocol: {
      authorizationUrl: "https://account-d.docusign.com/oauth/auth", tokenUrl: "https://account-d.docusign.com/oauth/token", revokeUrl: null, pkce: true, scopeSeparator: " ",
      identityUrl: "https://account-d.docusign.com/oauth/userinfo", productionHost: "account.docusign.com",
      webhook: { scheme: "hmac-sha256-base64", header: "x-docusign-signature-1", notes: "DocuSign Connect HMAC: X-DocuSign-Signature-1 = base64(HMAC-SHA256(key, raw body))." },
      rateLimits: "Hourly per-account API limits; 429.",
      references: ["https://developers.docusign.com/platform/webhooks/connect/hmac/"],
    },
  },
  {
    key: "dropbox_sign", name: "Dropbox Sign", category: "Electronic Signature", apiVersion: "API v3", authType: "API Key",
    description: "Map document envelopes to Dropbox Sign requests (test mode first).",
    ownershipTypes: [O], requiredScopes: [], optionalScopes: [],
    capabilities: [cap("dropbox_sign.requests", "Map envelopes and receive status", "envelope", "documents", "Export Only", [], PHASE7)],
    webhookSupport: true, incrementalSync: false, sandboxSupport: true,
    docsUrl: "https://developers.hellosign.com/docs/events/walkthrough/", statusPageUrl: "https://status.hellosign.com/",
    dataCategories: ["Signature requests", "Signer status"], sensitiveWarning: "No claim of universal legal validity.",
    protocol: {
      pkce: false, identityUrl: "https://api.hellosign.com/v3/account",
      webhook: { scheme: "dropbox-sign-event-hash", notes: "event_hash = HMAC-SHA256(API key, event_time + event_type) hex; respond 'Hello API Event Received'." },
      rateLimits: "Per-minute limits; test mode has lower limits.",
      references: ["https://developers.hellosign.com/docs/events/walkthrough/"],
    },
  },
  {
    key: "stripe", name: "Stripe", category: "Payments", apiVersion: "2024-06-20", authType: "API Key",
    description: "Read-only import of test-mode payments for reconciliation preview. Never creates charges, refunds or payouts.",
    ownershipTypes: [S], requiredScopes: ["read_only"], optionalScopes: [],
    capabilities: [cap("stripe.transactions", "Import payments for reconciliation preview", "financial_transaction", "reconciliation", "Import Only", ["read_only"], { incremental: true, financeReadOnly: true })],
    webhookSupport: true, incrementalSync: true, sandboxSupport: true,
    docsUrl: "https://docs.stripe.com/keys", statusPageUrl: "https://status.stripe.com/",
    dataCategories: ["Payment transactions"], sensitiveWarning: "Use a restricted, read-only test-mode key. Live keys and write access are refused.",
    protocol: {
      pkce: false, identityUrl: "https://api.stripe.com/v1/account", headers: { "Stripe-Version": "2024-06-20" },
      keyRules: "Only test-mode keys (sk_test_ / rk_test_) are accepted in Phase 8; live keys are refused.",
      incremental: "created[gt] watermark with starting_after pagination",
      webhook: { scheme: "stripe", notes: "Stripe-Signature: t=<timestamp>,v1=<HMAC-SHA256(endpoint secret, t + '.' + raw body)>; default tolerance 300 seconds." },
      rateLimits: "429 with Retry-After; lower limits in test mode.",
      references: ["https://docs.stripe.com/webhooks#verify-signature", "https://docs.stripe.com/rate-limits"],
    },
  },
  {
    key: "paypal", name: "PayPal", category: "Payments", apiVersion: "REST v1/v2 (Sandbox)", authType: "Client Credentials",
    description: "Read-only import of sandbox transactions for reconciliation preview. Never initiates payments.",
    ownershipTypes: [S], requiredScopes: [], optionalScopes: [],
    capabilities: [cap("paypal.transactions", "Import transactions for reconciliation preview", "financial_transaction", "reconciliation", "Import Only", [], { financeReadOnly: true })],
    webhookSupport: true, incrementalSync: true, sandboxSupport: true,
    docsUrl: "https://developer.paypal.com/api/rest/authentication/", statusPageUrl: "https://www.paypal-status.com/",
    dataCategories: ["Transactions"], sensitiveWarning: "Sandbox only in Phase 8.",
    protocol: {
      tokenUrl: "https://api-m.sandbox.paypal.com/v1/oauth2/token", pkce: false, apiBase: "https://api-m.sandbox.paypal.com",
      webhook: { scheme: "paypal-verify-api", notes: "Verified by calling POST /v1/notifications/verify-webhook-signature with the PAYPAL-TRANSMISSION-* headers and the webhook id." },
      rateLimits: "429.", references: ["https://developer.paypal.com/api/rest/webhooks/rest/"],
    },
  },
  {
    key: "quickbooks_online", name: "QuickBooks Online", category: "Accounting", apiVersion: "Accounting API v3 (minorversion 75)", authType: "OAuth2",
    description: "Read-only import of sandbox accounting transactions for reconciliation preview. Never posts journals.",
    ownershipTypes: [O], requiredScopes: ["com.intuit.quickbooks.accounting", "openid"], optionalScopes: [],
    capabilities: [cap("quickbooks.transactions", "Import transactions for reconciliation preview", "financial_transaction", "reconciliation", "Import Only", ["com.intuit.quickbooks.accounting"], { financeReadOnly: true })],
    webhookSupport: true, incrementalSync: true, sandboxSupport: true,
    docsUrl: "https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0", statusPageUrl: "https://status.developer.intuit.com/",
    dataCategories: ["Accounting transactions"], sensitiveWarning: "Sandbox company only in Phase 8.",
    protocol: {
      authorizationUrl: "https://appcenter.intuit.com/connect/oauth2", tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", revokeUrl: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
      pkce: false, scopeSeparator: " ", identityUrl: "https://sandbox-accounts.platform.intuit.com/v1/openid_connect/userinfo", apiBase: "https://sandbox-quickbooks.api.intuit.com/v3/company/{realmId}",
      tenantFromCallback: "realmId",
      webhook: { scheme: "hmac-sha256-base64", header: "intuit-signature", notes: "intuit-signature = base64(HMAC-SHA256(verifier token, raw body))." },
      unverified: ["The webhook signature scheme could not be re-verified against Intuit's page during Phase 8 (the page didn't load); confirm before enabling live webhooks."],
      rateLimits: "Per-realm per-minute limits; 429.",
      references: ["https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks"],
    },
  },
  {
    key: "xero", name: "Xero", category: "Accounting", apiVersion: "Accounting API 2.0", authType: "OAuth2",
    description: "Read-only import of demo-company transactions for reconciliation preview. Never posts journals.",
    ownershipTypes: [O], requiredScopes: ["openid", "profile", "email", "offline_access"], optionalScopes: ["accounting.transactions.read", "accounting.contacts.read"],
    capabilities: [cap("xero.transactions", "Import bank transactions for reconciliation preview", "financial_transaction", "reconciliation", "Import Only", ["accounting.transactions.read"], { financeReadOnly: true })],
    webhookSupport: true, incrementalSync: true, sandboxSupport: true,
    docsUrl: "https://developer.xero.com/documentation/guides/oauth2/pkce-flow", statusPageUrl: "https://status.xero.com/",
    dataCategories: ["Bank transactions", "Contacts"], sensitiveWarning: "Demo company only in Phase 8.",
    protocol: {
      authorizationUrl: "https://login.xero.com/identity/connect/authorize", tokenUrl: "https://identity.xero.com/connect/token", revokeUrl: "https://identity.xero.com/connect/revocation",
      pkce: true, scopeSeparator: " ", identityUrl: null, tenantUrl: "https://api.xero.com/connections",
      webhook: { scheme: "hmac-sha256-base64", header: "x-xero-signature", notes: "x-xero-signature = base64(HMAC-SHA256(webhook key, raw body)); intent-to-receive responds 200/401." },
      rateLimits: "Per-tenant per-minute and daily limits; 429 with Retry-After.",
      references: ["https://developer.xero.com/documentation/guides/webhooks/overview/"],
    },
  },
];

// Every other provider the Integration Center shows: listed, not connectable.
const CATALOG_ONLY = [
  ["shopify", "Shopify", "Commerce"], ["woocommerce", "WooCommerce", "Commerce"], ["razorpay", "Razorpay", "Payments"], ["square", "Square", "Payments"],
  ["wise_business", "Wise Business", "Banking"], ["plaid", "Plaid", "Banking"], ["chargebee", "Chargebee", "Subscriptions"], ["paddle", "Paddle", "Subscriptions"],
  ["adobe_acrobat_sign", "Adobe Acrobat Sign", "Electronic Signature"], ["whatsapp_business", "WhatsApp Business", "Customer Messaging"], ["twilio", "Twilio", "Customer Messaging"],
  ["calendly", "Calendly", "Calendar"], ["zoom", "Zoom", "Meetings"], ["zapier", "Zapier", "Automation"], ["make", "Make", "Automation"],
  ["monday_com", "Monday.com", "Project Management"], ["gitlab", "GitLab", "Developer Tools"], ["bitbucket", "Bitbucket", "Developer Tools"],
  ["mailchimp", "Mailchimp", "Marketing"], ["brevo", "Brevo", "Marketing"], ["sendgrid", "SendGrid", "Marketing"], ["amazon_ses", "Amazon SES", "Marketing"], ["resend", "Resend", "Marketing"],
  ["meta_lead_ads", "Meta Lead Ads", "Marketing"], ["google_ads", "Google Ads", "Marketing"], ["linkedin_lead_gen", "LinkedIn Lead Gen Forms", "Marketing"], ["tiktok_lead_gen", "TikTok Lead Generation", "Marketing"],
  ["google_analytics_4", "Google Analytics 4", "Marketing"], ["microsoft_clarity", "Microsoft Clarity", "Marketing"], ["typeform", "Typeform", "Marketing"], ["google_forms", "Google Forms", "Marketing"],
  ["zendesk", "Zendesk", "Support"], ["freshdesk", "Freshdesk", "Support"], ["intercom", "Intercom", "Support"], ["facebook_messenger", "Facebook Messenger", "Customer Messaging"],
  ["instagram_messaging", "Instagram Messaging", "Customer Messaging"], ["telegram_bot_api", "Telegram Bot API", "Customer Messaging"], ["aircall", "Aircall", "Business Telephony"],
  ["ringcentral", "RingCentral", "Business Telephony"], ["google_business_profile", "Google Business Profile", "Customer Reviews"],
].map(([key, name, category]) => ({
  key, name, category, description: `${name} appears in the Integration Center; no backend adapter exists yet.`, authType: "None", ownershipTypes: [], capabilities: [],
  availability: "Catalog Only", availabilityReason: "No backend adapter in Phase 8 — shown for reference, not connectable.",
}));

const BLOCKED_AI = [
  ["anthropic_claude", "Anthropic Claude"], ["openai", "OpenAI"], ["google_gemini", "Google Gemini"], ["azure_openai", "Azure OpenAI"], ["ollama", "Ollama (Local Models)"],
].map(([key, name]) => ({
  key, name, category: "AI", description: `${name} is an AI provider.`, authType: "None", ownershipTypes: [], capabilities: [],
  availability: "Blocked", availabilityReason: "AI providers are Backend Phase 9 (AI Gateway). No external AI request is made in Phase 8.",
}));

export const ADAPTER_VERSION = "8.0.0";

export const PROVIDER_CATALOG = [
  ...ADAPTER_PROVIDERS.map((p) => ({ ...p, availability: "Adapter", adapterVersion: ADAPTER_VERSION })),
  ...CATALOG_ONLY,
  ...BLOCKED_AI,
];

export const catalogEntry = (key) => PROVIDER_CATALOG.find((p) => p.key === key) || null;
