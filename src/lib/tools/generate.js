// Universal Generator client. Backend endpoint: POST /tools/universal-generate
// (multipart/form-data — prompt, pasted_text, output_format, files[]).
// One shared content spec drives every output format on the backend, so
// this file just posts the form and hands back the resulting file info.

export const OUTPUT_FORMATS = [
  "docx", "pdf", "pptx", "xlsx", "csv", "md", "txt", "html",
];

export async function generateFile({ backendUrl, outputFormat, prompt, pastedText, files, model }) {
  const form = new FormData();
  form.append("prompt", prompt || "");
  form.append("pasted_text", pastedText || "");
  form.append("output_format", outputFormat);
  // Whatever model is picked in Settings -- previously this endpoint
  // always used its own hardcoded backend model no matter what you'd
  // selected for chat.
  if (model) form.append("model", model);
  (files || []).forEach((file) => form.append("files", file));

  console.log("[generate] POST /tools/universal-generate ->", backendUrl, { outputFormat, prompt, pastedText, fileCount: (files || []).length });
  let res;
  try {
    res = await fetch(`${backendUrl.replace(/\/$/, "")}/tools/universal-generate`, {
      method: "POST",
      body: form,
    });
  } catch (networkErr) {
    console.error("[generate] network error calling /tools/universal-generate — is the backend running and CORS-allowed for this origin?", networkErr);
    throw new Error(`Could not reach the backend at ${backendUrl} (network/CORS error): ${networkErr.message}`);
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    console.error("[generate] /tools/universal-generate returned", res.status, errBody);
    throw new Error(errBody.detail || `File generation failed (${res.status})`);
  }

  const json = await res.json();
  console.log("[generate] result <-", json);
  return json; // { kind, filename, url, title, section_count }
}

// The backend only returns a relative /files/<name> path — turn it
// into an absolute URL against the same backend the request went to.
export function fileDownloadUrl(backendUrl, relativeUrl) {
  return `${backendUrl.replace(/\/$/, "")}${relativeUrl}`;
}
