// Conversion Mode client. Backend endpoint: POST /tools/convert
// (multipart/form-data — prompt, files[]). Returns one or more
// converted files (e.g. a PDF split into pages, a zip's contents,
// or a batch of images all converted at once).

export async function convertFiles({ backendUrl, files, prompt }) {
  const form = new FormData();
  form.append("prompt", prompt || "");
  (files || []).forEach((file) => form.append("files", file));

  console.log("[convert] POST /tools/convert ->", backendUrl, { prompt, fileCount: (files || []).length });
  let res;
  try {
    res = await fetch(`${backendUrl.replace(/\/$/, "")}/tools/convert`, {
      method: "POST",
      body: form,
    });
  } catch (networkErr) {
    console.error("[convert] network error calling /tools/convert", networkErr);
    throw new Error(`Could not reach the backend at ${backendUrl} (network/CORS error): ${networkErr.message}`);
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    console.error("[convert] /tools/convert returned", res.status, errBody);
    throw new Error(errBody.detail || `Conversion failed (${res.status})`);
  }

  const json = await res.json();
  console.log("[convert] result <-", json);
  return json; // { results: [{ filename, url, source_format, target_format }, ...] }
}

// Same shape as fileDownloadUrl in generate.js — the backend only
// returns a relative /files/<name> path.
export function convertDownloadUrl(backendUrl, relativeUrl) {
  return `${backendUrl.replace(/\/$/, "")}${relativeUrl}`;
}
