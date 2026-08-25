/**
 * Client for the questions/evaluations API (relay Worker + D1).
 * The access code reuses the /ask settings value (sent as x-questions-code).
 * OpenRouter runs browser-direct with the user's own key — never proxied.
 */

export interface QRow {
  id: number;
  file_id: string;
  contributor: string;
  question: string;
  answer_type: string;
  answer: string | null;
  choices: string | null;
  difficulty: string;
  tags: string;
  status: string;
  created_at: string;
}

export interface EvalRow {
  id: number;
  question_id: number;
  model: string;
  response: string;
  verdict: string | null;
  source: string;
  graded_by: string;
  created_at: string;
}

export interface Insights {
  leaderboard: { model: string; graded: number; correct: number; close: number; wrong: number }[];
  byTag: { tag: string; graded: number; correct: number }[];
}

const FAMILY_BY_PROVIDER: Record<string, string> = {
  openai: "GPT",
  anthropic: "Claude",
  google: "Gemini",
  "meta-llama": "Llama",
  qwen: "Qwen",
  "x-ai": "Grok",
  mistralai: "Mistral",
  deepseek: "DeepSeek",
};

export function familyOf(model: string): string {
  const provider = model.split("/")[0] ?? "";
  return FAMILY_BY_PROVIDER[provider] ?? (provider || "other");
}

export function normQ(q: string): string {
  return q.toLowerCase().replace(/[?!.,'"():;`]/g, " ").replace(/\s+/g, " ").trim();
}

export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  for (const t of raw.split(",")) {
    const tag = t.trim().toLowerCase().replace(/\s+/g, " ");
    if (tag) seen.add(tag);
  }
  return [...seen];
}

/** The fixed evaluation prompt sent to models — crafted for gradeable, comparable answers. */
export function craftedPrompt(question: string): string {
  return [
    "You are answering a visual reasoning benchmark question. Look at the image carefully.",
    "Answer with ONLY the answer — no explanation, no preamble, no full sentence unless the question explicitly asks for one.",
    "",
    `Question: ${question}`,
  ].join("\n");
}

export const OR_MODELS_URL = "https://openrouter.ai/api/v1/models";
export const OR_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface ORModel {
  id: string;
  name?: string;
  vision: boolean;
}

export async function fetchOpenRouterModels(): Promise<ORModel[]> {
  const res = await fetch(OR_MODELS_URL);
  if (!res.ok) throw new Error(`OpenRouter models ${res.status}`);
  const j = (await res.json()) as {
    data: { id: string; name?: string; architecture?: { input_modalities?: string[]; modality?: string } }[];
  };
  return j.data
    .map((m) => ({
      id: m.id,
      name: m.name,
      vision: (m.architecture?.input_modalities ?? []).includes("image")
        || (m.architecture?.modality ?? "").includes("image"),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Run one question against one OpenRouter model with the image attached. Browser-direct, BYOK. */
export async function runOpenRouter(key: string, model: string, fileId: string, question: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(OR_CHAT_URL, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://agi-eval-data.pages.dev",
      "X-Title": "agi-eval-data evaluator",
    },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `https://lh3.googleusercontent.com/d/${fileId}=w1600` } },
            { type: "text", text: craftedPrompt(question) },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 220)}`);
  }
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return (j.choices?.[0]?.message?.content ?? "").trim();
}

class ApiError extends Error {}

async function call<T>(relay: string, code: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${relay.replace(/\/+$/, "")}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(code ? { "x-questions-code": code } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(body.error ?? `HTTP ${res.status}`);
  return body;
}

export const questionsApi = {
  counts(relay: string, code: string): Promise<{ counts: Record<string, number>; images: number }> {
    return call(relay, code, "/api/questions/counts");
  },
  check(relay: string, code: string, fileId: string, q: string): Promise<{ matches: { id: number; question: string }[] }> {
    return call(relay, code, `/api/questions/check?file_id=${encodeURIComponent(fileId)}&q=${encodeURIComponent(q)}`);
  },
  list(relay: string, code: string, opts: { file_id?: string; search?: string; limit?: number }): Promise<{ questions: QRow[] }> {
    const p = new URLSearchParams();
    if (opts.file_id) p.set("file_id", opts.file_id);
    if (opts.search) p.set("search", opts.search);
    if (opts.limit) p.set("limit", String(opts.limit));
    const qs = p.toString();
    return call(relay, code, `/api/questions${qs ? `?${qs}` : ""}`);
  },
  add(
    relay: string,
    code: string,
    payload: { file_id: string; contributor: string; question: string; answer_type: string; answer: string; choices: string; difficulty: string; tags: string },
  ): Promise<{ id: number }> {
    return call(relay, code, "/api/questions", { method: "POST", body: JSON.stringify(payload) });
  },
  remove(relay: string, code: string, id: number): Promise<{ ok: boolean }> {
    return call(relay, code, `/api/questions?id=${id}`, { method: "DELETE" });
  },
  tags(relay: string, code: string): Promise<{ tags: [string, number][] }> {
    return call(relay, code, "/api/questions/tags");
  },
  exportUrl(relay: string): string {
    return `${relay.replace(/\/+$/, "")}/api/questions/export.jsonl`;
  },
  evaluations(relay: string, code: string, opts: { question_id?: number; model?: string; limit?: number }): Promise<{ evaluations: EvalRow[] }> {
    const p = new URLSearchParams();
    if (opts.question_id) p.set("question_id", String(opts.question_id));
    if (opts.model) p.set("model", opts.model);
    if (opts.limit) p.set("limit", String(opts.limit));
    const qs = p.toString();
    return call(relay, code, `/api/evaluations${qs ? `?${qs}` : ""}`);
  },
  saveEvaluation(
    relay: string,
    code: string,
    payload: { question_id: number; model: string; response?: string; verdict?: string; source: string; graded_by?: string },
  ): Promise<{ ok: boolean }> {
    return call(relay, code, "/api/evaluations", { method: "POST", body: JSON.stringify(payload) });
  },
  insights(relay: string, code: string): Promise<Insights> {
    return call(relay, code, "/api/insights");
  },
  excluded(relay: string, code: string): Promise<{ excluded: { file_id: string; reason: string; marked_by: string; created_at: string }[] }> {
    return call(relay, code, "/api/excluded");
  },
  exclude(relay: string, code: string, file_id: string, reason: string): Promise<{ ok: boolean }> {
    return call(relay, code, "/api/excluded", { method: "POST", body: JSON.stringify({ file_id, reason, marked_by: "" }) });
  },
  unexclude(relay: string, code: string, file_id: string): Promise<{ ok: boolean }> {
    return call(relay, code, `/api/excluded?file_id=${encodeURIComponent(file_id)}`, { method: "DELETE" });
  },
};
