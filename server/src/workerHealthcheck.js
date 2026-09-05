// Docker HEALTHCHECK target for the `worker` service — hits the worker's
// own small liveness listener (see worker.js), independent of the api's.
import http from "node:http";

const port = process.env.WORKER_PORT || 4001;

const req = http.get({ host: "127.0.0.1", port, path: "/health", timeout: 3000 }, (res) => {
  process.exit(res.statusCode === 200 ? 0 : 1);
});
req.on("error", () => process.exit(1));
req.on("timeout", () => { req.destroy(); process.exit(1); });
