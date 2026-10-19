// Phase 19A — SVG Studio. Thin client around backend/routers/svg.py's
// single /tools/svg/generate endpoint. Mirrors the style of
// codeAgent.js / dataAnalysis.js: takes { backendUrl, ... }, logs its
// request/response, throws a readable Error on failure.

function cleanUrl(backendUrl) {
  return backendUrl.replace(/\/$/, "");
}

export async function generateSvg({ backendUrl, prompt, style = "icon", model, think = true }) {
  const url = `${cleanUrl(backendUrl)}/tools/svg/generate`;
  console.log("[svg] POST /tools/svg/generate ->", url, { prompt, style, model, think });
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // model: whatever's picked as the SVG model preset in Settings
      // (falls back to the backend's default if left blank) — no
      // hardcoded model on the frontend either.
      body: JSON.stringify({ prompt, style, model: model || undefined, think }),
    });
  } catch (networkErr) {
    console.error("[svg] network error calling /tools/svg/generate — is the backend running?", networkErr);
    throw new Error(`Could not reach the backend at ${backendUrl} (network/CORS error): ${networkErr.message}`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.error("[svg] /tools/svg/generate returned", res.status, body);
    throw new Error(body.detail || `SVG generation failed (${res.status})`);
  }
  const json = await res.json();
  console.log("[svg] result <-", json);
  return json; // { svg_code, plan, model }
}

export function svgDownloadFilename(prompt) {
  const slug = (prompt || "svg")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "svg";
  return `${slug}.svg`;
}