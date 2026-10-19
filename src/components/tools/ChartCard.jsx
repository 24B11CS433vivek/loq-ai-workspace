import { useEffect, useRef, useState } from "react";
import { CHART_TYPES, renderChart, downloadChartPng, downloadDataAsCsv } from "../../lib/tools/chartEngine";

// Phase 19B (revised) — inline chat-rendered chart result. Mirrors
// SvgCard.jsx's GeneratingSvgSkeleton/SvgCard shape and reuses its
// CSS classes (image-artifact, image-artifact-footer,
// image-artifact-badges, image-artifact-enhance-btn) so it matches
// the rest of the app. chart-artifact-* classes (theme.css) only
// cover what's genuinely different: the canvas box and type select.

export function GeneratingChartSkeleton({ label = "Rendering chart…" }) {
  return (
    <div className="image-artifact inline-image-artifact svg-artifact">
      <div className="chart-artifact-canvas-wrap chart-artifact-loading">
        <div className="image-artifact-skeleton-shimmer" />
      </div>
      <div className="image-artifact-footer">
        <span className="image-artifact-caption shimmer-text">{label}</span>
      </div>
    </div>
  );
}

export default function ChartCard({ type, labels, values, datasets, prompt, error }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const [activeType, setActiveType] = useState(type || "bar");
  const [renderError, setRenderError] = useState(null);

  const rawData = datasets ? { labels, datasets } : { labels, values };

  useEffect(() => {
    if (error || !canvasRef.current) return;
    try {
      chartRef.current = renderChart(canvasRef.current, activeType, rawData);
      setRenderError(null);
    } catch (e) {
      console.error("[ChartCard] render failed:", e);
      setRenderError(e.message);
    }
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeType, JSON.stringify(labels), JSON.stringify(values), JSON.stringify(datasets)]);

  if (error) {
    return <div className="data-artifact-error">⚠️ Chart generation failed: {error}</div>;
  }

  const handleDownloadPng = () => downloadChartPng(chartRef.current, `${(prompt || "chart").slice(0, 40).replace(/[^a-z0-9]+/gi, "-")}.png`);
  const handleDownloadCsv = () => downloadDataAsCsv(labels, values, `${(prompt || "chart-data").slice(0, 40).replace(/[^a-z0-9]+/gi, "-")}.csv`);

  return (
    <div className="image-artifact svg-artifact">
      <div className="chart-artifact-canvas-wrap">
        <canvas ref={canvasRef} />
      </div>

      {renderError && <div className="chart-artifact-error">⚠️ {renderError}</div>}

      <div className="image-artifact-footer">
        <span className="image-artifact-caption" title={prompt}>{prompt}</span>
        <span className="image-artifact-badges">
          <select
            className="chart-artifact-type-select"
            value={activeType}
            onChange={(e) => setActiveType(e.target.value)}
          >
            {CHART_TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </span>
      </div>

      <div className="image-artifact-actions">
        <button className="image-artifact-enhance-btn" onClick={handleDownloadPng}>
          Download PNG
        </button>
        <button className="image-artifact-enhance-btn" onClick={handleDownloadCsv}>
          Download CSV
        </button>
      </div>
    </div>
  );
}
