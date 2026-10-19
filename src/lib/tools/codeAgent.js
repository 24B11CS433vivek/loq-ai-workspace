// Phase 12 — Coding Agent. Thin client around backend/routers/code.py's
// sandboxed /tools/code/* endpoints (tree/write/read/run). Mirrors the
// style of dataAnalysis.js: every call takes { backendUrl, ... }, logs
// its request/response, and throws a readable Error on failure so the
// UI layer (CodePanel.jsx, Phase 12C) doesn't have to guess.
//
// NOTE: model selection for *generating* code (which prompt to send to
// qwen2.5-coder:7b) is NOT this file's job — that stays in whatever
// calls ollama.js, same as every other tool. This file only talks to
// the sandbox execution endpoints.

const DEFAULT_PROJECT = "default";

function cleanUrl(backendUrl) {
  return backendUrl.replace(/\/$/, "");
}

async function handle(res, label) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.error(`[code] ${label} returned`, res.status, body);
    throw new Error(body.detail || `${label} failed (${res.status})`);
  }
  return res.json();
}

export async function listCodeTree({ backendUrl, project = DEFAULT_PROJECT }) {
  const url = `${cleanUrl(backendUrl)}/tools/code/tree?project=${encodeURIComponent(project)}`;
  console.log("[code] GET /tools/code/tree ->", url);
  let res;
  try {
    res = await fetch(url);
  } catch (networkErr) {
    console.error("[code] network error calling /tools/code/tree — is the backend running and CORS-allowed for this origin?", networkErr);
    throw new Error(`Could not reach the backend at ${backendUrl} (network/CORS error): ${networkErr.message}`);
  }
  const json = await handle(res, "/tools/code/tree");
  console.log("[code] tree result <-", json);
  return json; // { project, root, files: [{ path, size }] }
}

export async function readCodeFile({ backendUrl, project = DEFAULT_PROJECT, path }) {
  const url = `${cleanUrl(backendUrl)}/tools/code/read?project=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}`;
  console.log("[code] GET /tools/code/read ->", url);
  let res;
  try {
    res = await fetch(url);
  } catch (networkErr) {
    console.error("[code] network error calling /tools/code/read", networkErr);
    throw new Error(`Could not reach the backend at ${backendUrl} (network/CORS error): ${networkErr.message}`);
  }
  return handle(res, "/tools/code/read"); // { project, path, content }
}

export async function writeCodeFile({ backendUrl, project = DEFAULT_PROJECT, path, content }) {
  console.log("[code] POST /tools/code/write ->", backendUrl, { project, path, bytes: content?.length });
  let res;
  try {
    res = await fetch(`${cleanUrl(backendUrl)}/tools/code/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project, path, content }),
    });
  } catch (networkErr) {
    console.error("[code] network error calling /tools/code/write", networkErr);
    throw new Error(`Could not reach the backend at ${backendUrl} (network/CORS error): ${networkErr.message}`);
  }
  const json = await handle(res, "/tools/code/write");
  console.log("[code] write result <-", json);
  return json; // { project, path, bytes_written }
}

export async function runCodeFile({ backendUrl, project = DEFAULT_PROJECT, entrypoint, args = [] }) {
  console.log("[code] POST /tools/code/run ->", backendUrl, { project, entrypoint, args });
  let res;
  try {
    res = await fetch(`${cleanUrl(backendUrl)}/tools/code/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project, entrypoint, args }),
    });
  } catch (networkErr) {
    console.error("[code] network error calling /tools/code/run", networkErr);
    throw new Error(`Could not reach the backend at ${backendUrl} (network/CORS error): ${networkErr.message}`);
  }
  const json = await handle(res, "/tools/code/run");
  console.log("[code] run result <-", json);
  return json; // { project, entrypoint, command, exit_code, timed_out, stdout, stderr }
}
