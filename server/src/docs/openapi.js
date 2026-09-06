import swaggerJsdoc from "swagger-jsdoc";

// Documents Backend Phase 1's new session-based auth/organizations/
// invitations surface only — the ~15 pre-existing legacy CRM/Sales/
// Support/AI route files (Bearer-JWT /api/v1/user/*, /api/v1/crm/*, etc.)
// are out of this phase's scope and are not retrofitted here.
const definition = {
  openapi: "3.0.3",
  info: {
    title: "Caspira CRM API — Backend Phase 1",
    version: "1.0.0",
    description: "Docker foundation, authentication, organizations and RBAC. Cookie-based session auth (see the `cookieAuth` security scheme) — separate from the legacy Bearer-JWT endpoints under /api/v1/user/*, which this document does not cover.",
  },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: {
      cookieAuth: { type: "apiKey", in: "cookie", name: "csrm_access" },
    },
    schemas: {
      Error: {
        type: "object",
        properties: { code: { type: "string" }, message: { type: "string" } },
      },
      User: {
        type: "object",
        properties: {
          _id: { type: "string" }, name: { type: "string" }, email: { type: "string" },
          username: { type: "string" }, role: { type: "string", enum: ["Super-Admin", "Admin", "Team-Leader", "Checker", "User"] },
          status: { type: "string" },
        },
      },
      Organization: {
        type: "object",
        properties: {
          _id: { type: "string" }, name: { type: "string" }, slug: { type: "string" },
          status: { type: "string", enum: ["Active", "Suspended", "Archived"] },
        },
      },
    },
  },
  security: [{ cookieAuth: [] }],
};

export const openapiSpec = swaggerJsdoc({
  definition,
  apis: ["./src/routes/auth2Routes.js", "./src/routes/organizationRoutes.js", "./src/routes/invitationRoutes.js", "./src/routes/inviteLinkRoutes.js"],
});
