// Phase 19B — SVG quick-generate toggle. Same pattern as ImagePanel.jsx's
// ImageButton: clicking arms "svg mode" so the composer's normal
// Enter/send routes to onGenerateSvg instead of a chat message — type
// a prompt, press Enter, get an SVG, every time, until toggled off.
export default function SvgToggle({ active, onToggle }) {
  return (
    <button
      className={`tool-btn compare-toggle ${active ? "active" : ""}`}
      title={active ? "SVG mode on — type a prompt and press Enter to generate" : "Turn on SVG mode"}
      onClick={onToggle}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
        <path d="M4 4h16v16H4z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M7.5 15.5l3-4.5 2.5 3.3L16 9.5l3.5 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
