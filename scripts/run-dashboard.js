// STATUS: 완료
#!/usr/bin/env node
// Cross-platform dashboard launcher. Sets GRAPH_DIR from project.env if present.
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

// Try to load GRAPH_DIR from project.env in cwd
const envFile = path.join(process.cwd(), "project.env");
if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^WORKSPACE_DIR=(.+)/);
    if (m) { process.env.GRAPH_DIR = m[1].trim(); break; }
  }
}

const dashboardDir = path.join(__dirname, "..", "ua", "packages", "dashboard");
process.chdir(dashboardDir);
execSync("pnpm dev", { stdio: "inherit" });
