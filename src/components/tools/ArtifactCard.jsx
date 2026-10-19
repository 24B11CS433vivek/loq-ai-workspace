import { useMemo, useState } from "react";
import hljs from "highlight.js";

const EyeIcon = () => (
  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
    <path d="M1 7s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    <circle cx="7" cy="7" r="1.6" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

const CodeIcon = () => (
  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
    <path d="M4.5 3.5 1 7l3.5 3.5M9.5 3.5 13 7l-3.5 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const FullscreenIcon = () => (
  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
    <path d="M1.5 5V2.5a1 1 0 0 1 1-1H5M9 1.5h2.5a1 1 0 0 1 1 1V5M12.5 9v2.5a1 1 0 0 1-1 1H9M5 12.5H2.5a1 1 0 0 1-1-1V9"
          stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M2 2l10 10M12 2 2 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

const CopyIcon = () => (
  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
    <rect x="1.5" y="3.5" width="7" height="8.5" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
    <path d="M4.5 3.5V2.5A1.2 1.2 0 0 1 5.7 1.3H11A1.2 1.2 0 0 1 12.2 2.5V9A1.2 1.2 0 0 1 11 10.2H10"
          stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
    <path d="M2.5 7.3l3 3 6-6.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const DownloadIcon = () => (
  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
    <path d="M7 1.5v7.5M4 6.5 7 9.5 10 6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M2 10.5v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

// Phase 13A/13B/13C -- inline artifact card: compact preview/code viewer
// for a standalone HTML/CSS/JS deliverable, rendered directly under the
// chat message it came from (see Message.jsx + lib/tools/htmlArtifact.js).
// 13B adds a fullscreen expand button that opens the same preview/code
// view full-page in an overlay, sharing the same `tab` state so the
// active tab carries over when you open/close fullscreen. 13C adds Copy
// (writes the full HTML document to the clipboard) and Download (saves
// it as a .html file) to both the inline header and the fullscreen
// toolbar, backed by the same handlers so both surfaces behave alike.
export function ArtifactCard({ title, html }) {
  const [tab, setTab] = useState("preview"); // "preview" | "code"
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);

  const highlighted = useMemo(() => {
    try {
      return hljs.getLanguage("html")
        ? hljs.highlight(html, { language: "html" }).value
        : hljs.highlightAuto(html).value;
    } catch {
      return html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
  }, [html]);

  // Phase 13C -- copy the full self-contained document to the clipboard.
  const copyHtml = async () => {
    try {
      await navigator.clipboard.writeText(html);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable/denied -- fail silently, same as the
      // rest of the app's copy buttons.
    }
  };

  // Phase 13C -- download the document as a standalone .html file.
  const downloadHtml = () => {
    const slug =
      (title || "artifact")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || "artifact";
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <>
    <div className="html-artifact-card">
      <div className="html-artifact-header">
        <div className="html-artifact-titlewrap">
          <span className="html-artifact-dot" />
          <span className="html-artifact-title">{title}</span>
        </div>
        <div className="html-artifact-actions">
          <div className="html-artifact-tabs">
            <button
              type="button"
              className={`html-artifact-tab ${tab === "preview" ? "active" : ""}`}
              onClick={() => setTab("preview")}
            >
              <EyeIcon /> Preview
            </button>
            <button
              type="button"
              className={`html-artifact-tab ${tab === "code" ? "active" : ""}`}
              onClick={() => setTab("code")}
            >
              <CodeIcon /> Code
            </button>
          </div>
          <button
            type="button"
            className={`html-artifact-icon-btn ${copied ? "copied" : ""}`}
            title="Copy code"
            onClick={copyHtml}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
          <button
            type="button"
            className="html-artifact-icon-btn"
            title="Download .html"
            onClick={downloadHtml}
          >
            <DownloadIcon />
          </button>
          <button
            type="button"
            className="html-artifact-expand-btn"
            title="Open fullscreen"
            onClick={() => setFullscreen(true)}
          >
            <FullscreenIcon />
          </button>
        </div>
      </div>
      <div className="html-artifact-body">
        {tab === "preview" ? (
          <iframe
            className="html-artifact-frame"
            srcDoc={html}
            sandbox="allow-scripts allow-forms allow-modals allow-popups"
            title={title}
          />
        ) : (
          <pre className="html-artifact-code">
            <code dangerouslySetInnerHTML={{ __html: highlighted }} />
          </pre>
        )}
      </div>
    </div>
    {fullscreen && (
      <div className="html-artifact-fullscreen-overlay" onClick={() => setFullscreen(false)}>
        <div className="html-artifact-fullscreen-panel" onClick={(e) => e.stopPropagation()}>
          <div className="html-artifact-fullscreen-toolbar">
            <span className="html-artifact-fullscreen-title">{title}</span>
            <div className="html-artifact-tabs">
              <button
                type="button"
                className={`html-artifact-tab ${tab === "preview" ? "active" : ""}`}
                onClick={() => setTab("preview")}
              >
                <EyeIcon /> Preview
              </button>
              <button
                type="button"
                className={`html-artifact-tab ${tab === "code" ? "active" : ""}`}
                onClick={() => setTab("code")}
              >
                <CodeIcon /> Code
              </button>
            </div>
            <button
              type="button"
              className={`html-artifact-icon-btn ${copied ? "copied" : ""}`}
              title="Copy code"
              onClick={copyHtml}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
            <button
              type="button"
              className="html-artifact-icon-btn"
              title="Download .html"
              onClick={downloadHtml}
            >
              <DownloadIcon />
            </button>
            <button
              type="button"
              className="msg-action-btn"
              title="Close"
              onClick={() => setFullscreen(false)}
            >
              <CloseIcon />
            </button>
          </div>
          <div className="html-artifact-fullscreen-body">
            {tab === "preview" ? (
              <iframe
                className="html-artifact-frame html-artifact-frame-full"
                srcDoc={html}
                sandbox="allow-scripts allow-forms allow-modals allow-popups"
                title={title}
              />
            ) : (
              <pre className="html-artifact-code html-artifact-code-full">
                <code dangerouslySetInnerHTML={{ __html: highlighted }} />
              </pre>
            )}
          </div>
        </div>
      </div>
    )}
    </>
  );
}
