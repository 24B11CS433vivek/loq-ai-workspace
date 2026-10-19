// Inline chat-rendered result of an English Teacher Mode turn. Mirrors
// BrowserCard.jsx's shape (skeleton export + default card export) but
// renders a correction, an optional interactive quiz, and/or an
// optional story instead of a step log, since a lesson turn's payload
// varies by lesson type.
import { useState } from "react";

export function GeneratingTeacherSkeleton({ label = "Thinking through your answer…" }) {
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

// One quiz question, click-to-answer -- was previously rendered with
// the correct option already bolded, which gave the answer away before
// the student even guessed. onAnswered (only wired on the last question
// of the last message) fires once, right after picking, to trigger the
// next quiz question automatically -- so quiz mode keeps going on its
// own instead of stopping after one batch.
function QuizQuestion({ q, onAnswered }) {
  const [picked, setPicked] = useState(null);
  const answered = picked !== null;
  const handlePick = (j) => {
    if (answered) return;
    setPicked(j);
    onAnswered?.();
  };
  return (
    <li style={{ marginBottom: 10 }}>
      {q.question}
      <ul style={{ margin: "4px 0", paddingLeft: 0, listStyle: "none" }}>
        {(q.options || []).map((opt, j) => {
          const isCorrect = j === q.answer_index;
          const isPicked = j === picked;
          let color = "inherit";
          if (answered && isCorrect) color = "var(--text-success, #2e7d32)";
          else if (answered && isPicked && !isCorrect) color = "var(--text-danger, #c0392b)";
          return (
            <li key={j} style={{ marginBottom: 3 }}>
              <button
                onClick={() => handlePick(j)}
                disabled={answered}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border, #333)",
                  borderRadius: 6,
                  padding: "4px 8px",
                  color,
                  fontWeight: answered && (isCorrect || isPicked) ? 600 : 400,
                  cursor: answered ? "default" : "pointer",
                  textAlign: "left",
                  width: "100%",
                }}
              >
                {answered && isCorrect ? "✓ " : answered && isPicked ? "✗ " : ""}
                {opt}
              </button>
            </li>
          );
        })}
      </ul>
      {answered && q.explanation && <span style={{ opacity: 0.75, fontSize: "0.9em" }}>{q.explanation}</span>}
    </li>
  );
}

const SEVERITY_COLORS = { minor: "#c9a227", moderate: "#d4714a", major: "#c0392b" };

function scoreColor(score) {
  if (score == null) return "inherit";
  if (score >= 80) return "var(--text-success, #2e7d32)";
  if (score >= 55) return "#c9a227";
  return "var(--text-danger, #c0392b)";
}

export default function TeacherCard({ lesson, phase, corrected, correctionNote, category, severity, score, nextFocus, avgScore, quiz, story, weakSpots, error, onQuizAnswered, onContinueStory }) {
  if (error) {
    return (
      <div className="inline-data-artifact inline-image-artifact">
        <div className="inline-data-artifact-header">
          <span className="inline-data-artifact-label">Teacher mode failed</span>
        </div>
        <p style={{ color: "var(--text-danger, #c0392b)" }}>{error}</p>
      </div>
    );
  }

  const hasAnything = corrected || correctionNote || (quiz && quiz.length) || (story && story.text) || (weakSpots && weakSpots.length);
  if (!hasAnything) return null;

  return (
    <div className="inline-data-artifact inline-image-artifact">
      <div className="inline-data-artifact-header" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="inline-data-artifact-label">English Teacher{lesson ? ` — ${lesson}` : ""}</span>
        {phase && (
          <span style={{ fontSize: "0.72em", padding: "1px 6px", borderRadius: 10, border: "1px solid var(--border)", opacity: 0.75, textTransform: "capitalize" }}>
            {phase}
          </span>
        )}
        {typeof score === "number" && (
          <span style={{ fontSize: "0.75em", fontWeight: 600, color: scoreColor(score) }}>Turn: {score}/100</span>
        )}
        {typeof avgScore === "number" && (
          <span style={{ fontSize: "0.72em", opacity: 0.6 }}>· avg {avgScore}</span>
        )}
      </div>
      {(corrected || correctionNote) && (
        <p
          style={{
            margin: "0 0 6px",
            padding: "6px 8px",
            borderLeft: `3px solid ${severity ? SEVERITY_COLORS[severity] || "var(--accent, #d4714a)" : "var(--accent, #d4714a)"}`,
            background: "rgba(212,113,74,0.08)",
          }}
        >
          <strong>⚠ Fix{category ? ` (${category}${severity ? `, ${severity}` : ""})` : ""}:</strong> {corrected && <em>{corrected}</em>}
          {correctionNote && <span style={{ opacity: 0.85 }}> — {correctionNote}</span>}
        </p>
      )}
      {nextFocus && (
        <p style={{ margin: "0 0 6px", fontSize: "0.85em", opacity: 0.8 }}>
          <strong>🎯 Next focus:</strong> {nextFocus}
        </p>
      )}
      {quiz && quiz.length > 0 && (
        <ol style={{ margin: "8px 0 0", paddingLeft: "20px" }}>
          {quiz.map((q, i) => (
            <QuizQuestion key={i} q={q} onAnswered={i === quiz.length - 1 ? onQuizAnswered : undefined} />
          ))}
        </ol>
      )}
      {story && story.text && (
        <div style={{ marginTop: 6 }}>
          <p>{story.text}</p>
          {story.questions && story.questions.length > 0 && (
            <ul style={{ paddingLeft: 18 }}>
              {story.questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          )}
          {onContinueStory && (
            <button
              onClick={onContinueStory}
              style={{
                marginTop: 8,
                background: "transparent",
                border: "1px solid var(--border, #333)",
                borderRadius: 6,
                padding: "5px 10px",
                cursor: "pointer",
                fontSize: "0.85em",
                color: "inherit",
              }}
            >
              New story →
            </button>
          )}
        </div>
      )}
      {weakSpots && weakSpots.length > 0 && (
        <p style={{ marginTop: 8, opacity: 0.7, fontSize: "0.85em" }}>Still working on: {weakSpots.join(", ")}</p>
      )}
    </div>
  );
}
