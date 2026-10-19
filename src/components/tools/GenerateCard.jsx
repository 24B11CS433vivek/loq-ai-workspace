import { useState } from "react";
import { OUTPUT_FORMATS } from "../../lib/tools/generate";

const PRIMARY_FORMATS = ["docx", "pdf", "pptx", "xlsx", "csv", "md", "txt", "html"];
const MORE_FORMATS = OUTPUT_FORMATS.filter((f) => !PRIMARY_FORMATS.includes(f));

const FORMAT_LABEL = {
  docx: "DOCX", pdf: "PDF", pptx: "PPTX", xlsx: "XLSX", csv: "CSV",
  md: "MD", txt: "TXT", html: "HTML",
};

// Universal Generator popover — pick an output format, then Generate.
// The user's typed message (draft) plus any attached files become the
// input; App.jsx's handleGenerateFile runs the request as a normal chat
// turn (state-row animation + inline download card under the assistant
// reply — see Message.jsx).
export default function GenerateButton({ draft, attachments = [], onGenerate }) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState("docx");
  const [showMore, setShowMore] = useState(false);

  const handleGenerate = () => {
    const hasFiles = attachments.some((a) => a.type === "document" && a.text);
    if (!(draft || "").trim() && !hasFiles) {
      alert("Type a prompt, paste some text, or attach a file first, then click Generate.");
      return;
    }
    onGenerate({ outputFormat: format });
    setOpen(false);
  };

  return (
    <div className="generate-tool-wrap">
      <button
        className="tool-btn"
        title="Generate a document from your message, pasted text, or files"
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          <path d="M9 15h6M12 12v6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="generate-popover">
          <div className="generate-popover-row generate-format-grid">
            {PRIMARY_FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                className={`generate-kind-btn${format === f ? " active" : ""}`}
                onClick={() => setFormat(f)}
              >
                {FORMAT_LABEL[f]}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="generate-more-toggle"
            onClick={() => setShowMore((v) => !v)}
          >
            {showMore ? "Fewer formats ▲" : "More formats ▼"}
          </button>
          {showMore && (
            <div className="generate-popover-row generate-format-grid generate-format-grid-more">
              {MORE_FORMATS.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`generate-kind-btn${format === f ? " active" : ""}`}
                  onClick={() => setFormat(f)}
                >
                  .{f}
                </button>
              ))}
            </div>
          )}
          <p className="generate-popover-hint">
            Uses your typed message, pasted text, or attached files as the source.
          </p>
          <button className="generate-popover-submit" onClick={handleGenerate}>
            Generate {(FORMAT_LABEL[format] || `.${format}`)}
          </button>
        </div>
      )}
    </div>
  );
}

// Renders a /tools/universal-generate result (or its error) inline in
// the chat, under the assistant's message. Reuses .data-artifact-* classes.
export function GenerateCard({ kind, filename, downloadUrl, title, meta, error }) {
  if (error) {
    return <div className="data-artifact-error">⚠️ File generation failed: {error}</div>;
  }
  const label = FORMAT_LABEL[kind] || `.${kind}`;
  return (
    <div className="data-artifact">
      <h3 className="data-artifact-title">{title || filename}</h3>
      <p className="data-artifact-op">{label} · {filename}</p>
      {typeof meta?.section_count === "number" && (
        <p className="data-artifact-caption">{meta.section_count} sections</p>
      )}
      <a className="generate-download-btn" href={downloadUrl} download={filename} target="_blank" rel="noreferrer">
        ⬇ Download {filename}
      </a>
    </div>
  );
}
