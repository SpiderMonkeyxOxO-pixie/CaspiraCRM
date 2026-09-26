// The process environment as the container started it, before load.js /
// applyEnv.js resolve secret files into process.env. Re-validating the
// configuration later (the deployment "configuration" gate) must use this
// copy: the resolved values in process.env look like plain-environment
// secrets and would fail the strict profile's checks.
export const startupEnv = Object.freeze({ ...process.env });
