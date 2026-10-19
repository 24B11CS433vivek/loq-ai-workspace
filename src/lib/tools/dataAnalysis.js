// Phase 7 — spreadsheet upload, natural-language analysis, and
// chart generation. The LLM never runs pandas code directly; the
// backend plans a constrained JSON "operation spec" and executes it.

export async function analyzeData({ backendUrl, file, question = "" }) {
  const form = new FormData();
  form.append("file", file);
  if (question) form.append("question", question);

  console.log("[data] POST /tools/data/analyze ->", backendUrl, { filename: file?.name, question });
  let res;
  try {
    res = await fetch(`${backendUrl.replace(/\/$/, "")}/tools/data/analyze`, {
      method: "POST",
      body: form,
    });
  } catch (networkErr) {
    // fetch() throws TypeError before ever reaching the server on CORS
    // rejections, refused connections, or a dead backend — this is the
    // #1 way the pipeline goes silently missing, so make it unmissable.
    console.error("[data] network error calling /tools/data/analyze — is the backend running and CORS-allowed for this origin?", networkErr);
    throw new Error(`Could not reach the backend at ${backendUrl} (network/CORS error): ${networkErr.message}`);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.error("[data] /tools/data/analyze returned", res.status, body);
    throw new Error(body.detail || `Analysis failed (${res.status})`);
  }

  const json = await res.json();
  console.log("[data] analyze result <-", json);
  return json; // { filename, schema, operation, result }
}

export async function chartData({ backendUrl, file, operation }) {
  const form = new FormData();
  form.append("file", file);
  form.append("operation", JSON.stringify(operation));

  const res = await fetch(`${backendUrl.replace(/\/$/, "")}/tools/data/chart`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Chart generation failed (${res.status})`);
  }

  return res.json(); // { filename, operation, chart_type, image_base64 }
}

// Data attachments are stored as data: URLs (like every other
// attachment type in storage.js, so they survive the localStorage
// JSON round-trip) — this rebuilds a real File/Blob from one so the
// same spreadsheet can be re-sent to the backend for follow-up
// questions without re-prompting the user to re-upload it.
export function dataUrlToFile(dataUrl, filename) {
  if (!dataUrl) {
    // Some attachment types (e.g. "convert-file") are intentionally
    // persisted without their raw bytes to avoid bloating localStorage
    // with large PDFs/images/audio. If a message carrying one of those
    // gets restored later (Edit, Regenerate) the attachment object is
    // still there but its dataUrl is gone -- fail with a clear, actionable
    // message here instead of a bare "Cannot read properties of
    // undefined (reading 'split')" deep in a stack trace.
    throw new Error(`"${filename || "This file"}" no longer has its file data attached (it wasn't kept in chat history) — please re-attach it and try again.`);
  }
  const [header, base64] = dataUrl.split(",");
  const mimeMatch = header.match(/data:(.*);base64/);
  const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}

// Compact text summary of an analysis result, injected into the chat
// model's context so it can describe the findings in prose while the
// table + chart render in the artifact panel.
export function summarizeResult(result) {
  if (!result) return "";
  switch (result.op) {
    case "describe": {
      // Previously this dropped result.stats entirely, so the model had
      // zero real numbers to work with for "give me an overview" style
      // questions and fabricated every average/count in its reply.
      const numericStats = result.columns
        .map((c) => {
          const s = result.stats?.[c.name];
          if (!s || typeof s.mean !== "number") return null;
          const fmt = (n) => (Number.isInteger(n) ? n : Number(n.toFixed(2)));
          return `${c.name}: mean=${fmt(s.mean)}, min=${fmt(s.min)}, max=${fmt(s.max)}${
            typeof s.count === "number" ? `, count=${fmt(s.count)}` : ""
          }`;
        })
        .filter(Boolean)
        .join("; ");
      return `Dataset has ${result.row_count} rows and ${result.columns.length} columns: ${result.columns
        .map((c) => `${c.name} (${c.dtype})`)
        .join(", ")}.${numericStats ? ` Computed stats — ${numericStats}.` : ""} Note: this "describe" operation gives per-column stats ONLY — it does NOT include category breakdowns (e.g. counts by region/department/remote) unless a separate groupby was run.`;
    }
    case "filter": {
      const preview = (result.rows || []).slice(0, 15);
      // Spelling out "exactly N" and "every one of them" here because the
      // model was previously miscounting its own prose against the table
      // (saying "two" for a 3-row result) or contradicting it outright
      // ("no matches" while listing 3) — make the count impossible to misread.
      return `EXACTLY ${result.matched} row(s) matched the filter — no more, no fewer. You MUST name every one of them in your reply, not a subset. Rows: ${JSON.stringify(preview)}`;
    }
    case "groupby":
      return `Grouped by "${result.group_by}": ${JSON.stringify(result.rows)}`;
    case "correlation": {
      // The model has no numeric sense of what -0.04 vs -0.61 "feels"
      // like, so it guessed "strong" for a near-zero value. Do the
      // strength judgment ourselves and hand it a label to use verbatim.
      const strengthOf = (v) => {
        const a = Math.abs(v);
        if (a < 0.2) return "negligible / essentially no correlation";
        if (a < 0.4) return "weak";
        if (a < 0.6) return "moderate";
        if (a < 0.8) return "strong";
        return "very strong";
      };
      const cols = result.columns || [];
      const matrix = result.matrix || [];
      const pairs = [];
      for (let i = 0; i < cols.length; i++) {
        for (let j = i + 1; j < cols.length; j++) {
          const v = matrix[i]?.[j];
          if (typeof v === "number") {
            pairs.push(`${cols[i]} vs ${cols[j]}: ${v.toFixed(3)} (${v >= 0 ? "positive" : "negative"}, ${strengthOf(v)})`);
          }
        }
      }
      return `Correlation matrix for columns [${cols.join(", ")}]. Use ONLY the pre-computed strength labels below — do not judge strength yourself: ${pairs.join("; ") || "only one numeric column, no pairs to correlate"}. Raw matrix: ${JSON.stringify(matrix)}`;
    }
    default:
      return JSON.stringify(result);
  }
}
