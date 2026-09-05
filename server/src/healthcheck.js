// Docker HEALTHCHECK target for the `api` service. Plain Node (no curl/wget
// in node:20-alpine) hitting the liveness endpoint mounted in app.js.
import http from "node:http";

const port = process.env.PORT || 4000;

const req = http.get({ host: "127.0.0.1", port, path: "/health", timeout: 3000 }, (res) => {
  process.exit(res.statusCode === 200 ? 0 : 1);
});
req.on("error", () => process.exit(1));
req.on("timeout", () => { req.destroy(); process.exit(1); });
