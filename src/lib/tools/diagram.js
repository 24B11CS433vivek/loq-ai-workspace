// Phase 19C — Diagram Engine (Mermaid). Frontend-only: wraps mermaid.js
// so the app can render flowcharts, org charts, sequence diagrams,
// mindmaps, gantt charts and pie charts inline as real SVG -- same
// "quick-generate toggle -> Ollama -> inline artifact" shape as
// chartEngine.js (Phase 19B), but rendering a static SVG string
// instead of driving a live canvas, since Mermaid owns its own
// layout/render pass.
//
// Fix (post-19C): small local models frequently emit almost-correct
// Mermaid (stray braces around mindmaps, malformed gantt task lines,
// etc). parseDiagramPrompt now validates the model's output against
// Mermaid's own parser before returning it, and self-corrects by
// feeding the exact parse error back to the model for up to 2 retries
// -- so DiagramCard only ever receives code that's already known to
// render.

import mermaid from "mermaid";

function ensureInit(theme = "dark") {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    theme: theme === "dark" ? "dark" : "default",
    fontFamily: "inherit",
  });
}

export const DIAGRAM_KINDS = [
  { id: "flowchart", label: "Flowchart" },
  { id: "org", label: "Org chart" },
  { id: "sequence", label: "Sequence diagram" },
  { id: "mindmap", label: "Mind map" },
  { id: "gantt", label: "Gantt chart" },
  { id: "pie", label: "Pie chart" },
];

// Renders Mermaid `code` into an SVG string. Re-initializes mermaid
// with the requested theme first, since Mermaid bakes theme colors
// into the SVG at render time (unlike Chart.js, which reads CSS vars
// live). `id` must be a unique-per-render DOM id.
export async function renderMermaid(code, id, theme = "dark") {
  ensureInit(theme);
  const { svg } = await mermaid.render(id, code);
  return svg;
}

// Throws with Mermaid's own parser error message if `code` isn't
// valid Mermaid -- used by parseDiagramPrompt to catch bad model
// output before it ever reaches DiagramCard.
export async function validateMermaidCode(code) {
  ensureInit();
  await mermaid.parse(code);
}

const SYNTAX_EXAMPLES = `Correct syntax examples -- follow these formats exactly:

Flowchart / pipeline / org chart:
flowchart TD
    A[Ingest] --> B[Chunk]
    B --> C[Embed]
    C --> D[Store]

Sequence diagram:
sequenceDiagram
    User->>Server: Send credentials
    Server->>Database: Check credentials
    Database-->>Server: Result
    Server-->>User: Token

Mind map (no braces, no brackets around the root -- indentation only):
mindmap
  root((Product Launch))
    Marketing
    Engineering
    Design
    Sales

Gantt chart (dateFormat line is required; each task line is "Name :id, start, duration"):
gantt
    dateFormat YYYY-MM-DD
    title Sprint Plan
    section Planning
    Plan task :a1, 2024-01-01, 7d
    section Development
    Dev task :a2, after a1, 14d

Pie chart (quoted labels, colon, number):
pie
    title Browser Market Share
    "Chrome" : 65
    "Safari" : 19
    "Edge" : 8`;

// Ollama prompt -> raw Mermaid code. Mirrors parseChartPrompt's shape:
// same model-resolution contract from App.jsx (settings.diagramModel
// -> settings.model -> this default), temperature 0, and a system
// prompt that forbids anything except the diagram code itself. On top
// of that, this now validates the result with Mermaid's own parser
// and, if it's invalid, retries up to 2 more times with the exact
// parse error appended so the model can fix its own mistake.
export async function parseDiagramPrompt({ ollamaUrl, model = "qwen3:4b", prompt, _attempt = 0, _lastError = null }) {
  const system = `You convert a user's request into a Mermaid diagram. Reply with ONLY raw Mermaid code, no markdown fences, no commentary, no explanation, no backticks, no curly braces. Pick the right diagram kind based on what the user described: flowcharts/processes/pipelines -> "flowchart TD", org charts/hierarchies -> "flowchart TD" as a top-down tree, sequence/interaction diagrams -> "sequenceDiagram", brainstorms -> "mindmap", schedules/timelines -> "gantt", proportions/breakdowns -> "pie". Use short, valid node ids and labels.

${SYNTAX_EXAMPLES}

Output nothing but the code, matching one of the formats above exactly.`;

  const userContent = _lastError
    ? `${prompt}\n\nYour previous attempt produced invalid Mermaid code. The parser rejected it with this exact error:\n${_lastError}\n\nFix that specific mistake and reply again with ONLY corrected raw Mermaid code -- no commentary, no fences.`
    : prompt;

  const res = await fetch(`${ollamaUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      options: { temperature: 0 },
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Ollama request failed (${res.status}): ${detail || "no detail"}`);
  }

  const json = await res.json();
  const raw = (json?.message?.content || "").trim();
  const cleaned = raw
    .replace(/^```(mermaid)?/i, "")
    .replace(/```$/, "")
    .trim();

  if (!cleaned) {
    throw new Error("Model didn't return any Mermaid code.");
  }

  try {
    await validateMermaidCode(cleaned);
  } catch (parseErr) {
    if (_attempt < 2) {
      return parseDiagramPrompt({
        ollamaUrl,
        model,
        prompt,
        _attempt: _attempt + 1,
        _lastError: parseErr.message,
      });
    }
    throw new Error(`Model produced invalid Mermaid syntax after ${_attempt + 1} attempts: ${parseErr.message}`);
  }

  return cleaned;
}

export function diagramDownloadFilename(prompt) {
  const slug = (prompt || "diagram")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "diagram";
  return `${slug}.svg`;
}

export function downloadDiagramSvg(svgCode, filename = "diagram.svg") {
  if (!svgCode) return;
  const blob = new Blob([svgCode], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
