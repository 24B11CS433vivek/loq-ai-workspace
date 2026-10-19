// Creative Studio client. Backend endpoints (backend/routers/image.py):
//   POST /tools/image/generate  — ComfyUI txt2img, returns a saved PNG (9a)
//   POST /tools/image/enhance   — gfpgan/realesrgan/rembg/color chain (9b)
// This file only wires 9c (generate); enhance() is here now so 9d can
// wire the button without touching this file again.

export async function generateImage({ backendUrl, prompt, style = "illustrative", width = 512, height = 512 }) {
  console.log("[imagegen] POST /tools/image/generate ->", backendUrl, { prompt, style, width, height });
  let res;
  try {
    res = await fetch(`${backendUrl.replace(/\/$/, "")}/tools/image/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, style, width, height }),
    });
  } catch (networkErr) {
    console.error("[imagegen] network error calling /tools/image/generate — is the backend running and CORS-allowed for this origin?", networkErr);
    throw new Error(`Could not reach the backend at ${backendUrl} (network/CORS error): ${networkErr.message}`);
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    console.error("[imagegen] /tools/image/generate returned", res.status, errBody);
    throw new Error(errBody.detail || `Image generation failed (${res.status})`);
  }

  const json = await res.json();
  console.log("[imagegen] result <-", json);
  return json; // { filename, url, style, prompt, width, height }
}

// Wired in Phase 9d — kept here now so ImagePanel.jsx's "Enhance" button
// has a real function to call as soon as it's hooked up.
export async function enhanceImage({ backendUrl, filename, faceFix, upscale, upscaleFactor = 2, removeBg, colorGrade }) {
  console.log("[imagegen] POST /tools/image/enhance ->", backendUrl, { filename, faceFix, upscale, upscaleFactor, removeBg, colorGrade });
  let res;
  try {
    res = await fetch(`${backendUrl.replace(/\/$/, "")}/tools/image/enhance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename,
        face_fix: !!faceFix,
        upscale: !!upscale,
        upscale_factor: upscaleFactor,
        remove_bg: !!removeBg,
        color_grade: !!colorGrade,
      }),
    });
  } catch (networkErr) {
    console.error("[imagegen] network error calling /tools/image/enhance", networkErr);
    throw new Error(`Could not reach the backend at ${backendUrl} (network/CORS error): ${networkErr.message}`);
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    console.error("[imagegen] /tools/image/enhance returned", res.status, errBody);
    throw new Error(errBody.detail || `Enhancement failed (${res.status})`);
  }

  const json = await res.json();
  console.log("[imagegen] enhance result <-", json);
  return json; // { filename, url, source, steps }
}

// Upload mode — user's own photo instead of a generated one. Posts
// multipart/form-data (no JSON body, no Content-Type header — the
// browser sets the correct boundary itself) to /tools/image/upload,
// which saves it under a fresh name so it can flow into the exact
// same enhanceImage()/ImageCard pipeline as a generated image.
export async function uploadImage({ backendUrl, file }) {
  console.log("[imagegen] POST /tools/image/upload ->", backendUrl, { filename: file?.name });
  const form = new FormData();
  form.append("file", file);

  let res;
  try {
    res = await fetch(`${backendUrl.replace(/\/$/, "")}/tools/image/upload`, {
      method: "POST",
      body: form,
    });
  } catch (networkErr) {
    console.error("[imagegen] network error calling /tools/image/upload", networkErr);
    throw new Error(`Could not reach the backend at ${backendUrl} (network/CORS error): ${networkErr.message}`);
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    console.error("[imagegen] /tools/image/upload returned", res.status, errBody);
    throw new Error(errBody.detail || `Image upload failed (${res.status})`);
  }

  const json = await res.json();
  console.log("[imagegen] upload result <-", json);
  return json; // { filename, url }
}

// Backend only returns a relative /files/<name> path.
export function imageDownloadUrl(backendUrl, relativeUrl) {
  return `${backendUrl.replace(/\/$/, "")}${relativeUrl}`;
}

// Prompt-guided edit — img2img on an existing/uploaded image via
// POST /tools/image/edit (backend/routers/image.py). `strength` is
// the denoise amount: low (~0.3) = light touch-up, high (~0.7) =
// bigger change, further from the source photo.
export async function editImage({
  backendUrl,
  filename,
  prompt,
  style = "realistic",
  strength = 0.55,
  useControlnet = true, // Tier 2: canny ControlNet locks the photo's composition/edges so the
                         // edit only changes what the prompt asks for. Turn off for edits that
                         // deliberately want to restructure the image (pose changes, adding a
                         // whole new object) since a locked edge map would fight those.
}) {
  console.log("[imagegen] POST /tools/image/edit ->", backendUrl, { filename, prompt, style, strength, useControlnet });
  let res;
  try {
    res = await fetch(`${backendUrl.replace(/\/$/, "")}/tools/image/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, prompt, style, strength, use_controlnet: useControlnet }),
    });
  } catch (networkErr) {
    console.error("[imagegen] network error calling /tools/image/edit", networkErr);
    throw new Error(`Could not reach the backend at ${backendUrl} (network/CORS error): ${networkErr.message}`);
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    console.error("[imagegen] /tools/image/edit returned", res.status, errBody);
    throw new Error(errBody.detail || `Image edit failed (${res.status})`);
  }

  const json = await res.json();
  console.log("[imagegen] edit result <-", json);
  return json; // { filename, url, source, prompt, style, strength }
}
