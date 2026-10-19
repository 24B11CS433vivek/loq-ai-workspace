import { useEffect, useRef, useState } from "react";
import { listCodeTree, readCodeFile, writeCodeFile, runCodeFile } from "../../lib/tools/codeAgent";
import { streamChat } from "../../lib/ollama";

// Phase 12C — Coding Agent panel. Renders inside ArtifactPanel's
// .artifact-body (see App.jsx's openCodePanel()).
//
// Two halves:
//   1. Agent bar (top) — "create a login page" style prompts go to
//      qwen2.5-coder:7b directly over Ollama (same zero-backend chat
//      path as everything else, src/lib/ollama.js), which is asked to
//      return a strict JSON {files:[{path,content}], message} blob.
//      Each file gets written via /tools/code/write (Phase 12B/A).
//   2. Manual tree + editor (below, unchanged from the original
//      12C pass) — Save/Run still work exactly as before, and the
//      agent's own files land there too so they're editable/runnable.

const RUNNABLE_EXT = [".py", ".js"];
const CODER_MODEL = "qwen2.5-coder:7b"; // must match backend/routers/code.py's CODER_MODEL

function isRunnable(path) {
  return RUNNABLE_EXT.some((ext) => path.toLowerCase().endsWith(ext));
}

function buildAgentSystemPrompt(existingPaths) {
  return `You are a coding agent that writes files directly into a sandboxed project folder.
Existing files in the project: ${existingPaths.length ? existingPaths.join(", ") : "(none yet)"}.

When the user asks you to build or change something, respond with ONLY a single JSON object — no prose, no markdown code fences, nothing before or after it — in exactly this shape:
{"files": [{"path": "relative/file.ext", "content": "full file contents"}], "message": "one short sentence describing what you built"}

Rules:
- "path" must be relative (no leading "/" and no ".."), e.g. "index.html" or "src/app.py".
- "content" must be the COMPLETE contents of the file, not a diff or patch.
- Include every file needed for the result to actually work (e.g. pair an HTML page with its CSS/JS if it needs them).
- To modify an existing file, reuse its exact existing path so it gets overwritten.
- Do not wrap the JSON in \`\`\` fences. Do not include any explanation outside the JSON object.`;
}

function parseAgentResponse(raw) {
  let t = raw.trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON object found in the model's response.");
  }
  const obj = JSON.parse(t.slice(start, end + 1));
  if (!obj || !Array.isArray(obj.files)) {
    throw new Error("Response was valid JSON but had no \"files\" array.");
  }
  for (const f of obj.files) {
    if (!f || typeof f.path !== "string" || !f.path.trim()) {
      throw new Error("A file entry was missing a valid \"path\".");
    }
    if (f.path.startsWith("/") || f.path.includes("..")) {
      throw new Error(`Refusing unsafe path from model: "${f.path}"`);
    }
  }
  return obj;
}

export default function CodePanel({ backendUrl, ollamaUrl, project = "default" }) {
  const [files, setFiles] = useState(null); // null = loading, [] = empty
  const [treeError, setTreeError] = useState("");

  const [newFileName, setNewFileName] = useState("");
  const [creating, setCreating] = useState(false);

  const [activePath, setActivePath] = useState(null);
  const [content, setContent] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [fileError, setFileError] = useState("");
  const [runResult, setRunResult] = useState(null);

  // --- Agent state ---
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentStatus, setAgentStatus] = useState("");
  const [agentError, setAgentError] = useState("");
  const abortRef = useRef(null);

  const refreshTree = async () => {
    setTreeError("");
    try {
      const { files: list } = await listCodeTree({ backendUrl, project });
      setFiles(list);
      return list;
    } catch (err) {
      console.error("[CodePanel] failed to load tree", err);
      setTreeError(err.message);
      setFiles([]);
      return [];
    }
  };

  useEffect(() => {
    refreshTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendUrl, project]);

  const openFile = async (path) => {
    if (path === activePath) return;
    setLoadingFile(true);
    setFileError("");
    setRunResult(null);
    try {
      const { content: text } = await readCodeFile({ backendUrl, project, path });
      setActivePath(path);
      setContent(text);
      setDirty(false);
    } catch (err) {
      console.error("[CodePanel] failed to read file", path, err);
      setFileError(err.message);
    } finally {
      setLoadingFile(false);
    }
  };

  const handleCreate = async () => {
    const name = newFileName.trim();
    if (!name) return;
    setCreating(true);
    setTreeError("");
    try {
      await writeCodeFile({ backendUrl, project, path: name, content: "" });
      setNewFileName("");
      await refreshTree();
      await openFile(name);
    } catch (err) {
      console.error("[CodePanel] failed to create file", name, err);
      setTreeError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleSave = async () => {
    if (!activePath) return;
    setSaving(true);
    setFileError("");
    try {
      await writeCodeFile({ backendUrl, project, path: activePath, content });
      setDirty(false);
      await refreshTree();
    } catch (err) {
      console.error("[CodePanel] failed to save file", activePath, err);
      setFileError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRun = async () => {
    if (!activePath || !isRunnable(activePath)) return;
    setRunning(true);
    setFileError("");
    setRunResult(null);
    try {
      if (dirty) {
        await writeCodeFile({ backendUrl, project, path: activePath, content });
        setDirty(false);
      }
      const result = await runCodeFile({ backendUrl, project, entrypoint: activePath });
      setRunResult(result);
    } catch (err) {
      console.error("[CodePanel] failed to run file", activePath, err);
      setFileError(err.message);
    } finally {
      setRunning(false);
    }
  };

  // --- Agent: "create a login page" -> qwen2.5-coder:7b -> files written ---

  const runAgent = async () => {
    const prompt = agentPrompt.trim();
    if (!prompt || agentBusy) return;

    if (!ollamaUrl) {
      setAgentError("No Ollama URL configured — check Settings.");
      return;
    }

    setAgentBusy(true);
    setAgentError("");
    setAgentStatus("Thinking…");

    const controller = new AbortController();
    abortRef.current = controller;

    const existingPaths = (files || []).map((f) => f.path);

    let raw = "";
    try {
      raw = await streamChat({
        baseUrl: ollamaUrl,
        model: CODER_MODEL,
        messages: [
          { role: "system", content: buildAgentSystemPrompt(existingPaths) },
          { role: "user", content: prompt },
        ],
        signal: controller.signal,
        onFirstToken: () => setAgentStatus("Writing response…"),
      });
    } catch (err) {
      if (err?.name === "AbortError") {
        setAgentStatus("Stopped.");
      } else {
        console.error("[CodePanel] agent chat failed", err);
        setAgentError(err.message);
        setAgentStatus("");
      }
      setAgentBusy(false);
      abortRef.current = null;
      return;
    }

    let parsed;
    try {
      parsed = parseAgentResponse(raw);
    } catch (err) {
      console.error("[CodePanel] failed to parse agent response:\n", raw);
      setAgentError(
        `${err.message} Nothing was written. Raw model response (first 800 chars):\n\n${raw.slice(0, 800)}`
      );
      setAgentStatus("");
      setAgentBusy(false);
      abortRef.current = null;
      return;
    }

    if (parsed.files.length === 0) {
      setAgentError("The model didn't return any files to write.");
      setAgentStatus("");
      setAgentBusy(false);
      abortRef.current = null;
      return;
    }

    try {
      for (const f of parsed.files) {
        setAgentStatus(`Writing ${f.path}…`);
        await writeCodeFile({ backendUrl, project, path: f.path, content: f.content ?? "" });
      }
      await refreshTree();
      setAgentStatus(parsed.message ? `Done — ${parsed.message}` : `Done — created ${parsed.files.length} file(s).`);
      setAgentPrompt("");
      await openFile(parsed.files[0].path);
    } catch (err) {
      console.error("[CodePanel] failed to write agent files", err);
      setAgentError(err.message);
      setAgentStatus("");
    } finally {
      setAgentBusy(false);
      abortRef.current = null;
    }
  };

  const stopAgent = () => abortRef.current?.abort();

  return (
    <div className="code-panel">
      <div className="code-panel-agent">
        <div className="code-panel-agent-row">
          <textarea
            className="code-panel-agent-input"
            placeholder='e.g. "create a login page with email and password fields"'
            value={agentPrompt}
            onChange={(e) => setAgentPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                runAgent();
              }
            }}
            disabled={agentBusy}
          />
          {agentBusy ? (
            <button className="btn-primary stop" onClick={stopAgent}>
              Stop
            </button>
          ) : (
            <button className="btn-primary" onClick={runAgent} disabled={!agentPrompt.trim()}>
              Build
            </button>
          )}
        </div>
        {agentStatus && <div className="code-panel-agent-status">{agentStatus}</div>}
        {agentError && <div className="code-panel-error">{agentError}</div>}
      </div>

      <div className="code-panel-tree">
        <div className="code-panel-newfile">
          <input
            type="text"
            placeholder="new_file.py"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            disabled={creating}
          />
          <button onClick={handleCreate} disabled={creating || !newFileName.trim()} title="Create file">
            +
          </button>
        </div>

        {treeError && <div className="code-panel-error">{treeError}</div>}

        {files === null ? (
          <div className="code-panel-hint">Loading project…</div>
        ) : files.length === 0 ? (
          <div className="code-panel-hint">No files yet — describe what to build above, or create one manually.</div>
        ) : (
          <ul className="code-file-list">
            {files.map((f) => (
              <li
                key={f.path}
                className={`code-file-item${f.path === activePath ? " active" : ""}`}
                onClick={() => openFile(f.path)}
              >
                <span className="code-file-name">{f.path}</span>
                <span className="code-file-size">{f.size}B</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!activePath ? (
        <div className="code-panel-hint code-panel-hint-center">
          Select a file above, or create/build one to get started.
        </div>
      ) : (
        <div className="code-panel-editor">
          <div className="code-panel-editor-toolbar">
            <span className="code-panel-filename">
              {activePath}
              {dirty ? " •" : ""}
            </span>
            <div className="code-panel-actions">
              <button onClick={handleSave} disabled={saving || !dirty}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                onClick={handleRun}
                disabled={running || !isRunnable(activePath)}
                title={isRunnable(activePath) ? "Run" : "Only .py / .js files are runnable"}
              >
                {running ? "Running…" : "Run"}
              </button>
            </div>
          </div>

          {loadingFile ? (
            <div className="code-panel-hint">Loading file…</div>
          ) : (
            <textarea
              className="code-panel-textarea"
              value={content}
              spellCheck={false}
              onChange={(e) => {
                setContent(e.target.value);
                setDirty(true);
              }}
            />
          )}

          {fileError && <div className="code-panel-error">{fileError}</div>}

          {runResult && (
            <div className="code-panel-output">
              <div className="code-panel-output-header">
                exit {runResult.exit_code}
                {runResult.timed_out ? " — timed out" : ""}
              </div>
              {runResult.stdout && <pre className="code-panel-stdout">{runResult.stdout}</pre>}
              {runResult.stderr && <pre className="code-panel-stderr">{runResult.stderr}</pre>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
