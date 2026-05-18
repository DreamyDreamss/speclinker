#!/usr/bin/env node
// Cross-platform req_scan launcher — detects python3 or python automatically.
const { execSync, spawnSync } = require("child_process");
const path = require("path");

function hasPython(cmd) {
  const r = spawnSync(cmd, ["--version"], { stdio: "pipe" });
  return r.status === 0;
}

const py = hasPython("python3") ? "python3" : hasPython("python") ? "python" : null;
if (!py) {
  console.error("[speclinker] Python not found. Install Python 3 and ensure it is on PATH.");
  process.exit(1);
}

const scanScript = path.join(__dirname, "req_scan.py");
execSync(`${py} "${scanScript}"`, { stdio: "inherit" });
