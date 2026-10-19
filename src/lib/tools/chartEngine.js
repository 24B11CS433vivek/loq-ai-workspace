// Phase 19B — Chart Engine. Frontend-only: wraps Chart.js so the app
// can render bar/line/pie/doughnut/radar/scatter/bubble/polarArea
// charts inline, replacing the Phase 7 matplotlib-PNG-from-backend
// path with a real interactive <canvas/> (hover tooltips, legend,
// instant type switching) that never touches the backend.

import { Chart, registerables } from "chart.js";

Chart.register(...registerables);

export const CHART_TYPES = [
  { id: "bar", label: "Bar" },
  { id: "horizontalBar", label: "Horizontal Bar" },
  { id: "line", label: "Line" },
  { id: "pie", label: "Pie" },
  { id: "doughnut", label: "Doughnut" },
  { id: "radar", label: "Radar" },
  { id: "polarArea", label: "Polar Area" },
  { id: "scatter", label: "Scatter" },
  { id: "bubble", label: "Bubble" },
];

const TYPE_MAP = {
  bar: { chartJsType: "bar" },
  horizontalBar: { chartJsType: "bar", indexAxis: "y" },
  line: { chartJsType: "line" },
  pie: { chartJsType: "pie" },
  doughnut: { chartJsType: "doughnut" },
  radar: { chartJsType: "radar" },
  polarArea: { chartJsType: "polarArea" },
  scatter: { chartJsType: "scatter" },
  bubble: { chartJsType: "bubble" },
};

const SLICE_TYPES = new Set(["pie", "doughnut", "polarArea"]);
const XY_TYPES = new Set(["scatter", "bubble"]);

const PALETTE = [
  "#d4714a", "#4db87a", "#5b8fd4", "#d4b74a", "#a15bd4",
  "#d45b9a", "#5bd4c8", "#e05555", "#8ad45b", "#5b6ad4",
];

function paletteColors(n) {
  return Array.from({ length: Math.max(n, 1) }, (_, i) => PALETTE[i % PALETTE.length]);
}

function cssVar(name, fallback) {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return v && v.trim() ? v.trim() : fallback;
}

// Example datasets shown as one-click buttons in <ChartCard/>'s type dropdown.
export const EXAMPLE_DATA = {
  sales: {
    label: "Sales Data",
    labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    values: [12000, 15500, 14200, 18000, 21000, 19500, 23000, 24500, 22000, 26000, 28500, 31000],
  },
  attendance: {
    label: "Attendance Data",
    labels: ["CSE-A", "CSE-B", "CSE-C", "AI/ML", "Cyber", "Data Sci"],
    values: [94, 89, 91, 87, 96, 90],
  },
};

// Accepts either:
//   { labels: [...], values: [...] }                 -> single dataset
//   { labels: [...], datasets: [{label,data}, ...] }  -> pass-through (multi-series)
//   { datasets: [{label, data:[{x,y}|{x,y,r}]}] }     -> scatter/bubble
// and normalizes it into the shape Chart.js's `data` option expects,
// filling in a color from PALETTE wherever one wasn't supplied.
export function normalizeChartData(typeKey, raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Chart data must be an object — see the example buttons for the expected shape.");
  }

  const isSlice = SLICE_TYPES.has(typeKey);
  const isXY = XY_TYPES.has(typeKey);

  if (Array.isArray(raw.datasets)) {
    const datasets = raw.datasets.map((ds, i) => {
      const colors = isSlice
        ? paletteColors((ds.data || []).length)
        : [PALETTE[i % PALETTE.length]];
      return {
        label: ds.label || `Series ${i + 1}`,
        data: ds.data || [],
        backgroundColor: ds.backgroundColor || (isSlice ? colors : colors[0]),
        borderColor: ds.borderColor || colors[0],
        borderWidth: ds.borderWidth ?? (typeKey === "line" ? 2 : 1),
        tension: typeKey === "line" ? 0.35 : undefined,
        fill: typeKey === "radar" ? true : undefined,
      };
    });
    return { labels: raw.labels || [], datasets };
  }

  if (isXY) {
    const points = raw.points || raw.values || [];
    const colors = paletteColors(1);
    return {
      datasets: [
        {
          label: raw.label || "Series 1",
          data: points,
          backgroundColor: colors[0],
          borderColor: colors[0],
        },
      ],
    };
  }

  if (!Array.isArray(raw.values)) {
    throw new Error('Chart data needs a "values" array (or "datasets") — see the example buttons.');
  }

  const labels = raw.labels && raw.labels.length === raw.values.length
    ? raw.labels
    : raw.values.map((_, i) => `Item ${i + 1}`);
  const colors = paletteColors(isSlice ? raw.values.length : 1);

  return {
    labels,
    datasets: [
      {
        label: raw.label || "Series 1",
        data: raw.values,
        backgroundColor: isSlice ? colors : colors[0],
        borderColor: colors[0],
        borderWidth: typeKey === "line" ? 2 : 1,
        tension: typeKey === "line" ? 0.35 : undefined,
        fill: typeKey === "radar" ? true : undefined,
      },
    ],
  };
}

// Destroys any previous Chart.js instance attached to this canvas and
// mounts a fresh one — call this on every type/data change rather than
// mutating .data in place, since dataset "shape" differs across types
// (e.g. plain numbers for bar vs {x,y} pairs for scatter).
export function renderChart(canvas, typeKey, rawData, extraOptions = {}) {
  const map = TYPE_MAP[typeKey];
  if (!map) throw new Error(`Unknown chart type: ${typeKey}`);

  if (canvas._chartInstance) {
    canvas._chartInstance.destroy();
    canvas._chartInstance = null;
  }

  const data = normalizeChartData(typeKey, rawData);
  const textColor = cssVar("--text-2", "#b3ada6");
  const gridColor = "rgba(255,255,255,0.06)";

  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: map.indexAxis || "x",
    plugins: {
      legend: { position: "bottom", labels: { color: textColor } },
      tooltip: { enabled: true, mode: "index", intersect: false },
    },
  };

  if (!SLICE_TYPES.has(typeKey) && typeKey !== "radar") {
    baseOptions.scales = {
      x: { ticks: { color: textColor }, grid: { color: gridColor } },
      y: { ticks: { color: textColor }, grid: { color: gridColor } },
    };
  }

  const options = { ...baseOptions, ...extraOptions };
  const instance = new Chart(canvas.getContext("2d"), { type: map.chartJsType, data, options });
  canvas._chartInstance = instance;
  return instance;
}

// Minimal CSV -> chart-data parser (2 columns: label,value -> single
// series; 3+ columns -> one series per extra column). No quoted-field
// support — good enough for the plain "label,value" exports Phase 7
// already produces.
export function parseCsvForChart(csvText) {
  const rows = csvText
    .split(/\r?\n/)
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => r.split(",").map((c) => c.trim()));
  if (rows.length < 2) throw new Error("CSV needs a header row plus at least one data row.");

  const [header, ...dataRows] = rows;
  const labels = dataRows.map((r) => r[0]);

  if (header.length === 2) {
    return { labels, values: dataRows.map((r) => Number(r[1])) };
  }
  const datasets = header.slice(1).map((name, i) => ({
    label: name,
    data: dataRows.map((r) => Number(r[i + 1])),
  }));
  return { labels, datasets };
}

// Ollama prompt -> chart spec. App.jsx resolves the model to use
// (chartModel override -> main selected model -> this default) before
// calling this, so the qwen3:4b default below only fires if neither
// of those was set anywhere -- e.g. a fresh install. Runs with
// temperature 0 and an explicit "JSON only" system
// prompt, since anything conversational in the response would break
// JSON.parse.
export async function parseChartPrompt({ ollamaUrl, model = "qwen3:4b", prompt }) {
  const allowedTypes = CHART_TYPES.map((t) => t.id).join(", ");
  const system = `You convert a user's request into chart data. Reply with ONLY a single JSON object, no markdown fences, no commentary, no explanation. Schema: {"type": one of [${allowedTypes}], "labels": string[], "values": number[]}. Pick "type" based on what the user described (e.g. "pie chart" -> pie, "trend over time" -> line). Invent plausible labels/values ONLY if the user gave none; otherwise use the exact numbers/categories the user gave.`;

  const res = await fetch(`${ollamaUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      options: { temperature: 0 },
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Ollama request failed (${res.status}): ${detail || "no detail"}`);
  }

  const json = await res.json();
  const raw = (json?.message?.content || "").trim();
  const cleaned = raw.replace(/^```(json)?/i, "").replace(/```$/, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Model didn't return valid JSON: ${raw.slice(0, 200)}`);
  }

  if (!CHART_TYPES.some((t) => t.id === parsed.type)) parsed.type = "bar";
  if (!Array.isArray(parsed.values) || !Array.isArray(parsed.labels)) {
    throw new Error("Model response was missing labels/values arrays.");
  }
  return parsed;
}

export function downloadChartPng(chartInstance, filename = "chart.png") {
  if (!chartInstance) return;
  const url = chartInstance.toBase64Image("image/png", 1);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

export function downloadDataAsCsv(labels, values, filename = "chart-data.csv") {
  const lines = ["label,value"];
  (labels || []).forEach((l, i) => lines.push(`${JSON.stringify(String(l))},${values?.[i] ?? ""}`));
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
