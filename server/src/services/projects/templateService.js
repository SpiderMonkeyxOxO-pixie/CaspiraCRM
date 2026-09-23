// Backend Phase 5 — project templates. A template version's content is
// plain data, validated here; creating a project from it copies everything
// into independent records (later template edits never touch the project).
//
// content = {
//   phases:       [{ name }],
//   columns:      [{ name, category, wipLimit?, isCompletion? }]   (optional; default board otherwise)
//   milestones:   [{ name, offsetDays, phase?, acceptanceRequired?, customerVisible? }],
//   tasks:        [{ key, title, phase?, milestone?, offsetDays?, estimateMinutes?, priority?, checklist?: [title] }],
//   dependencies: [{ from, to, type? }]   (task keys; from = predecessor)
//   roles:        [role names suggested for members]
// }
import { COLUMN_CATEGORIES, DEPENDENCY_TYPES, PROJECT_ROLES, TASK_PRIORITIES } from "./projectRulesService.js";

const MAX_ITEMS = 500;
const isList = (v) => Array.isArray(v) && v.length <= MAX_ITEMS;
const named = (x) => typeof x?.name === "string" && x.name.trim();

export function validateTemplateContent(content) {
  if (!content || typeof content !== "object") return "content is required.";
  const { phases = [], columns = [], milestones = [], tasks = [], dependencies = [], roles = [] } = content;
  for (const [label, list] of Object.entries({ phases, columns, milestones, tasks, dependencies, roles })) {
    if (!isList(list)) return `${label} must be a list (at most ${MAX_ITEMS}).`;
  }
  if (phases.some((p) => !named(p))) return "Every phase needs a name.";
  const phaseNames = new Set(phases.map((p) => p.name));
  if (columns.some((c) => !named(c) || !COLUMN_CATEGORIES.includes(c.category))) return `Every column needs a name and a category (${COLUMN_CATEGORIES.join(", ")}).`;
  if (columns.length && !columns.some((c) => c.category === "Completed")) return "The columns need one Completed column.";
  if (milestones.some((m) => !named(m) || !Number.isInteger(m.offsetDays ?? 0) || (m.phase && !phaseNames.has(m.phase)))) return "Every milestone needs a name, whole-day offsetDays and (optionally) an existing phase.";
  const milestoneNames = new Set(milestones.map((m) => m.name));
  const keys = new Set();
  for (const t of tasks) {
    if (!t?.key || !t?.title?.trim()) return "Every task needs a key and a title.";
    if (keys.has(t.key)) return `Task key "${t.key}" is used twice.`;
    keys.add(t.key);
    if (t.phase && !phaseNames.has(t.phase)) return `Task "${t.title}" refers to an unknown phase.`;
    if (t.milestone && !milestoneNames.has(t.milestone)) return `Task "${t.title}" refers to an unknown milestone.`;
    if (t.priority && !TASK_PRIORITIES.includes(t.priority)) return `Task "${t.title}" has an unknown priority.`;
    if (t.estimateMinutes !== undefined && !(Number.isInteger(t.estimateMinutes) && t.estimateMinutes >= 0)) return `Task "${t.title}": estimateMinutes must be whole minutes.`;
    if (t.checklist && (!isList(t.checklist) || t.checklist.some((c) => typeof c !== "string" || !c.trim()))) return `Task "${t.title}": checklist must list item titles.`;
  }
  for (const d of dependencies) {
    if (!keys.has(d.from) || !keys.has(d.to) || d.from === d.to) return "Dependencies must link two different task keys.";
    if (d.type && !DEPENDENCY_TYPES.includes(d.type)) return `Unknown dependency type "${d.type}".`;
  }
  if (hasCycle(tasks.map((t) => t.key), dependencies)) return "The template's dependencies form a loop.";
  if (roles.some((r) => !PROJECT_ROLES.includes(r))) return `roles must be from ${PROJECT_ROLES.join(", ")}.`;
  return null;
}

function hasCycle(keys, deps) {
  const next = new Map(keys.map((k) => [k, []]));
  for (const d of deps) next.get(d.from)?.push(d.to);
  const state = new Map();
  const visit = (k) => {
    if (state.get(k) === 1) return true;
    if (state.get(k) === 2) return false;
    state.set(k, 1);
    for (const n of next.get(k) || []) if (visit(n)) return true;
    state.set(k, 2);
    return false;
  };
  return keys.some((k) => visit(k));
}

const DAY = 86400000;
export const offsetDate = (start, days) => (start && Number.isInteger(days) ? new Date(new Date(start).getTime() + days * DAY) : null);

// What creating a project from this version would produce.
export function templatePreview(content, startDate) {
  return {
    phases: (content.phases || []).map((p) => p.name),
    columns: (content.columns || []).length ? content.columns.map((c) => c.name) : ["To Do", "In Progress", "Review", "Done"],
    milestones: (content.milestones || []).map((m) => ({ name: m.name, dueDate: offsetDate(startDate, m.offsetDays ?? 0) })),
    tasks: (content.tasks || []).map((t) => ({ title: t.title, dueDate: offsetDate(startDate, t.offsetDays), checklistItems: (t.checklist || []).length })),
    dependencies: (content.dependencies || []).length,
    suggestedRoles: content.roles || [],
  };
}
