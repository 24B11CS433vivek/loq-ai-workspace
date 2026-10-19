// Phase 10 — uploads an image to the backend for vision-model
// description (OCR, chart reading, screenshot/UI analysis) via
// Ollama's multimodal qwen2.5vl:7b. Mirrors documents.js's shape.
export async function describeImage({ backendUrl, file, prompt }) {
  const form = new FormData();
  form.append("file", file);
  if (prompt) form.append("prompt", prompt);

  const res = await fetch(`${backendUrl.replace(/\/$/, "")}/tools/vision/describe`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Vision request failed (${res.status})`);
  }

  return res.json(); // { filename, model, text }
}
