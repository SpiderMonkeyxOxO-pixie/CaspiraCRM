// Backend Phase 4 — Knowledge Base (internal side).
//
// Lifecycle of each version: Draft → In Review → Approved → Published
// (the previously published version becomes Superseded), or In Review →
// Rejected. Published, approved and in-review versions are never edited:
// any material edit creates a new Draft version. Separation of duties:
// neither the reviewer nor the publisher can be the version's author.
// Only Published articles with "Customers" visibility ever reach the portal.
import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { hasGrant } from "../../utils/grants.js";
import { nextDocumentNumber } from "../../services/sales/documentNumberService.js";
import { sanitizeText, slugify, invalid, notFound, badTransition, versionConflict, staleVersion, audit } from "../../services/support/supportCommon.js";

const VISIBILITIES = ["Internal", "Customers"];
const who = (req) => req.membership?.id || null;
const text = (v, max) => (typeof v === "string" && v.trim() ? sanitizeText(v, { max }) : null);
const forbid = (res, message) => res.status(403).json({ code: "SUPPORT_SEPARATION_OF_DUTIES", message });

// ---------------------------------------------------------------- Categories

export async function listCategories(req, res) {
  const where = { organizationId: req.organizationId, ...(req.query.includeArchived === "true" ? {} : { archivedAt: null }) };
  const categories = await prisma.kbCategory.findMany({ where, orderBy: [{ displayOrder: "asc" }, { name: "asc" }] });
  res.json({ categories: toApi(categories) });
}

async function categoryFields(req, existing) {
  const b = req.body;
  const out = {};
  if (!existing || "name" in b) {
    out.name = text(b.name, 120);
    if (!out.name) return { error: "name is required." };
  }
  if (!existing || "slug" in b || "name" in b) {
    out.slug = slugify(b.slug || out.name || existing?.name);
    if (!out.slug) return { error: "slug can't be empty." };
    const clash = await prisma.kbCategory.findFirst({ where: { organizationId: req.organizationId, slug: out.slug, ...(existing && { id: { not: existing.id } }) } });
    if (clash) return { error: `The slug "${out.slug}" is already used.` };
  }
  if ("description" in b) out.description = text(b.description, 1000);
  if (!existing || "visibility" in b) {
    const visibility = b.visibility || "Internal";
    if (!VISIBILITIES.includes(visibility)) return { error: `visibility must be one of ${VISIBILITIES.join(", ")}.` };
    out.visibility = visibility;
  }
  if ("displayOrder" in b) out.displayOrder = Math.max(0, Math.min(10000, Number(b.displayOrder) || 0));
  if ("active" in b) out.active = Boolean(b.active);
  if (!existing && b.parentId) {
    const parent = await prisma.kbCategory.findFirst({ where: { id: b.parentId, organizationId: req.organizationId, archivedAt: null } });
    if (!parent) return { error: "parentId must be an active category in this organization." };
    out.parentId = parent.id;
  }
  return { data: out };
}

export async function createCategory(req, res) {
  const { data, error } = await categoryFields(req, null);
  if (error) return invalid(res, error);
  const category = await prisma.kbCategory.create({ data: { ...data, organizationId: req.organizationId } });
  await audit(req, "support.kb_category.created", "KbCategory", category.id);
  res.status(201).json({ category: toApi(category) });
}

export async function updateCategory(req, res) {
  const existing = await prisma.kbCategory.findFirst({ where: { id: req.params.categoryId, organizationId: req.organizationId } });
  if (!existing) return notFound(res, "Category");
  if (staleVersion(req.body, existing)) return versionConflict(res, "category");
  const { data, error } = await categoryFields(req, existing);
  if (error) return invalid(res, error);
  if (req.body.archived === true) Object.assign(data, { archivedAt: new Date(), active: false });
  const category = await prisma.kbCategory.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } });
  await audit(req, "support.kb_category.updated", "KbCategory", category.id);
  res.json({ category: toApi(category) });
}

// ---------------------------------------------------------------- Articles

const ARTICLE_INCLUDE = { versions: { orderBy: { versionNumber: "desc" } }, category: { select: { id: true, name: true, visibility: true } } };
const latestVersion = (article) => article.versions[0];

async function loadArticle(req, res) {
  const article = await prisma.kbArticle.findFirst({ where: { id: req.params.articleId, organizationId: req.organizationId }, include: ARTICLE_INCLUDE });
  if (!article) notFound(res, "Article");
  return article;
}

async function saved(res, articleId, status = 200) {
  const article = await prisma.kbArticle.findUnique({ where: { id: articleId }, include: ARTICLE_INCLUDE });
  res.status(status).json({ article: toApi(article) });
}

export async function listArticles(req, res) {
  const q = req.query;
  const where = { organizationId: req.organizationId };
  if (q.status) where.status = q.status;
  if (q.visibility) where.visibility = q.visibility;
  if (q.categoryId) where.categoryId = q.categoryId;
  if (q.includeArchived !== "true") where.archivedAt = null;
  if (q.search) where.OR = [{ title: { contains: q.search, mode: "insensitive" } }, { articleNumber: { contains: q.search, mode: "insensitive" } }];
  const articles = await prisma.kbArticle.findMany({ where, include: { category: { select: { id: true, name: true } } }, orderBy: { updatedAt: "desc" }, take: 200 });
  res.json({ articles: toApi(articles) });
}

export async function getArticle(req, res) {
  const article = await loadArticle(req, res);
  if (!article) return;
  res.json({ article: toApi(article) });
}

export async function listVersions(req, res) {
  const article = await loadArticle(req, res);
  if (!article) return;
  res.json({ versions: toApi(article.versions) });
}

async function articleMeta(req, existing) {
  const b = req.body;
  const out = {};
  if (!existing || "title" in b) {
    out.title = text(b.title, 200);
    if (!out.title) return { error: "title is required." };
  }
  if ("summary" in b) out.summary = text(b.summary, 1000);
  if (!existing || "slug" in b) {
    out.slug = slugify(b.slug || out.title);
    if (!out.slug) return { error: "slug can't be empty." };
    const clash = await prisma.kbArticle.findFirst({ where: { organizationId: req.organizationId, slug: out.slug, ...(existing && { id: { not: existing.id } }) } });
    if (clash) return { error: `The slug "${out.slug}" is already used.` };
  }
  if (!existing || "visibility" in b) {
    const visibility = b.visibility || "Internal";
    if (!VISIBILITIES.includes(visibility)) return { error: `visibility must be one of ${VISIBILITIES.join(", ")}.` };
    out.visibility = visibility;
  }
  if ("categoryId" in b) {
    if (b.categoryId && !(await prisma.kbCategory.findFirst({ where: { id: b.categoryId, organizationId: req.organizationId, archivedAt: null } }))) {
      return { error: "categoryId must be an active category in this organization." };
    }
    out.categoryId = b.categoryId || null;
  }
  return { data: out };
}

export async function createArticle(req, res) {
  const { data, error } = await articleMeta(req, null);
  if (error) return invalid(res, error);
  const body = text(req.body.body, 100000);
  if (!body) return invalid(res, "body is required.");
  const article = await prisma.$transaction(async (tx) => {
    const articleNumber = await nextDocumentNumber(tx, req.organizationId, "KbArticle");
    const a = await tx.kbArticle.create({ data: { ...data, organizationId: req.organizationId, articleNumber, status: "Draft", authorMembershipId: who(req) } });
    await tx.kbArticleVersion.create({ data: { organizationId: req.organizationId, articleId: a.id, versionNumber: 1, title: a.title, summary: a.summary, body, changeNote: text(req.body.changeNote, 500), authorMembershipId: who(req) } });
    return a;
  });
  await audit(req, "support.kb_article.created", "KbArticle", article.id);
  await saved(res, article.id, 201);
}

// Edits go into the latest Draft version; if the latest version is already
// in review, approved or published, a new Draft version is created instead.
export async function updateArticle(req, res) {
  const article = await loadArticle(req, res);
  if (!article) return;
  if (article.archivedAt) return badTransition(res, "An archived article can't be edited.");
  if (staleVersion(req.body, article)) return versionConflict(res, "article");
  const { data, error } = await articleMeta(req, article);
  if (error) return invalid(res, error);
  const body = "body" in req.body ? text(req.body.body, 100000) : undefined;
  if (body === null) return invalid(res, "body can't be empty.");
  const latest = latestVersion(article);
  const content = { title: data.title ?? latest.title, summary: "summary" in data ? data.summary : latest.summary, body: body ?? latest.body };
  const contentChanged = content.title !== latest.title || content.summary !== latest.summary || content.body !== latest.body;
  await prisma.$transaction(async (tx) => {
    if (contentChanged) {
      if (latest.reviewStatus === "Draft" || latest.reviewStatus === "Rejected") {
        await tx.kbArticleVersion.update({ where: { id: latest.id }, data: { ...content, reviewStatus: "Draft", changeNote: text(req.body.changeNote, 500) ?? latest.changeNote, version: { increment: 1 } } });
      } else {
        await tx.kbArticleVersion.create({ data: { organizationId: req.organizationId, articleId: article.id, versionNumber: latest.versionNumber + 1, ...content, changeNote: text(req.body.changeNote, 500), authorMembershipId: who(req) } });
      }
    }
    // The article's own title/summary track what customers see once published.
    const meta = { ...data };
    if (article.status === "Published") { delete meta.title; delete meta.summary; }
    await tx.kbArticle.update({ where: { id: article.id }, data: { ...meta, version: { increment: 1 } } });
  });
  await audit(req, "support.kb_article.updated", "KbArticle", article.id);
  await saved(res, article.id);
}

// POST /versions — explicitly start a new Draft from the latest content.
export async function createVersion(req, res) {
  const article = await loadArticle(req, res);
  if (!article) return;
  if (article.archivedAt) return badTransition(res, "An archived article can't get new versions.");
  const latest = latestVersion(article);
  if (latest.reviewStatus === "Draft") return badTransition(res, "The latest version is already a draft — edit it instead.");
  await prisma.kbArticleVersion.create({
    data: {
      organizationId: req.organizationId, articleId: article.id, versionNumber: latest.versionNumber + 1,
      title: text(req.body.title, 200) || latest.title, summary: "summary" in req.body ? text(req.body.summary, 1000) : latest.summary,
      body: text(req.body.body, 100000) || latest.body, changeNote: text(req.body.changeNote, 500), authorMembershipId: who(req),
    },
  });
  await audit(req, "support.kb_article.version_created", "KbArticle", article.id);
  await saved(res, article.id, 201);
}

async function step(req, res, { from, to, articleStatus, check, auditAction, data = {} }) {
  const article = await loadArticle(req, res);
  if (!article) return;
  if (article.archivedAt) return badTransition(res, "This article is archived.");
  if (staleVersion(req.body, article)) return versionConflict(res, "article");
  const latest = latestVersion(article);
  if (latest.reviewStatus !== from) return badTransition(res, `The latest version is ${latest.reviewStatus}; it must be ${from}.`);
  const blocked = check?.(latest);
  if (blocked) return blocked(res);
  await prisma.$transaction(async (tx) => {
    await tx.kbArticleVersion.update({ where: { id: latest.id }, data: { reviewStatus: to, ...data, version: { increment: 1 } } });
    if (articleStatus) await tx.kbArticle.update({ where: { id: article.id }, data: { status: articleStatus, version: { increment: 1 } } });
  });
  await audit(req, auditAction, "KbArticle", article.id, { reason: data.reviewReason, after: { versionNumber: latest.versionNumber } });
  await saved(res, article.id);
}

export const submit = (req, res) => step(req, res, { from: "Draft", to: "In Review", articleStatus: "In Review", auditAction: "support.kb_article.submitted" });

export function approve(req, res) {
  return step(req, res, {
    from: "In Review", to: "Approved", articleStatus: "Approved", auditAction: "support.kb_article.approved",
    check: (v) => (v.authorMembershipId && v.authorMembershipId === who(req) ? (r) => forbid(r, "You can't approve your own article.") : null),
    data: { reviewerMembershipId: who(req), reviewedAt: new Date(), reviewReason: text(req.body.reason, 1000) },
  });
}

export function reject(req, res) {
  const reason = text(req.body.reason, 1000);
  if (!reason) return invalid(res, "A reason is required to reject an article.");
  return step(req, res, {
    from: "In Review", to: "Rejected", articleStatus: "Draft", auditAction: "support.kb_article.rejected",
    check: (v) => (v.authorMembershipId && v.authorMembershipId === who(req) ? (r) => forbid(r, "You can't review your own article.") : null),
    data: { reviewerMembershipId: who(req), reviewedAt: new Date(), reviewReason: reason },
  });
}

// Publishing makes the approved version the one customers (if the article
// is customer-visible) and staff read. Published versions never change.
export async function publish(req, res) {
  const article = await loadArticle(req, res);
  if (!article) return;
  if (article.archivedAt) return badTransition(res, "This article is archived.");
  if (staleVersion(req.body, article)) return versionConflict(res, "article");
  const latest = latestVersion(article);
  if (latest.reviewStatus !== "Approved") return badTransition(res, "Only an approved version can be published.");
  if (latest.authorMembershipId && latest.authorMembershipId === who(req) && !req.isSystemOwnerOverride) return forbid(res, "You can't publish your own article.");
  if (!hasGrant(req, "knowledge_base", "publish")) return res.status(403).json({ code: "RBAC_FORBIDDEN", message: "You don't have permission to publish articles." });
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    if (article.currentVersionId) await tx.kbArticleVersion.update({ where: { id: article.currentVersionId }, data: { reviewStatus: "Superseded" } });
    await tx.kbArticleVersion.update({ where: { id: latest.id }, data: { reviewStatus: "Published", publishedAt: now, publishedByMembershipId: who(req), version: { increment: 1 } } });
    await tx.kbArticle.update({
      where: { id: article.id },
      data: { status: "Published", currentVersionId: latest.id, publishedAt: now, title: latest.title, summary: latest.summary, reviewerMembershipId: latest.reviewerMembershipId, version: { increment: 1 } },
    });
  });
  await audit(req, "support.kb_article.published", "KbArticle", article.id, { after: { versionNumber: latest.versionNumber } });
  await saved(res, article.id);
}

export async function archive(req, res) {
  const article = await loadArticle(req, res);
  if (!article) return;
  if (article.archivedAt) return badTransition(res, "This article is already archived.");
  await prisma.kbArticle.update({ where: { id: article.id }, data: { status: "Archived", archivedAt: new Date(), version: { increment: 1 } } });
  await audit(req, "support.kb_article.archived", "KbArticle", article.id, { reason: text(req.body.reason, 500) });
  await saved(res, article.id);
}
