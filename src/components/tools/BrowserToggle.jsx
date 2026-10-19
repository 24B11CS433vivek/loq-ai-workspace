// Browser automation quick-run toggle. Same pattern as DiagramToggle.jsx:
// clicking arms "browser mode" so the composer's normal Enter/send
// routes to onGenerateBrowserTask instead of a chat message.
export default function BrowserToggle({ active, onToggle }) {
  return (
    <button
      className={`tool-btn compare-toggle ${active ? "active" : ""}`}
      title={active ? "Browser mode on — type a task and press Enter to run it" : "Turn on browser automation mode"}
      onClick={onToggle}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
        <path d="M3.5 9h17M3.5 15h17" stroke="currentColor" strokeWidth="1.7" />
        <path d="M12 3c1.8 2.2 2.8 5.4 2.8 9s-1 6.8-2.8 9c-1.8-2.2-2.8-5.4-2.8-9s1-6.8 2.8-9Z" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    </button>
  );
}
