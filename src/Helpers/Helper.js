import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Tooltip,
  Legend,
} from "chart.js";
import {
  Megaphone,
  Handshake,
  ShoppingCart,
  Headset,
  ListTodo,
  Wallet,
  ShieldCheck,
  Sparkles,
  Blocks,
} from "lucide-react";

// Register the required components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Tooltip,
  Legend
);
// Each top-level nav entry's `children` drives the sidebar accordion, which
// is now the only place these sub-routes are listed (the per-module top tab
// bars were removed as duplicate navigation once this existed).
const CRM_CHILDREN = [
  { to: "/crm/dashboard", label: "Dashboard" },
  { to: "/crm/leads", label: "Leads" },
  { to: "/crm/activities", label: "Activities" },
  { to: "/crm/companies", label: "Companies" },
  { to: "/crm/contacts", label: "Contacts" },
  { to: "/crm/deals", label: "Deals" },
  { to: "/crm/pipeline", label: "Pipeline" },
  { to: "/crm/import", label: "Import" },
  { to: "/crm/duplicates", label: "Duplicates" },
];

const SALES_CHILDREN = [
  { to: "/sales/dashboard", label: "Dashboard" },
  { to: "/sales/products", label: "Products & Services" },
  { to: "/sales/price-books", label: "Price Books" },
  { to: "/sales/quotes", label: "Quotes" },
  { to: "/sales/orders", label: "Orders" },
  { to: "/sales/contracts", label: "Contracts" },
];

const SUPPORT_CHILDREN = [
  { to: "/support/dashboard", label: "Dashboard" },
  { to: "/support/tickets", label: "Tickets" },
];

const PROJECTS_CHILDREN = [
  { to: "/projects", label: "All Projects" },
  { to: "/projects/tasks", label: "All Tasks" },
];

const MARKETING_CHILDREN = [
  { to: "/marketing/dashboard", label: "Dashboard" },
  { to: "/marketing/campaigns", label: "Campaigns" },
  { to: "/marketing/segments", label: "Segments" },
  { to: "/marketing/forms", label: "Forms" },
  { to: "/marketing/templates", label: "Templates" },
];

const FINANCE_CHILDREN = [
  { to: "/finance/dashboard", label: "Dashboard" },
  { to: "/finance/invoices", label: "Invoices" },
  { to: "/finance/payments", label: "Payments" },
  { to: "/finance/credit-notes", label: "Credit Notes" },
  { to: "/finance/expenses", label: "Expenses" },
  { to: "/finance/recurring-invoices", label: "Recurring" },
];

// Backend mode (VITE_BACKEND_FINANCE_MODE): the Finance section is built
// from the member's real Finance grants instead of their login role, so a
// Finance Manager or Accountant (login role "User") gets the right links.
// Each link names the grant it needs ("any" = any Finance access).
export const FINANCE_BACKEND_CHILDREN = [
  { to: "/finance/dashboard", label: "Dashboard", requires: [["invoices", "view"], ["finance_reports", "view"]] },
  { to: "/finance/approvals", label: "Approvals & Posting", requires: "any" },
  { to: "/finance/invoices", label: "Invoices", requires: [["invoices", "view"]] },
  { to: "/finance/payments", label: "Payments", requires: [["payments", "view"]] },
  { to: "/finance/credit-notes", label: "Credit Notes", requires: [["invoices", "view"]] },
  { to: "/finance/expenses", label: "Expenses", requires: [["expenses", "view"]] },
  { to: "/finance/recurring-invoices", label: "Recurring", requires: [["recurring_invoices", "view"]] },
  { to: "/finance/reports", label: "Reports", requires: [["finance_reports", "view"]] },
  { to: "/finance/setup", label: "Setup", requires: [["finance_configuration", "view"], ["fiscal_periods", "view"], ["financial_accounts", "view"]] },
];
export const FINANCE_NAV_ICON = Wallet;

const AI_CHILDREN = [
  { to: "/ai/overview", label: "Overview" },
  { to: "/ai/copilot", label: "Copilot" },
];

const USERS_ACCESS_CHILDREN = [
  { to: "/admin/users", label: "Members" },
  { to: "/admin/invitations", label: "Invitations" },
  { to: "/admin/invite-links", label: "Invite Links" },
  { to: "/admin/roles", label: "Roles & Permissions" },
  { to: "/admin/access-audit", label: "Access Audit" },
];

const INTEGRATIONS_CHILDREN = [
  { to: "/admin/integrations", label: "Overview" },
  { to: "/admin/integrations/marketplace", label: "Marketplace" },
  { to: "/admin/integrations/activity", label: "Activity" },
  { to: "/admin/integrations/webhooks", label: "Webhooks" },
  // Sales & Marketing (Phase 4) and Support & Communication (Phase 3) both
  // link only to their own Overview page, matching how Marketplace/Activity/
  // Webhooks are the only Phase 1 sidebar children (not every Phase 1
  // sub-page) — the remaining sub-routes are reached via each Overview
  // page's own navigation. No capability-based filtering happens here for
  // any Integration Center entry; each page enforces its own RBAC and
  // renders a permission-denied message for a role without access.
  { to: "/admin/integrations/sales-marketing", label: "Sales & Marketing" },
  { to: "/admin/integrations/support-communication", label: "Support & Communication" },
  { to: "/admin/integrations/projects-development", label: "Projects & Development" },
  { to: "/admin/integrations/commerce-finance", label: "Commerce & Finance" },
  { to: "/admin/integrations/documents-storage", label: "Documents & Storage" },
  { to: "/admin/integrations/ai-providers", label: "AI Providers" },
];

export const superAdminButtons = () => [
  { to: "/crm/dashboard", label: ("CRM"), icon: Handshake, children: CRM_CHILDREN },
  { to: "/sales/dashboard", label: ("Sales"), icon: ShoppingCart, children: SALES_CHILDREN },
  { to: "/support/dashboard", label: ("Support"), icon: Headset, children: SUPPORT_CHILDREN },
  { to: "/projects", label: ("Projects"), icon: ListTodo, children: PROJECTS_CHILDREN },
  { to: "/marketing/dashboard", label: ("Marketing"), icon: Megaphone, children: MARKETING_CHILDREN },
  { to: "/finance/dashboard", label: ("Finance"), icon: Wallet, children: FINANCE_CHILDREN },
  { to: "/ai/overview", label: ("AI Intelligence"), icon: Sparkles, children: AI_CHILDREN },
  { to: "/admin/users", label: ("Users & Access"), icon: ShieldCheck, children: USERS_ACCESS_CHILDREN },
  { to: "/admin/integrations", label: ("Integrations"), icon: Blocks, children: INTEGRATIONS_CHILDREN },
];

// Admin has the same access as Super-Admin
export const AdminRoutes = () => superAdminButtons();

// ✅ Team Buttons
export const TeamButtons = () => [
  { to: "/crm/dashboard", label: ("CRM"), icon: Handshake, children: CRM_CHILDREN },
  { to: "/sales/dashboard", label: ("Sales"), icon: ShoppingCart, children: SALES_CHILDREN },
  { to: "/support/dashboard", label: ("Support"), icon: Headset, children: SUPPORT_CHILDREN },
  { to: "/projects", label: ("Projects"), icon: ListTodo, children: PROJECTS_CHILDREN },
  { to: "/ai/overview", label: ("AI Intelligence"), icon: Sparkles, children: AI_CHILDREN },
];

// ✅ User Routes
export const UserRoutes = () => [
  { to: "/crm/dashboard", label: ("CRM"), icon: Handshake, children: CRM_CHILDREN },
  { to: "/sales/dashboard", label: ("Sales"), icon: ShoppingCart, children: SALES_CHILDREN },
  { to: "/support/dashboard", label: ("Support"), icon: Headset, children: SUPPORT_CHILDREN },
  { to: "/ai/overview", label: ("AI Intelligence"), icon: Sparkles, children: AI_CHILDREN },
];

// ✅ Checker Buttons
export const CheckerButtons = () => [
  { to: "/finance/dashboard", label: ("Finance"), icon: Wallet, children: FINANCE_CHILDREN },
  { to: "/ai/overview", label: ("AI Intelligence"), icon: Sparkles, children: AI_CHILDREN },
];


export const userData = {
  labels: ["QUOTA", "NON-QUOTA"],
  datasets: [
    {
      label: "Toatal Usage",

      data: [62.32, 76],
      backgroundColor: ["#615fff", "#00A6B4"],
      borderColor: ["#615fff", "#00A6B4"],
      borderWidth: 1,
    },
  ],
};

export const lineData = {
  labels: ["MON", "TUE", "WED", "THUR", "FRI", "SAT", "SUN"],
  datasets: [
    {
      label: "Morning Shift",
      data: [3, 4, 6, 5, 6, 7, 8],
      backgroundColor: "rgba(75, 192, 192, 0.6)",
      borderColor: "rgba(75, 192, 192, 1)",
      borderWidth: 1,
      tension: 0.4,
    },
    {
      label: "Night Shift",
      data: [4, 5, 7, 6, 7],
      borderColor: "#999",
      tension: 0.4,
    },
  ],
};
export const lineOptions = {
  plugins: {
    legend: {
      labels: {
        color: "#fff",
      },
    },
  },
  scales: {
    x: {
      ticks: { color: "#fff" },
    },
    y: {
      ticks: { color: "#fff" },
    },
  },
};
export const columns = [
  { field: "date", headerName: "DATE", width: 120 },
  { field: "name", headerName: "NAME", width: 150 },
  { field: "role", headerName: "ROLE", width: 150 },
  { field: "department", headerName: "DEPARTMENT", width: 150 },
  { field: "output", headerName: "OUTPUT", width: 100 },
  { field: "target", headerName: "TARGET QUOTA", width: 150 },
  { field: "variance", headerName: "VARIANCE", width: 100 },
];

export const rows = [
  {
    id: 1,
    date: "2025-10-08",
    name: "Ankit",
    role: "CSR",
    department: "Customer Support",
    output: 1450,
    target: 1500,
    variance: -50,
  },
  {
    id: 2,
    date: "2025-10-08",
    name: "Riya",
    role: "Analyst",
    department: "Withdrawals",
    output: 900,
    target: 900,
    variance: 0,
  },
  {
    id: 3,
    date: "2025-10-08",
    name: "Shyam",
    role: "Officer",
    department: "Deposits",
    output: 430,
    target: 450,
    variance: -20,
  },
];

export const leadData = [
  {
    stage: "Lead",
    sum: "$8,000",
    weighted: "$800",
    client: "Tripster",
    region: "APAC",
    industry: "Travel",
    amount: "$8,000",
    seats: 4,
    date: "2015-11-30",
    progress: 10,
    nextStep: "Qualify budget",
  },
  {
    stage: "Lead",
    sum: "$12,500",
    weighted: "$1,250",
    client: "Orbit Corp",
    region: "EMEA",
    industry: "Finance",
    amount: "$12,500",
    seats: 6,
    date: "2016-01-12",
    progress: 20,
    nextStep: "Intro meeting",
  },
  {
    stage: "Lead",
    sum: "$5,000",
    weighted: "$500",
    client: "Nexa Labs",
    region: "US",
    industry: "Tech",
    amount: "$5,000",
    seats: 3,
    date: "2016-05-22",
    progress: 30,
    nextStep: "Demo scheduled",
  },
  {
    stage: "Lead",
    sum: "$9,000",
    weighted: "$900",
    client: "GeoSoft",
    region: "APAC",
    industry: "SaaS",
    amount: "$9,000",
    seats: 5,
    date: "2017-03-17",
    progress: 40,
    nextStep: "Decision pending",
  },
];



export const weeklyData = {
  summary: {
    daysPresent: 5,
    hoursWorked: "43h 30m",
    breaks: "6h 15m",
    attendance: "95%",
  },
  records: [
    {
      date: "Mon, Oct 14, 2025",
      punchIn: "08:00 AM",
      breaks: "1h 00m",
      punchOut: "05:00 PM",
      totalHours: "8h 00m",
      status: "Normal",
    },
    {
      date: "Tue, Oct 15, 2025",
      punchIn: "08:05 AM",
      breaks: "1h 15m",
      punchOut: "05:10 PM",
      totalHours: "7h 50m",
      status: "Overbreak",
    },
    {
      date: "Wed, Oct 16, 2025",
      punchIn: "--",
      breaks: "1h 00m",
      punchOut: "05:00 PM",
      totalHours: "--",
      status: "Missed Punch In",
    },
    {
      date: "Thu, Oct 17, 2025",
      punchIn: "08:00 AM",
      breaks: "1h 00m",
      punchOut: "--",
      totalHours: "--",
      status: "Missed Punch Out",
    },
    {
      date: "Fri, Oct 18, 2025",
      punchIn: "--",
      breaks: "--",
      punchOut: "--",
      totalHours: "--",
      status: "Absent",
    },
  ],
};

export const monthlyData = {
  summary: {
    daysPresent: 22,
    hoursWorked: "176h 45m",
    breaks: "24h 30m",
    attendance: "92%",
  },
  records: [
    {
      date: "Week 1 (Oct 1-7)",
      punchIn: "Avg: 08:02 AM",
      breaks: "7h 30m",
      punchOut: "Avg: 05:05 PM",
      totalHours: "40h 15m",
      status: "Normal",
    },
    {
      date: "Week 2 (Oct 8-14)",
      punchIn: "Avg: 08:00 AM",
      breaks: "6h 00m",
      punchOut: "Avg: 05:00 PM",
      totalHours: "43h 00m",
      status: "Normal",
    },
    {
      date: "Week 3 (Oct 15-21)",
      punchIn: "Avg: 08:03 AM",
      breaks: "5h 45m",
      punchOut: "Avg: 05:02 PM",
      totalHours: "41h 30m",
      status: "Normal",
    },
    {
      date: "Week 4 (Oct 22-28)",
      punchIn: "Avg: 08:01 AM",
      breaks: "5h 15m",
      punchOut: "Avg: 05:01 PM",
      totalHours: "42h 00m",
      status: "Normal",
    },
    {
      date: "Week 5 (Oct 29-31)",
      punchIn: "Avg: 08:00 AM",
      breaks: "--",
      punchOut: "Avg: 05:00 PM",
      totalHours: "10h 00m",
      status: "Partial",
    },
  ],
};

export const overallAttendance = {
  presentToday: 142,
  absentToday: 8,
  lateArrivals: 5,
  onLeave: 3,
  attendanceRate: "95%",
};



// Schedule data for the bottom table
export const scheduleData = [
  {
    id: 1,
    dateHired: "14-Feb-25",
    team: "Deposit",
    position: "Staff",
    name: "Ashish Prabhakar",
    schedule: "16:00 - 04:00",
    remarks: "12 hrs",
    schedule_days: {
      nov4: "D",
      nov5: "N",
      nov6: "N",
      nov7: "D",
      nov8: "D",
      nov9: "RD",
      nov10: "N",
      nov11: "D",
      nov12: "N",
      nov13: "D",
      nov14: "N",
      nov15: "RD",
      nov16: "N",
      nov17: "D",
      nov18: "N",
      nov19: "D",
      nov20: "N",
      nov21: "RD",
      nov22: "D",
      nov23: "N",
      nov24: "D",
      nov25: "N",
      nov26: "RD",
      nov27: "D",
      nov28: "N",
      nov29: "D",
      nov30: "N",
    },
  },
  {
    id: 2,
    dateHired: "7-Mar-25",
    team: "Deposit",
    position: "Staff",
    name: "Lekh Raj",
    schedule: "16:00 - 04:00",
    remarks: "12 hrs",
    schedule_days: {
      nov4: "D",
      nov5: "D",
      nov6: "RD",
      nov7: "N",
      nov8: "N",
      nov9: "N",
      nov10: "D",
      nov11: "D",
      nov12: "RD",
      nov13: "N",
      nov14: "N",
      nov15: "D",
      nov16: "D",
      nov17: "RD",
      nov18: "N",
      nov19: "N",
      nov20: "D",
      nov21: "D",
      nov22: "RD",
      nov23: "N",
      nov24: "N",
      nov25: "D",
      nov26: "D",
      nov27: "RD",
      nov28: "N",
      nov29: "N",
      nov30: "D",
    },
  },
  {
    id: 3,
    dateHired: "16-Nov-24",
    team: "CSR",
    position: "Agent",
    name: "Chandan Aheer",
    schedule: "16:00 - 04:00",
    remarks: "12 hrs",
    schedule_days: {
      nov4: "N",
      nov5: "N",
      nov6: "D",
      nov7: "RD",
      nov8: "N",
      nov9: "N",
      nov10: "D",
      nov11: "RD",
      nov12: "N",
      nov13: "D",
      nov14: "N",
      nov15: "N",
      nov16: "RD",
      nov17: "D",
      nov18: "N",
      nov19: "RD",
      nov20: "D",
      nov21: "N",
      nov22: "N",
      nov23: "D",
      nov24: "RD",
      nov25: "N",
      nov26: "D",
      nov27: "N",
      nov28: "RD",
      nov29: "D",
      nov30: "N",
    },
  },
  {
    id: 4,
    dateHired: "12-Jan-25",
    team: "CSR",
    position: "Senior",
    name: "harish Kumar",
    schedule: "16:00 - 04:00",
    remarks: "12 hrs",
    schedule_days: {
      nov4: "D",
      nov5: "D",
      nov6: "N",
      nov7: "N",
      nov8: "RD",
      nov9: "D",
      nov10: "D",
      nov11: "N",
      nov12: "N",
      nov13: "RD",
      nov14: "D",
      nov15: "D",
      nov16: "N",
      nov17: "N",
      nov18: "RD",
      nov19: "D",
      nov20: "D",
      nov21: "N",
      nov22: "N",
      nov23: "RD",
      nov24: "D",
      nov25: "D",
      nov26: "N",
      nov27: "N",
      nov28: "RD",
      nov29: "D",
      nov30: "D",
    },
  },
  {
    id: 5,
    dateHired: "20-Aug-24",
    team: "Withdrawal",
    position: "Staff",
    name: "Sukhminder Singh",
    schedule: "16:00 - 04:00",
    remarks: "12 hrs",
    schedule_days: {
      nov4: "D",
      nov5: "N",
      nov6: "D",
      nov7: "N",
      nov8: "RD",
      nov9: "N",
      nov10: "N",
      nov11: "D",
      nov12: "N",
      nov13: "RD",
      nov14: "D",
      nov15: "N",
      nov16: "D",
      nov17: "N",
      nov18: "RD",
      nov19: "N",
      nov20: "D",
      nov21: "N",
      nov22: "D",
      nov23: "RD",
      nov24: "N",
      nov25: "D",
      nov26: "N",
      nov27: "D",
      nov28: "N",
      nov29: "RD",
      nov30: "N",
    },
  },
];

export const days = [
  { day: "FRI", date: "NOV 4", key: "nov4" },
  { day: "SAT", date: "NOV 5", key: "nov5" },
  { day: "SUN", date: "NOV 6", key: "nov6" },
  { day: "MON", date: "NOV 7", key: "nov7" },
  { day: "TUE", date: "NOV 8", key: "nov8" },
  { day: "WED", date: "NOV 9", key: "nov9" },
  { day: "THU", date: "NOV 10", key: "nov10" },
  { day: "FRI", date: "NOV 11", key: "nov11" },
  { day: "SAT", date: "NOV 12", key: "nov12" },
  { day: "SUN", date: "NOV 13", key: "nov13" },
  { day: "MON", date: "NOV 14", key: "nov14" },
  { day: "TUE", date: "NOV 15", key: "nov15" },
  { day: "WED", date: "NOV 16", key: "nov16" },
  { day: "THU", date: "NOV 17", key: "nov17" },
  { day: "FRI", date: "NOV 18", key: "nov18" },
  { day: "SAT", date: "NOV 19", key: "nov19" },
  { day: "SUN", date: "NOV 20", key: "nov20" },
  { day: "MON", date: "NOV 21", key: "nov21" },
  { day: "TUE", date: "NOV 22", key: "nov22" },
  { day: "WED", date: "NOV 23", key: "nov23" },
  { day: "THU", date: "NOV 24", key: "nov24" },
  { day: "FRI", date: "NOV 25", key: "nov25" },
  { day: "SAT", date: "NOV 26", key: "nov26" },
  { day: "SUN", date: "NOV 27", key: "nov27" },
  { day: "MON", date: "NOV 28", key: "nov28" },
  { day: "TUE", date: "NOV 29", key: "nov29" },
  { day: "WED", date: "NOV 30", key: "nov30" },
];


export const data = [
  {
    date: "2025-10-17",
    name: "John Smith",
    role: "Agent",
    department: "CSR",
    output: 45,
    target: 50,
    variance: -5,
    email: "john.smith@mytechliance.com"
  },
  {
    date: "2025-10-17",
    name: "Sarah Johnson",
    role: "Agent",
    department: "Withdrawal",
    output: 28,
    target: 35,
    variance: -7,
    email: "sarah.johnson@mytechliance.com"
  },
  {
    date: "2025-10-16",
    name: "Mike Davis",
    role: "Agent",
    department: "Deposit",
    output: 38,
    target: 45,
    variance: -7,
    email: "mike.davis@mytechliance.com"
  },
  {
    date: "2025-10-16",
    name: "Emily Wilson",
    role: "Agent",
    department: "CSR",
    output: 42,
    target: 50,
    variance: -8,
    email: "emily.wilson@mytechliance.com"
  },
  {
    date: "2025-10-15",
    name: "David Brown",
    role: "Agent",
    department: "Withdrawal",
    output: 32,
    target: 35,
    variance: -3,
    email: "david.brown@mytechliance.com"
  },
  {
    date: "2025-10-15",
    name: "Lisa Taylor",
    role: "Agent",
    department: "Deposit",
    output: 44,
    target: 45,
    variance: -1,
    email: "lisa.taylor@mytechliance.com"
  },
];


export const headers = [
  "User ID",
  "NAME",
  "DATE",
  "DEPARTMENT",
  "PUNCH IN",
  "Shift",
  "PUNCH OUT",
  "Total Working Hours",
  "STATUS",
];

