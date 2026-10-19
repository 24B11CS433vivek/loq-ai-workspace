// Phase 4 — uploads a document to the backend for text extraction.
export async function extractDocument({ backendUrl, file }) {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${backendUrl.replace(/\/$/, "")}/tools/document/extract`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Extraction failed (${res.status})`);
  }

  return res.json(); // { filename, text, meta }
}
