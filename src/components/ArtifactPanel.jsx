export default function ArtifactPanel({ open, onClose, content }) {
  return (
    <div id="artifact-panel" className={open ? "open" : ""}>
      <div className="artifact-header">
        <span className="artifact-title">Artifacts</span>
        <div className="artifact-actions">
          <button className="artifact-btn" onClick={onClose} title="Close panel">✕</button>
        </div>
      </div>
      <div className="artifact-body">
        {content || "Tool outputs and generated artifacts will render here — wire up Phase 2 extensions in src/lib/extensions.js."}
      </div>
    </div>
  );
}
