#!/usr/bin/env node
/**
 * smoke-test-worker.mjs
 *
 * Standalone smoke test for the ocho.i18n-parity plugin worker.
 * Spawns the worker as a subprocess, implements a minimal mock host,
 * and exercises all 5 agent tools via JSON-RPC over stdio.
 *
 * Usage:
 *   node scripts/smoke-test-worker.mjs /path/to/sudokuaday-clean
 *
 * Does NOT require the Paperclip server — validates scan logic in isolation.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_PATH = process.argv[2] ?? "/Users/achtung/Documents/projects/sudokuaday-clean";
const WORKER_PATH = path.resolve(__dirname, "../dist/worker.js");
const MANIFEST_PATH = path.resolve(__dirname, "../dist/manifest.js");

// tsx is needed because @paperclipai/shared exports TypeScript sources
// The server inherits tsx from the parent process via fork(); we must use it explicitly here.
const TSX_PATH = path.resolve(__dirname, "../../../../../cli/node_modules/.bin/tsx");
const USE_TSX = process.argv.includes("--tsx");

// ---------------------------------------------------------------------------
// Load manifest
// ---------------------------------------------------------------------------

const { default: manifest } = await import(MANIFEST_PATH);

// ---------------------------------------------------------------------------
// Mock host state
// ---------------------------------------------------------------------------

const hostState = new Map();
const instanceConfig = {
  repoPath: REPO_PATH,
  minScore: 0.7,
};

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

let nextId = 1;

function makeRequest(method, params, id) {
  return JSON.stringify({ jsonrpc: "2.0", id: id ?? nextId++, method, params });
}

function makeSuccessResponse(id, result) {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

function makeErrorResponse(id, code, message) {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

// ---------------------------------------------------------------------------
// Spawn worker
// ---------------------------------------------------------------------------

console.log(`\n[smoke-test] Spawning worker: ${WORKER_PATH}`);
console.log(`[smoke-test] Repo path: ${REPO_PATH}\n`);

// Use tsx if available and needed (for workspace TypeScript imports)
const nodeExec = USE_TSX ? TSX_PATH : process.execPath;
const nodeArgs = USE_TSX ? [WORKER_PATH] : [WORKER_PATH];

const worker = spawn(nodeExec, nodeArgs, {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env },
});

const rl = createInterface({ input: worker.stdout });
const pendingRequests = new Map(); // id → { resolve, reject }
const pendingToolCalls = new Map(); // id → name

worker.on("error", (err) => {
  console.error("[smoke-test] Worker process error:", err);
  process.exit(1);
});

worker.on("exit", (code) => {
  if (code !== 0 && code !== null) {
    console.error(`[smoke-test] Worker exited with code ${code}`);
  }
});

// ---------------------------------------------------------------------------
// Handle messages from worker (worker-to-host calls + responses)
// ---------------------------------------------------------------------------

rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    console.error("[smoke-test] Unparseable line from worker:", line);
    return;
  }

  // If it's a response to one of our requests
  if ("result" in msg || "error" in msg) {
    const pending = pendingRequests.get(msg.id);
    if (pending) {
      pendingRequests.delete(msg.id);
      if ("error" in msg) {
        pending.reject(new Error(`RPC error ${msg.error.code}: ${msg.error.message}`));
      } else {
        pending.resolve(msg.result);
      }
    }
    return;
  }

  // It's a request from worker to host — handle mock responses
  if (msg.method) {
    const id = msg.id;
    const method = msg.method;
    const params = msg.params;

    switch (method) {
      case "config.get":
        worker.stdin.write(makeSuccessResponse(id, instanceConfig) + "\n");
        break;

      case "log":
        // Suppress worker logs in test output (they go to stderr via worker already)
        worker.stdin.write(makeSuccessResponse(id, null) + "\n");
        break;

      case "state.get": {
        const key = `${params.scopeKind}:${params.scopeId ?? ""}:${params.namespace ?? ""}:${params.stateKey}`;
        worker.stdin.write(makeSuccessResponse(id, hostState.get(key) ?? null) + "\n");
        break;
      }

      case "state.set": {
        const key = `${params.scopeKind}:${params.scopeId ?? ""}:${params.namespace ?? ""}:${params.stateKey}`;
        hostState.set(key, params.value);
        worker.stdin.write(makeSuccessResponse(id, null) + "\n");
        break;
      }

      case "state.delete": {
        const key = `${params.scopeKind}:${params.scopeId ?? ""}:${params.namespace ?? ""}:${params.stateKey}`;
        hostState.delete(key);
        worker.stdin.write(makeSuccessResponse(id, null) + "\n");
        break;
      }

      case "companies.list":
        worker.stdin.write(makeSuccessResponse(id, [
          { id: "mock-company-id", name: "Ocho", slug: "ocho" }
        ]) + "\n");
        break;

      case "activity.log":
        worker.stdin.write(makeSuccessResponse(id, null) + "\n");
        break;

      case "events.emit":
      case "events.subscribe":
      case "metrics.write":
        worker.stdin.write(makeSuccessResponse(id, null) + "\n");
        break;

      default:
        console.warn(`[smoke-test] Unhandled host method: ${method}`);
        worker.stdin.write(makeErrorResponse(id, -32601, `Method not found: ${method}`) + "\n");
        break;
    }
  }
});

// ---------------------------------------------------------------------------
// RPC call helper
// ---------------------------------------------------------------------------

function rpcCall(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pendingRequests.set(id, { resolve, reject });
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    worker.stdin.write(msg);
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error(`Timeout waiting for ${method} (id=${id})`));
      }
    }, 30000);
  });
}

function executeTool(toolName, parameters) {
  return rpcCall("executeTool", {
    toolName,
    parameters,
    runContext: {
      agentId: "smoke-test-agent",
      runId: "smoke-test-run",
      companyId: "mock-company-id",
      projectId: null,
    },
  });
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    const result = await fn();
    console.log(`  ✓ ${name}`);
    if (result !== undefined) {
      const summary = typeof result === "object"
        ? JSON.stringify(result).slice(0, 120)
        : String(result).slice(0, 120);
      console.log(`    → ${summary}`);
    }
    passed++;
    return result;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
    failed++;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main test sequence
// ---------------------------------------------------------------------------

try {
  // 1. Initialize
  console.log("── initialize ──────────────────────────────");
  const initResult = await test("initialize worker", () =>
    rpcCall("initialize", {
      manifest,
      config: instanceConfig,
      instanceInfo: { instanceId: "smoke-test-instance", hostVersion: "0.0.0" },
      apiVersion: 1,
    })
  );
  if (!initResult?.ok) throw new Error("initialize returned ok=false");

  // 2. run-scan
  console.log("\n── run-scan ─────────────────────────────────");
  const scanResult = await test("run-scan (all locales)", () =>
    executeTool("run-scan", {})
  );

  if (scanResult?.content) {
    await test("scan reports pages", () => {
      if (!scanResult.data?.localization?.pages?.length) throw new Error("No pages in scan result");
      return `${scanResult.data.localization.pages.length} pages across ${scanResult.data.config.locales_scanned.length} locale(s)`;
    });
  }

  // 3. get-report
  console.log("\n── get-report ───────────────────────────────");
  const reportResult = await test("get-report (flaggedOnly)", () =>
    executeTool("get-report", { flaggedOnly: true })
  );

  if (reportResult?.data) {
    await test("get-report returns filtered pages", () => {
      const flagged = reportResult.data.localization.pages;
      if (!Array.isArray(flagged)) throw new Error("No pages array in report");
      return `${flagged.length} still-English pages flagged`;
    });
  }

  // 4. get-summary
  console.log("\n── get-summary ──────────────────────────────");
  const summaryResult = await test("get-summary (all locales)", () =>
    executeTool("get-summary", {})
  );

  if (summaryResult?.data) {
    await test("get-summary returns per-locale data", () => {
      const locales = Object.keys(summaryResult.data);
      if (locales.length === 0) throw new Error("No locales in summary");
      return locales.map(l => `${l}: avg=${summaryResult.data[l].avg_score}`).join(", ");
    });
  }

  // 5. get-page-detail (pick first page from scan if available)
  console.log("\n── get-page-detail ──────────────────────────");
  const firstPage = scanResult?.data?.localization?.pages?.[0];
  if (firstPage) {
    await test(`get-page-detail (${firstPage.locale}/${firstPage.path})`, () =>
      executeTool("get-page-detail", { locale: firstPage.locale, path: firstPage.path })
    );
  } else {
    await test("get-page-detail (skipped — no scan data)", () => "skipped");
  }

  // 6. create-tickets --dryRun (no actual issues created)
  console.log("\n── create-tickets (dryRun=true) ─────────────");
  const dryRunResult = await test("create-tickets dryRun", () =>
    executeTool("create-tickets", { minScore: 0.7, dryRun: true })
  );

  if (dryRunResult?.data) {
    await test("create-tickets dryRun returns page list", () => {
      if (!dryRunResult.data.dryRun) throw new Error("dryRun flag missing");
      const pages = dryRunResult.data.pages ?? [];
      return `${pages.length} pages would be ticketed (threshold=${dryRunResult.data.threshold})`;
    });
  }

  // Shutdown
  await rpcCall("shutdown", {}).catch(() => {});

} catch (err) {
  console.error("\n[smoke-test] Fatal error:", err);
} finally {
  worker.stdin.end();
  worker.kill();

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}
