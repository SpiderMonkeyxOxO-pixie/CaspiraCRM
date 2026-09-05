// In-memory mock Projects/Tasks "database" — same pattern as the other mock*Data files.
import { faker } from "@faker-js/faker";
import { companies } from "./mockCrmData";

const id = () => faker.database.mongodbObjectId();

function makeMilestone(overrides = {}) {
  return {
    _id: id(),
    name: faker.helpers.arrayElement(["Kickoff", "Design Sign-off", "Beta Release", "Go-Live", "Handover"]),
    dueDate: faker.date.soon({ days: 45 }).toISOString(),
    completed: false,
    ...overrides,
  };
}

function makeProject(overrides = {}) {
  const company = faker.helpers.arrayElement(companies);
  return {
    _id: id(),
    name: `${company.name} Onboarding`,
    companyId: company._id,
    companyName: company.name,
    dealId: null,
    status: faker.helpers.arrayElement(["Planning", "Active", "On Hold"]),
    owner: faker.person.fullName(),
    startDate: faker.date.recent({ days: 20 }).toISOString(),
    dueDate: faker.date.soon({ days: 60 }).toISOString(),
    description: faker.lorem.sentence(),
    customerVisible: faker.datatype.boolean(),
    milestones: faker.helpers.multiple(() => makeMilestone(), { count: faker.number.int({ min: 1, max: 3 }) }),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeTask(projectId, overrides = {}) {
  return {
    _id: id(),
    projectId,
    title: faker.hacker.phrase(),
    description: faker.lorem.sentence(),
    assignee: faker.person.fullName(),
    watchers: [],
    priority: faker.helpers.arrayElement(["Low", "Medium", "High", "Urgent"]),
    status: faker.helpers.arrayElement(["To Do", "In Progress", "Review", "Done"]),
    dueDate: faker.date.soon({ days: 21 }).toISOString(),
    estimateHours: faker.number.int({ min: 2, max: 24 }),
    loggedHours: 0,
    timeEntries: [],
    dependsOn: null,
    recurring: false,
    comments: [],
    createdAt: faker.date.recent({ days: 10 }).toISOString(),
    ...overrides,
  };
}

export const projects = faker.helpers.multiple(() => makeProject(), { count: 6 });
export const tasks = projects.flatMap((p) =>
  faker.helpers.multiple(() => makeTask(p._id), { count: faker.number.int({ min: 3, max: 7 }) })
);

export function findProject(projectId) {
  return projects.find((p) => p._id === projectId);
}

export function createProjectRecord(payload) {
  const project = makeProject({ ...payload, milestones: [], status: "Planning" });
  projects.unshift(project);
  return project;
}

export function updateProjectRecord(projectId, changes) {
  const project = findProject(projectId);
  if (!project) return null;
  Object.assign(project, changes);
  return project;
}

export function addMilestoneRecord(projectId, name, dueDate) {
  const project = findProject(projectId);
  if (!project) return null;
  project.milestones.push(makeMilestone({ name, dueDate: dueDate || faker.date.soon({ days: 30 }).toISOString() }));
  return project;
}

export function toggleMilestoneRecord(projectId, milestoneId) {
  const project = findProject(projectId);
  if (!project) return null;
  const milestone = project.milestones.find((m) => m._id === milestoneId);
  if (milestone) milestone.completed = !milestone.completed;
  return project;
}

export function findTask(taskId) {
  return tasks.find((t) => t._id === taskId);
}

export function createTaskRecord(payload) {
  const task = makeTask(payload.projectId, {
    ...payload,
    status: "To Do",
    loggedHours: 0,
    timeEntries: [],
    comments: [],
    createdAt: new Date().toISOString(),
  });
  tasks.unshift(task);
  return task;
}

export function updateTaskRecord(taskId, changes) {
  const task = findTask(taskId);
  if (!task) return null;
  Object.assign(task, changes);
  return task;
}

export function addTaskCommentRecord(taskId, message, author) {
  const task = findTask(taskId);
  if (!task) return null;
  task.comments.push({ message, author: author || "You", at: new Date().toISOString() });
  return task;
}

export function logTaskTimeRecord(taskId, hours, note, author) {
  const task = findTask(taskId);
  if (!task) return null;
  task.timeEntries.push({ hours: Number(hours), note, author: author || "You", at: new Date().toISOString() });
  task.loggedHours = (task.loggedHours || 0) + Number(hours);
  return task;
}

// The "won deal" cascade extension: creates a Project with an onboarding
// checklist (milestone + starter tasks) for the newly-won customer.
export function createOnboardingProject({ companyId, companyName, dealId, owner }) {
  const project = makeProject({
    name: `${companyName} Onboarding`,
    companyId,
    companyName,
    dealId,
    owner: owner || "Unassigned",
    status: "Planning",
    customerVisible: true,
    milestones: [makeMilestone({ name: "Kickoff", completed: false })],
  });
  projects.unshift(project);

  const starterTasks = [
    "Schedule kickoff call",
    "Send welcome packet",
    "Provision customer account",
    "Assign onboarding specialist",
  ];
  const createdTasks = starterTasks.map((title, i) =>
    makeTask(project._id, {
      title,
      status: "To Do",
      priority: i === 0 ? "High" : "Medium",
      assignee: owner || null,
      comments: [],
      timeEntries: [],
      loggedHours: 0,
    })
  );
  tasks.unshift(...createdTasks);

  return { project, tasks: createdTasks };
}
