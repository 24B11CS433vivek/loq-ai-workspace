const base = (url) => url.replace(/\/$/, "");

/**
 * Calls the FastAPI backend's browser agent endpoint. Runs the full
 * plan -> act -> observe loop server-side and returns once the task
 * is done or the step limit is hit.
 * Returns { session_id, steps, summary } or throws on failure.
 */
export async function runBrowserTask(task, backendUrl) {
  if (!task || !task.trim()) {
    throw new Error("runBrowserTask: task cannot be empty");
  }
  if (!backendUrl) {
    throw new Error("runBrowserTask: backendUrl is required");
  }

  const res = await fetch(`${base(backendUrl)}/tools/browser/task`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task: task.trim() }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`runBrowserTask failed (${res.status}): ${detail}`);
  }

  return res.json();
}
