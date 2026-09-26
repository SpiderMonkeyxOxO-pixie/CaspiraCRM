// Projects page guides. Plain language for everyday staff; tour targets are
// data-tour="…" attributes on the pages.
const task =
  "Click a task to open it. There you can change its status, priority and assignee, log the hours you spent, and leave comments for the team.";

const projects = [
  {
    path: "/projects",
    title: "Projects",
    purpose: "A project is a piece of delivery work, usually for a customer: an onboarding, an installation, a build. Each project has tasks, a board and milestones so everyone can see what is done and what is next.",
    sections: [
      { heading: "Creating a project", body: "New Project asks for a name and, if you like, the customer company, an owner, a due date and a description. Leave Owner as Me to own it yourself." },
      { heading: "Summary", body: "Total counts all projects. Overdue counts unfinished projects past their due date. Avg. Completion is the average share of finished tasks. Click a bar in By Status to show only those projects; click it again to show all." },
      { heading: "Project cards", body: "Each card shows the status, the company, how many of its tasks are done, and the due date. Click a card to open the project." },
      { heading: "Statuses", body: "Planning, Active, On Hold, At Risk, Completed and Cancelled. Change a project's status at the top right of the project." },
    ],
    tips: ["Progress comes from tasks marked Done, so keep task statuses up to date."],
    tour: [
      { target: "projects-add", title: "Start a project", body: "Give it a name, and optionally a customer company, owner and due date." },
      { target: "projects-summary", title: "All projects at a glance", body: "How many there are, how many are overdue, average completion, and a breakdown by status. Click a bar to filter." },
      { target: "projects-cards", title: "Your projects", body: "Each card shows status, progress and due date. Click one to open it." },
    ],
  },
  {
    path: "/projects/tasks",
    title: "All Tasks",
    purpose: "Every task from every project in one list, so you can see your own work, or your team's, without opening each project.",
    sections: [
      { heading: "Filters", body: "Choose an assignee to see one person's tasks, or a status to see, for example, everything in Review." },
      { heading: "The task list", body: "Change a task's status right in the list. Click the project name to go to that project's tasks. Overdue tasks are shown in red." },
      { heading: "Task details", body: task },
    ],
    tips: ["Pick yourself as the assignee and To Do as the status for your to-do list."],
    tour: [
      { target: "tasks-filters", title: "Narrow the list", body: "Filter by assignee and status." },
      { target: "tasks-table", title: "Every task", body: "Change a status straight from the list, or click a task to open it." },
    ],
  },
  {
    path: "/projects/:id/overview",
    title: "Project overview",
    purpose: "How one project is going: progress, finished tasks, overdue work and time spent.",
    sections: [
      { heading: "Figures", body: "Progress is the share of tasks marked Done. Tasks shows done out of total. Overdue counts unfinished tasks past their due date. Time Logged compares the hours logged with the hours estimated." },
      { heading: "Status", body: "Change the project's status with the drop-down at the top right, for example to On Hold or At Risk." },
      { heading: "Tabs", body: "Tasks is the task list, Board shows tasks as columns by status, and Milestones lists the key dates." },
      { heading: "Overdue tasks", body: "When tasks are late, they are listed at the bottom so you can follow them up." },
    ],
    tour: [
      { target: "project-status", title: "Project status", body: "Set where the project stands: Planning, Active, On Hold, At Risk, Completed or Cancelled." },
      { target: "project-tabs", title: "Views of the project", body: "Overview, the task list, the board and the milestones." },
      { target: "project-kpis", title: "How it is going", body: "Progress, tasks done, overdue tasks and hours logged against the estimate." },
    ],
  },
  {
    path: "/projects/:id/tasks",
    title: "Project tasks",
    purpose: "The to-do list for this project: who does what, by when.",
    sections: [
      { heading: "Adding a task", body: "New Task asks for a title, an assignee, a priority, a due date and an estimate of the hours it will take." },
      { heading: "Working on a task", body: task },
    ],
    tour: [
      { target: "project-tasks-add", title: "Add a task", body: "Give it a title, someone to do it, a priority, a due date and an estimate." },
      { target: "project-tasks-table", title: "The task list", body: "Overdue due dates are shown in red. Click a task to open it." },
    ],
  },
  {
    path: "/projects/:id/board",
    title: "Project board",
    purpose: "The project's tasks as cards in columns: To Do, In Progress, Review and Done. See at a glance what is moving and what is stuck.",
    sections: [
      { heading: "Moving tasks", body: "Click the arrow on a card to move it to the next column. To move it back, open the task and change its status." },
      { heading: "Cards", body: "Each card shows the priority, the assignee and the due date. A ⚠ and red date mean the task is overdue. Click the title to open the task." },
    ],
    tour: [
      { target: "project-board", title: "The board", body: "One column per status. Use the arrow on a card to move it along, or click the title to open it." },
    ],
  },
  {
    path: "/projects/:id/milestones",
    title: "Milestones",
    purpose: "The key dates of the project, such as \"Design approved\" or \"Go live\". Tick them off as they are reached.",
    sections: [
      { heading: "Adding a milestone", body: "Add Milestone asks for a name and, optionally, a due date." },
      { heading: "Completing", body: "Click a milestone to mark it reached; click again to undo." },
    ],
    tour: [
      { target: "milestones-add", title: "Add a milestone", body: "Name a key moment in the project and give it a date." },
      { target: "milestones-list", title: "Key dates", body: "Click a milestone to tick it off when it is reached." },
    ],
  },
];

export default projects;
