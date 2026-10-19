// Phase 19C — Diagram quick-generate toggle. Same pattern as
// ChartToggle.jsx: clicking arms "diagram mode" so the composer's
// normal Enter/send routes to onGenerateDiagram instead of a chat
// message.
export default function DiagramToggle({ active, onToggle }) {
  return (
    <button
      className={`tool-btn compare-toggle ${active ? "active" : ""}`}
      title={active ? "Diagram mode on — type a prompt and press Enter to generate" : "Turn on diagram mode"}
      onClick={onToggle}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="7" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
        <rect x="14" y="3" width="7" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
        <rect x="8.5" y="15" width="7" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
        <path d="M6.5 9v2a2 2 0 0 0 2 2h1M17.5 9v2a2 2 0 0 0-2 2h-1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    </button>
  );
}
