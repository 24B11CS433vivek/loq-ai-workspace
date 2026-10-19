import { useRef, useState } from "react";
import { extractDocument } from "../../lib/tools/documents";

export default function DocumentButton({ backendUrl, onAttach }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setBusy(true);
    try {
      const { filename, text, meta } = await extractDocument({ backendUrl, file });
      onAttach({
        id: crypto.randomUUID(),
        type: "document",
        name: filename,
        text,
        meta,
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
        accept=".pdf,.docx,.xlsx,.pptx"
        style={{ display: "none" }}
        onChange={handleFile}
      />
      <button
        className="tool-btn"
        title="Attach document"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
      >
        {busy ? "…" : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M9 13h6M9 17h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    </>
  );
}
