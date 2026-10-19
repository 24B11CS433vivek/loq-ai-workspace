import { useRef, useState } from "react";
import { describeImage } from "../../lib/tools/vision";

// Phase 10 — Vision Mode. Same shape as DocumentButton: uploads a
// file, wraps the result as a { type: "document", text } attachment
// so it flows through App.jsx's existing buildDocContext() straight
// into the assistant's context -- no chat-flow changes needed.
export default function VisionButton({ backendUrl, onAttach }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setBusy(true);
    try {
      const { filename, model, text } = await describeImage({ backendUrl, file });
      onAttach({
        id: crypto.randomUUID(),
        type: "document",
        name: `Vision: ${filename}`,
        text: `[Image analysis of ${filename}, via ${model}]\n${text}`,
        meta: { source: "vision", model },
      });
    } catch (err) {
      onAttach({
        id: crypto.randomUUID(),
        type: "document-error",
        name: file.name,
        text: "",
        meta: { error: err.message },
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
        style={{ display: "none" }}
        onChange={handleFile}
      />
      <button
        className="tool-btn"
        title="Attach image for vision analysis (OCR, charts, screenshots)"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
      >
        {busy ? "…" : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.7" />
            <circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" strokeWidth="1.7" />
            <path d="M21 15.5 16 10l-8.5 8.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    </>
  );
}
