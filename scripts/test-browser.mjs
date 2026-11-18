// Builds the app, serves it on a loopback port, runs every browser script
// against it in order, and always stops the server. Exit code is the first
// failing script's. With EXPERIENCE_PREVIEW_URL set, only the scripts run.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = path.join(root, "node_modules", ".bin", "next");
const scripts = ["retryConflicts.browser.mjs", "shell.browser.mjs"].map((name) =>
  path.join(root, "app", "lib", "experience", name),
);
const port = Number(process.env.EXPERIENCE_PREVIEW_PORT || 3033);
const previewUrl = process.env.EXPERIENCE_PREVIEW_URL;
const READY_TIMEOUT_MS = 60_000;

function run(command, args, label, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...extraEnv } });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with ${signal ?? code}`));
    });
  });
}

async function waitForServer(url, server) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`next start exited with ${server.exitCode} before answering`);
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Server at ${url} did not answer within ${READY_TIMEOUT_MS / 1000}s`);
}

async function stop(server) {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  const timer = setTimeout(() => server.kill("SIGKILL"), 5_000);
  await once(server, "exit");
  clearTimeout(timer);
}

async function main() {
  for (const script of scripts) {
    if (!existsSync(script)) throw new Error(`Browser script not found: ${script}`);
  }
  const runScripts = async (extraEnv = {}) => {
    for (const script of scripts) {
      console.log(`Running ${path.basename(script)}...`);
      await run(process.execPath, [script], path.basename(script), extraEnv);
    }
  };

  if (previewUrl) {
    console.log(`Using running preview at ${previewUrl}`);
    await runScripts();
    return;
  }

  if (!existsSync(nextBin)) throw new Error("next is not installed; run npm ci first");
  const url = `http://127.0.0.1:${port}`;

  console.log("Building with next build (Turbopack)...");
  await run(nextBin, ["build"], "next build");

  console.log(`Starting next start on ${url}...`);
  const server = spawn(nextBin, ["start", "-p", String(port)], { cwd: root, stdio: "inherit", env: process.env });
  const onSignal = () => {
    stop(server).finally(() => process.exit(130));
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    await waitForServer(url, server);
    await runScripts({ EXPERIENCE_PREVIEW_URL: url });
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await stop(server);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
