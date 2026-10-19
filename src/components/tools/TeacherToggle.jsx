// English Teacher Mode toggle. Same "arms a mode, Enter/send routes
// to a dedicated handler" shape as BrowserToggle.jsx, plus a small
// popover to pick which kind of lesson runs next -- switchable anytime
// without turning the mode off first.
import { useState } from "react";
import { LESSON_TYPES, LEVELS, TEACHER_STYLES } from "../../lib/tools/teacherEngine";

export default function TeacherToggle({ active, onToggle, lesson, onSetLesson, level, onSetLevel, style, onSetStyle, progress }) {
  const [showMenu, setShowMenu] = useState(false);

  const handleClick = () => {
    if (!active) {
      onToggle();
      setShowMenu(true);
      return;
    }
    setShowMenu((v) => !v);
  };

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        className={`tool-btn compare-toggle ${active ? "active" : ""}`}
        title={active ? `Teacher mode on — ${lesson}. Click to change lesson.` : "Turn on English Teacher mode"}
        onClick={handleClick}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
          <path d="M4 19V6.5A2.5 2.5 0 0 1 6.5 4H20v13.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 19a2 2 0 0 0 2 2h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8 8h9M8 11.5h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {active && showMenu && (
        <div
          className="teacher-lesson-menu"
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: 0,
            background: "var(--bg-panel)",
            color: "var(--text)",
            boxShadow: "var(--shadow-sm)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 4,
            zIndex: 20,
            minWidth: 170,
          }}
        >
          {progress && (
            <div style={{ padding: "2px 8px 6px", fontSize: "0.78em", opacity: 0.7, borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
              {progress.turns} turns{progress.avgScore != null ? ` · avg ${progress.avgScore}` : ""}
            </div>
          )}
          {LESSON_TYPES.map((l) => (
            <button
              key={l.id}
              onClick={() => {
                onSetLesson(l.id);
                setShowMenu(false);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "6px 8px",
                background: l.id === lesson ? "var(--accent)" : "transparent",
                color: l.id === lesson ? "#fff" : "inherit",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: "0.85em",
              }}
            >
              {l.label}
            </button>
          ))}
          {onSetLevel && (
            <>
              <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0" }} />
              <div style={{ padding: "2px 8px", fontSize: "0.72em", opacity: 0.6, textTransform: "uppercase" }}>Level</div>
              <select
                value={level}
                onChange={(e) => onSetLevel(e.target.value)}
                style={{ width: "100%", marginBottom: 4, background: "var(--bg-panel)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4, padding: "4px 6px", fontSize: "0.82em" }}
              >
                {LEVELS.map((lv) => (
                  <option key={lv.id} value={lv.id}>{lv.label}</option>
                ))}
              </select>
            </>
          )}
          {onSetStyle && (
            <>
              <div style={{ padding: "2px 8px", fontSize: "0.72em", opacity: 0.6, textTransform: "uppercase" }}>Style</div>
              <select
                value={style}
                onChange={(e) => onSetStyle(e.target.value)}
                style={{ width: "100%", background: "var(--bg-panel)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4, padding: "4px 6px", fontSize: "0.82em" }}
              >
                {TEACHER_STYLES.map((st) => (
                  <option key={st.id} value={st.id}>{st.label}</option>
                ))}
              </select>
            </>
          )}
        </div>
      )}
    </div>
  );
}
