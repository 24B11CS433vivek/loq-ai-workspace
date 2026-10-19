import { useEffect, useRef, useState } from "react";
import { renderMermaid, downloadDiagramSvg, diagramDownloadFilename } from "../../lib/tools/diagram";

// Phase 19C — inline chat-rendered Mermaid diagram result. Mirrors
// ChartCard.jsx's GeneratingChartSkeleton/Card shape, but renders a
// static SVG via dangerouslySetInnerHTML (SvgCard.jsx's pattern)
// instead of a live canvas, since Mermaid owns its own layout/render
// pass rather than an imperative draw API. Reuses the same
// image-artifact-* CSS classes as ChartCard/SvgCard; diagram-artifact-*
// classes (theme.css) only cover the render box.

export function GeneratingDiagramSkeleton({ label = "Rendering diagram…" }) {
  return (
    <div className="image-artifact inline-image-artifact svg-artifact">
      <div className="diagram-artifact-render diagram-artifact-loading">
        <div className="image-artifact-skeleton-shimmer" />
      </div>
      <div className="image-artifact-footer">
        <span className="image-artifact-caption shimmer-text">{label}</span>
      </div>
    </div>
  );
}

export default function DiagramCard({ code, prompt, error }) {
  const [svg, setSvg] = useState("");
  const [renderError, setRenderError] = useState(null);
  const [themeVariant, setThemeVariant] = useState("dark");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const idRef = useRef(`diagram-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    if (error || !code) return;
    let cancelled = false;
    renderMermaid(code, idRef.current, themeVariant)
      .then((out) => {
        if (!cancelled) {
          setSvg(out);
          setRenderError(null);
        }
      })
      .catch((e) => {
        console.error("[DiagramCard] render failed:", e);
        if (!cancelled) setRenderError(e.message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, themeVariant]);

  if (error) {
    return <div className="data-artifact-error">⚠️ Diagram generation failed: {error}</div>;
  }

  const handleDownload = () => downloadDiagramSvg(svg, diagramDownloadFilename(prompt));

  const handleCopy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error("[DiagramCard] clipboard copy failed", e);
    }
  };

  return (
    <div className="image-artifact svg-artifact">
      <div
        className="diagram-artifact-render"
        dangerouslySetInnerHTML={{ __html: svg || "" }}
      />

      {renderError && <div className="chart-artifact-error">⚠️ {renderError}</div>}

      <div className="image-artifact-footer">
        <span className="image-artifact-caption" title={prompt}>{prompt}</span>
        <span className="image-artifact-badges">
          <button
            className="image-artifact-style-pill diagram-artifact-theme-btn"
            onClick={() => setThemeVariant((v) => (v === "dark" ? "light" : "dark"))}
            title="Switch diagram theme"
          >
            {themeVariant === "dark" ? "Dark" : "Light"}
          </button>
        </span>
      </div>

      <div className="image-artifact-actions">
        <button className="image-artifact-enhance-btn" onClick={handleDownload}>
          Download SVG
        </button>
        <button className="image-artifact-enhance-btn" onClick={handleCopy}>
          {copied ? "Copied!" : "Copy Mermaid code"}
        </button>
        <button className="image-artifact-enhance-btn" onClick={() => setSourceOpen((v) => !v)}>
          {sourceOpen ? "Hide Mermaid source" : "Show Mermaid source"}
        </button>
      </div>

      {sourceOpen && <pre className="svg-artifact-plan diagram-artifact-source">{code}</pre>}
    </div>
  );
}
