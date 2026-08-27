/**
 * Client for the questions/evaluations API (relay Worker + D1).
 * The access code reuses the /settings value (sent as x-questions-code).
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
  source?: string;
  graph_file_id?: string | null;
  graph_path?: string | null;
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

/** The fixed evaluation prompt sent to models — crafted for gradeable, comparable answers. */
export function craftedPrompt(question: string, subject: string): string {
  return [
    `You are answering a visual question about ${subject}.`,
    `Question: ${question}`,
    `Answer directly and concisely. If the question asks for a number, reply with just the number.`,
    `If it is a yes/no question, reply with exactly "yes" or "no".`,
    `If multiple-choice, reply with the exact option text or its letter.`,
  ].join("\n");
}

export const OR_MODELS_URL = "https://openrouter.ai/api/v1/models";
export const OR_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface ORModel {
  id: string;
  name: string;
  context_length?: number;
  pricing?: { prompt: string; completion: string; request: string; image: string };
  vision?: boolean;
  // OpenRouter may expose architecture or modalities; keep permissive
  architecture?: { modality?: string; input_modalities?: string[] };
}

export async function fetchOpenRouterModels(): Promise<ORModel[]> {
  const res = await fetch(OR_MODELS_URL);
  if (!res.ok) throw new Error(`models fetch failed: ${res.status}`);
  const j = (await res.json()) as { data: ORModel[] };
  return j.data ?? [];
}

export interface SiteMeta {
  name: string;
  subject: string;
}

/** Run one question against one OpenRouter model with the image attached. Browser-direct, BYOK. */
export async function runOpenRouter(
  key: string,
  model: string,
  fileId: string,
  question: string,
  meta: SiteMeta,
  signal?: AbortSignal,
): Promise<string> {
  const imgUrl = `https://lh3.googleusercontent.com/d/${fileId}=w1600`;
  const prompt = craftedPrompt(question, meta.subject);
  const body = {
    model,
    messages: [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: prompt },
          { type: "image_url" as const, image_url: { url: imgUrl } },
        ],
      },
    ],
    max_tokens: 512,
  };
  const res = await fetch(OR_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": typeof location !== "undefined" ? location.origin : "",
      "X-Title": meta.name,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${t.slice(0, 400)}`);
  }
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = j.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return (content as unknown[]).map((p) => {
    if (p && typeof p === "object" && "text" in (p as Record<string, unknown>)) return String((p as Record<string, unknown>).text);
    return "";
  }).join("");
  return String(content ?? "");
}

class ApiError extends Error {}

async function call<T>(relay: string, code: string, path: string, init?: RequestInit): Promise<T> {
  const url = `${relay.replace(/\/+$/, "")}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(code ? { "x-questions-code": code } : {}),
    ...(init?.headers as Record<string, string> | undefined),
  };
  const res = await fetch(url, { ...init, headers });
  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
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
  list(relay: string, code: string, opts: { file_id?: string; search?: string; limit?: number; source?: string }): Promise<{ questions: QRow[] }> {
    const p = new URLSearchParams();
    if (opts.file_id) p.set("file_id", opts.file_id);
    if (opts.search) p.set("search", opts.search);
    if (opts.limit) p.set("limit", String(opts.limit));
    if (opts.source) p.set("source", opts.source);
    const qs = p.toString();
    return call(relay, code, `/api/questions${qs ? `?${qs}` : ""}`);
  },
  add(
    relay: string,
    code: string,
    payload: { file_id: string; contributor: string; question: string; answer_type: string; answer: string; choices: string; difficulty: string; tags: string; source?: string; graph_file_id?: string; graph_path?: string },
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

/** Canonical question identity — single source: @agi-eval/shared. */
export { normQ, normTags } from "@agi-eval/shared";
