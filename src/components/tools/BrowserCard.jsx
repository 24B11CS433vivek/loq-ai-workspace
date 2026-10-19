// Inline chat-rendered result of a browser automation task. Mirrors
// DiagramCard.jsx's shape (skeleton export + default card export) but
// renders a step log + summary instead of an SVG, since a browser
// task's output is a sequence of actions, not a single artifact.

export function GeneratingBrowserSkeleton({ label = "Running browser task…" }) {
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

export default function BrowserCard({ steps, summary, error }) {
  if (error) {
    return (
      <div className="inline-data-artifact inline-image-artifact">
        <div className="inline-data-artifact-header">
          <span className="inline-data-artifact-label">Browser task failed</span>
        </div>
        <p style={{ color: "var(--text-danger, #c0392b)" }}>{error}</p>
      </div>
    );
  }
  return (
    <div className="inline-data-artifact inline-image-artifact">
      <div className="inline-data-artifact-header">
        <span className="inline-data-artifact-label">Browser task</span>
      </div>
      {summary && <p>{summary}</p>}
      {steps?.length > 0 && (
        <ol style={{ margin: "8px 0 0", paddingLeft: "20px" }}>
          {steps.map((s, i) => (
            <li key={i} style={{ opacity: s.ok === false ? 0.6 : 1 }}>
              {s.action}
              {s.target ? ` → ${s.target}` : ""}
              {s.ok === false ? ` (failed: ${s.error})` : ""}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
