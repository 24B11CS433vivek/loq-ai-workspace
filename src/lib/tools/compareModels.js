// Phase 2 — runs the same prompt against two models in parallel via
// Ollama's /api/chat (non-streaming here for simplicity) and returns
// { modelA: text, modelB: text } once both finish.
import { streamChat } from "../ollama";

export async function runCompare({ baseUrl, modelA, modelB, systemPrompt, prompt }) {
  const messages = [
    ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
    { role: "user", content: prompt },
  ];

  const run = (model) =>
    streamChat({ baseUrl, model, messages, onToken: () => {} }).catch(
      (err) => `⚠️ ${model} failed: ${err.message}`
    );

  const [a, b] = await Promise.all([run(modelA), run(modelB)]);
  return { modelA: a, modelB: b };
}
