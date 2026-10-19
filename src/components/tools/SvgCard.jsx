import { useState } from "react";
import { svgDownloadFilename } from "../../lib/tools/svg";

// Phase 19B — inline chat-rendered SVG result. Mirrors ImagePanel.jsx's
// ImageCard/GeneratingImageSkeleton shape and reuses its CSS classes
// (image-artifact, image-artifact-footer, image-artifact-badges,
// image-artifact-enhance-btn) so it matches the rest of the app
// without needing a parallel set of styles. svg-artifact-* classes
// below (theme.css) only cover the bits that are genuinely different:
// the white render box and the collapsible design-brief text.

export function GeneratingSvgSkeleton({ label = "Generating SVG…" }) {
  return (
    <div className="image-artifact inline-image-artifact svg-artifact">
      <div className="svg-artifact-render svg-artifact-render-loading">
        <div className="image-artifact-skeleton-shimmer" />
      </div>
      <div className="image-artifact-footer">
        <span className="image-artifact-caption shimmer-text">{label}</span>
      </div>
    </div>
  );
}

export default function SvgCard({ svgCode, prompt, style, model, plan, error }) {
  const [copied, setCopied] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);

  if (error) {
    return <div className="data-artifact-error">⚠️ SVG generation failed: {error}</div>;
  }

  const handleDownload = () => {
    if (!svgCode) return;
    const blob = new Blob([svgCode], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = svgDownloadFilename(prompt);
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    if (!svgCode) return;
    try {
      await navigator.clipboard.writeText(svgCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error("[SvgCard] clipboard copy failed", e);
    }
  };

  return (
    <div className="image-artifact svg-artifact">
      <div
        className="svg-artifact-render"
        dangerouslySetInnerHTML={{ __html: svgCode || "" }}
      />

      <div className="image-artifact-footer">
        <span className="image-artifact-caption" title={prompt}>{prompt}</span>
        <span className="image-artifact-badges">
          {style && <span className="image-artifact-style-pill">{style}</span>}
          {model && <span className="image-artifact-style-pill">{model}</span>}
        </span>
      </div>

      <div className="image-artifact-actions">
        <button className="image-artifact-enhance-btn" onClick={handleDownload}>
          Download SVG
        </button>
        <button className="image-artifact-enhance-btn" onClick={handleCopy}>
          {copied ? "Copied!" : "Copy code"}
        </button>
        {plan && (
          <button className="image-artifact-enhance-btn" onClick={() => setPlanOpen((v) => !v)}>
            {planOpen ? "Hide design brief" : "Show design brief"}
          </button>
        )}
      </div>

      {planOpen && plan && <div className="svg-artifact-plan">{plan}</div>}
    </div>
  );
}
