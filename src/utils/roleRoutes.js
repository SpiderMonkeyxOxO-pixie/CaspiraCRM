export const ROLE_HOME_PATH = {
  Admin: "/crm/dashboard",
  "Super-Admin": "/crm/dashboard",
  Checker: "/finance/dashboard",
  User: "/crm/dashboard",
  "Team-Leader": "/crm/dashboard",
};

export const getHomePathForRole = (role) => ROLE_HOME_PATH[role] || null;
