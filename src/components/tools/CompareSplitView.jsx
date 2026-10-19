export default function CompareSplitView({ prompt, modelA, modelB, textA, textB, loading, onClose }) {
  return (
    <div id="compare-overlay">
      <div className="compare-overlay-header">
        <span className="compare-overlay-prompt" title={prompt}>{prompt}</span>
        <button className="btn btn-ghost" onClick={onClose}>✕ Close compare</button>
      </div>
      <div className="compare-overlay-body">
        <div className="compare-pane">
          <div className="compare-pane-header">{modelA || "Model A"}</div>
          <div className="compare-pane-body">{loading && !textA ? "Generating…" : textA}</div>
        </div>
        <div className="compare-pane-divider" />
        <div className="compare-pane">
          <div className="compare-pane-header">{modelB || "Model B"}</div>
          <div className="compare-pane-body">{loading && !textB ? "Generating…" : textB}</div>
        </div>
      </div>
    </div>
  );
}
