// Phase 19B (revised) — Chart quick-generate toggle. Same pattern as
// SvgToggle.jsx: clicking arms "chart mode" so the composer's normal
// Enter/send routes to onGenerateChart instead of a chat message.
export default function ChartToggle({ active, onToggle }) {
  return (
    <button
      className={`tool-btn compare-toggle ${active ? "active" : ""}`}
      title={active ? "Chart mode on — type a prompt and press Enter to generate" : "Turn on chart mode"}
      onClick={onToggle}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
        <path d="M4 20V10M12 20V4M20 20v-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
