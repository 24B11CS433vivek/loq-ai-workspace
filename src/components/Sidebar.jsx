import { useState } from "react";

export default function Sidebar({
  open,
  sessions,
  currentId,
  onNewChat,
  onSelect,
  onDelete,
  onRename,
  onOpenSettings,
  onToggle,
}) {
  const [query, setQuery] = useState("");
  const filtered = sessions.filter((s) => s.title.toLowerCase().includes(query.toLowerCase()));

  const isMobile = () => window.innerWidth <= 640;

  const handleNewChat = () => {
    onNewChat();
    if (onToggle) onToggle(false);
  };

  const handleSelect = (id) => {
    onSelect(id);
    if (isMobile() && onToggle) onToggle(false);
  };

  return (
    <>
      <nav id="sidebar" className={open ? "" : "collapsed"} aria-label="Chat history">
        <div className="sidebar-top">
          <div className="sidebar-brand">
            <span className="dot" />
            <span>Local AI</span>
            {onToggle && (
              <button
                className="sidebar-collapse-btn"
                onClick={() => onToggle(false)}
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M9 4v16M4 4h16v16H4V4z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>

          <button className="new-chat-btn" onClick={handleNewChat}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span>New chat</span>
          </button>

          <div className="sidebar-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
              <path d="M21 21l-4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <input placeholder="Search chats" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>

        <div className="sidebar-section-label">Recent</div>
        <div className="sidebar-list">
          {filtered.length === 0 ? (
            <div className="sidebar-empty">No chats found</div>
          ) : (
            filtered.map((s) => (
              <div
                key={s.id}
                className={`session-item ${s.id === currentId ? "active" : ""}`}
                onClick={() => handleSelect(s.id)}
                onDoubleClick={() => {
                  const title = prompt("Rename chat", s.title);
                  if (title) onRename(s.id, title);
                }}
              >
                <span className="title">{s.title}</span>
                <button
                  className="del-btn"
                  title="Delete chat"
                  aria-label="Delete chat"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(s.id);
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            ))
          )}
        </div>

        <div className="sidebar-bottom">
          <button className="settings-link" onClick={onOpenSettings}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
              <path
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
                stroke="currentColor"
                strokeWidth="1.4"
              />
            </svg>
            <span>Settings</span>
          </button>
        </div>
      </nav>
    </>
  );
}
