// ─────────────────────────────────────────────────────────────────
// EXTENSION REGISTRY
//
// Phase 2 tools (PDF reading, image understanding, web search, etc.)
// register themselves here instead of being hardcoded into the
// composer/UI. Each entry becomes one toolbar button in <Composer />
// and can push content into the right-side <ArtifactPanel />.
//
// To add a new tool later:
//   import { registerTool } from "../lib/extensions";
//   registerTool({
//     id: "pdf",
//     label: "Open PDF",
//     icon: <YourSvgIcon />,
//     onClick: (ctx) => { ...ctx.openArtifactPanel(...) },
//   });
//
// `ctx` (passed to onClick) currently exposes:
//   ctx.addAttachment(attachment)   — push a chip into the composer
//   ctx.openArtifactPanel(node)     — render content in the side panel
//   ctx.settings                    — current { ollamaUrl, model }
//
// Nothing is registered yet — this file is intentionally empty so
// Phase 1 ships with just the bare chat UI, as requested.
// ─────────────────────────────────────────────────────────────────

export const TOOLS = [];

// Phase 4 — Attach Document tool. UI rendering lives in
// src/components/tools/DocumentButton.jsx (rendered directly by
// Composer.jsx since it needs file-input + backendUrl access);
// this entry marks the id as reserved/known to the registry.
export const DOCUMENT_TOOL_ID = "document-tool";

// Phase 7 — Data Analysis tool (CSV/XLSX upload -> pandas ops -> chart).
// Same reasoning as DOCUMENT_TOOL_ID above: rendered directly by
// Composer.jsx (src/components/tools/DataButton.jsx) since it needs
// backendUrl + attachment access; this entry just reserves the id.
export const DATA_TOOL_ID = "data-tool";

// Phase 12 — Coding Agent tool. Same reasoning as DOCUMENT_TOOL_ID /
// DATA_TOOL_ID above: rendered directly by Composer.jsx
// (src/components/tools/CodePanel.jsx, Phase 12C) since it needs
// backendUrl + file-tree/editor state; this entry just reserves the id.
export const CODE_TOOL_ID = "code-tool";

// Phase 19B — Chart Engine tool (Chart.js: bar/line/pie/doughnut/
// radar/scatter/bubble/polarArea). Same reasoning as DATA_TOOL_ID /
// CODE_TOOL_ID above: rendered directly by Composer.jsx
// (rendered inline via chartMode in App.jsx/Composer.jsx) since it needs
// backendUrl + ollamaUrl access; this entry just reserves the id.
export const CHART_TOOL_ID = "chart-tool";

export function registerTool(tool) {
  TOOLS.push(tool);
}
