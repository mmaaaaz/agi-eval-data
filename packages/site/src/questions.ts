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
  relevance?: string;
  unanswerable_reason?: string;
  family?: string;
  tolerance?: number | null;
  created_at: string;
  // ---- v5: the two-axis taxonomy and the paired-probe design ----
  /** what competence the item tests: G1-G8 | P1-P8 | B1-B4 | PERC */
  capability?: string | null;
  /** how many reasoning steps it takes: L1-L5 */
  level?: string | null;
  /** groups the probes asked about one anchor */
  pair_id?: string | null;
  /** which member of the pair this is */
  pair_role?: "geometry" | "physics" | "perception" | null;
  counterfactual_of?: number | null;
  /** JSON [x1,y1,x2,y2] in ORIGINAL image pixels */
  grounding_box?: string | null;
  generator?: string | null;
  verifier?: string | null;
  /** NULL for a real photograph; set for an edited image, which lives in its own split */
  image_edit?: string | null;
  canary?: string | null;
  review_status?: string | null;
  reviewer?: string | null;
  review_reason?: string | null;
  /** optimistic concurrency: send it back as If-Match when editing */
  rev?: number;
  deleted_at?: string | null;
  /** who wrote it: a stable id and a self-declared display name */
  actor_id?: string | null;
  actor_name?: string | null;
  /** 1 = a text-only model answered it correctly with NO image, so it is not vision-dependent */
  blind_passed?: number | null;
  /** an independent second annotation, the source of the agreement figure */
  annotator_2?: string | null;
  /** a stable id for the second annotator, never an email */
  annotator_2_id?: string | null;
}

/**
 * One entry in an item's history. A revision records the state IMMEDIATELY BEFORE a
 * change, written by a database trigger rather than by application code, so nothing
 * can bypass it. Restoring revision N therefore reverts change N.
 */
export interface RevRow {
  rev_id: number;
  question_id: number;
  /** the item's revision number at the time */
  seq: number;
  op: "insert" | "update" | "delete" | "restore" | "review" | string;
  actor_id: string;
  actor_name: string;
  created_at: string;
  patch: Record<string, unknown> | null;
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
  // run_id IS PART OF THE ROW. A model's corruption ladder is 21 separate measurements, and
  // grouping by model alone would average them into one number — hiding the slope, which is the
  // result. `run_id` is '' for a human grade, which belongs to no run.
  leaderboard: {
    model: string;
    run_id?: string;
    graded: number;
    correct: number;
    close: number;
    wrong: number;
    not_answered?: number;
  }[];
  byTag: { tag: string; graded: number; correct: number }[];
  /** echoed by the API: the condition being shown, or null when every run is shown */
  run_id?: string | null;
}

/**
 * Options from whatever the source stored.
 *
 * ONE PARSER, used by the review screen and the authoring form. Each had its own
 * JSON.parse in a try/catch; they already disagreed on the empty case, and neither
 * handled the legacy pipe form that release.py supports — so the frozen release and the
 * screen could disagree about what an item's options ARE.
 *
 * It must agree with release.parse_choices on every encoding the pipeline can meet. A
 * shared fixture (choices.fixtures.json) is asserted by BOTH languages, so the two cannot
 * drift apart without a test failing on one side.
 */
export function parseChoices(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x)).filter((s) => s.trim() !== "");
  if (typeof raw !== "string") return [];
  const s = raw.trim();
  if (!s) return [];
  if (s.startsWith("[")) {
    try {
      const parsed = JSON.parse(s) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x)).filter((v) => v.trim() !== "");
      }
    } catch {
      // fall through to the pipe form rather than throwing
    }
  }
  return s.split("|").map((c) => c.trim()).filter((c) => c !== "");
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

/**
 * An API failure that keeps the response body.
 *
 * A 409 conflict is not just an error: the body carries the current row, which is
 * what lets the UI show a diff instead of losing someone's work.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;
  constructor(message: string, status: number, body: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

const ACTOR_KEY = "benchmark.actor.v1";

export interface Actor {
  id: string;
  name: string;
}

/**
 * Browser-scoped identity: a random id plus a self-declared display name.
 * NOT an account and not authentication — it exists so items can be attributed
 * and so an open door can be rate limited. No email ever reaches the API.
 */
export function getActor(): Actor {
  if (typeof localStorage === "undefined") return { id: "", name: "" };
  try {
    const raw = localStorage.getItem(ACTOR_KEY);
    if (raw) {
      const a = JSON.parse(raw) as Partial<Actor>;
      if (a.id) return { id: String(a.id), name: String(a.name ?? "") };
    }
  } catch { /* treat as fresh */ }
  const id = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : String(Math.random()).slice(2) + String(Date.now());
  const fresh: Actor = { id, name: "" };
  try { localStorage.setItem(ACTOR_KEY, JSON.stringify(fresh)); } catch { /* ignore */ }
  return fresh;
}

export function setActorName(name: string): Actor {
  const next: Actor = { ...getActor(), name: name.slice(0, 64) };
  try { localStorage.setItem(ACTOR_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

async function call<T>(relay: string, code: string, path: string, init?: RequestInit): Promise<T> {
  const url = `${relay.replace(/\/+$/, "")}${path}`;
  const actor = getActor();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(code ? { "x-questions-code": code } : {}),
    ...(actor.id ? { "x-actor": actor.id } : {}),
    ...(actor.name ? { "x-actor-name": actor.name } : {}),
    ...(init?.headers as Record<string, string> | undefined),
  };
  const res = await fetch(url, { ...init, headers });
  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) {
    throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status, body as Record<string, unknown>);
  }
  return body;
}

export interface VqaCandidate {
  id: number;
  batch: string;
  file_id: string;
  ordinal: number;
  question: string;
  qnorm: string;
  choices: string;
  answer: string;
  grounding: string;
  capability: string;
  level: string;
  domain: string;
  difficulty: string;
  model: string;
  endpoint: string;
  prompt_version: string;
  run_id: string;
  image_sha256: string;
  status: "pending" | "approved" | "edited" | "rejected";
  reviewer: string | null;
  reviewed_at: string | null;
  reason: string;
  created_at: string;
}

export interface VqaImageGroup {
  file_id: string;
  n: number;
  first_id: number;
  has_pending: number;
}

export interface VqaCounts {
  byStatus: Record<string, number>;
  byCapability: { capability: string; n: number }[];
  byLevel: { level: string; n: number }[];
  byDomain: { domain: string; n: number }[];
  images: number;
  total: number;
}

export const questionsApi = {
  counts(relay: string, code: string): Promise<{ counts: Record<string, number>; images: number }> {
    return call(relay, code, "/api/questions/counts");
  },
  check(relay: string, code: string, fileId: string, q: string): Promise<{ matches: { id: number; question: string }[] }> {
    return call(relay, code, `/api/questions/check?file_id=${encodeURIComponent(fileId)}&q=${encodeURIComponent(q)}`);
  },
  list(relay: string, code: string, opts: {
    file_id?: string;
    search?: string;
    limit?: number;
    source?: string;
    /** "draft" for everything awaiting a decision */
    status?: string;
    review_status?: string;
    contributor?: string;
    capability?: string;
  }): Promise<{ questions: QRow[] }> {
    const p = new URLSearchParams();
    if (opts.file_id) p.set("file_id", opts.file_id);
    if (opts.search) p.set("search", opts.search);
    if (opts.limit) p.set("limit", String(opts.limit));
    if (opts.source) p.set("source", opts.source);
    if (opts.status) p.set("status", opts.status);
    if (opts.review_status) p.set("review_status", opts.review_status);
    if (opts.contributor) p.set("contributor", opts.contributor);
    if (opts.capability) p.set("capability", opts.capability);
    const qs = p.toString();
    return call(relay, code, `/api/questions${qs ? `?${qs}` : ""}`);
  },
  add(
    relay: string,
    code: string,
    payload: {
      file_id: string;
      contributor: string;
      question: string;
      answer_type: string;
      answer: string;
      choices: string;
      difficulty: string;
      tags: string;
      source?: string;
      graph_file_id?: string;
      graph_path?: string;
      family?: string;
      relevance?: string;
      unanswerable_reason?: string;
      tolerance?: number | null;
      // v5: the two-axis taxonomy and the paired-probe design
      capability?: string;
      level?: string;
      pair_id?: string;
      pair_role?: string;
      counterfactual_of?: number | null;
      grounding_box?: string;
      generator?: string;
      verifier?: string;
      image_edit?: string;
    },
  ): Promise<{ id: number; rev: number; status: string }> {
    return call(relay, code, "/api/questions", { method: "POST", body: JSON.stringify(payload) });
  },

  /** Edit an item. Send the revision you read; a stale one returns 409 with the current row. */
  patch(relay: string, code: string, id: number, rev: number, fields: Record<string, unknown>): Promise<{ ok: boolean; id: number; rev: number }> {
    return call(relay, code, `/api/questions/${id}`, {
      method: "PATCH",
      headers: { "If-Match": String(rev) },
      body: JSON.stringify(fields),
    });
  },

  /** Reviewer only. Without the code this returns 401. */
  review(relay: string, code: string, id: number, decision: "accept" | "fix" | "reject", reason: string): Promise<{ ok: boolean; review_status: string; status: string }> {
    return call(relay, code, `/api/questions/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ decision, reason }),
    });
  },

  /**
   * Record a SECOND, independent annotation. Reviewer-gated.
   * The client must not show the stored answer before calling this, or the two
   * annotations are not independent and the agreement figure is inflated.
   */
  second(relay: string, code: string, id: number, answer: string): Promise<{ ok: boolean; id: number; annotator_2: string }> {
    return call(relay, code, `/api/questions/${id}/second`, {
      method: "POST",
      body: JSON.stringify({ answer }),
    });
  },

  /** An item's full history, newest first. */
  revisions(relay: string, code: string, id: number, limit = 50): Promise<{ question_id: number; revisions: RevRow[] }> {
    return call(relay, code, `/api/questions/${id}/revisions?limit=${limit}`);
  },

  /** Revert change N. Restoring an approved item needs the reviewer code. */
  restore(relay: string, code: string, id: number, revId: number): Promise<{ ok: boolean; id: number; restored_from: number }> {
    return call(relay, code, `/api/questions/${id}/restore`, {
      method: "POST",
      body: JSON.stringify({ rev_id: revId }),
    });
  },

  /** Only what changed since a cursor. One indexed row when nothing has. */
  cursor(relay: string): Promise<{ seq: number }> {
    return call(relay, "", "/api/changes/cursor");
  },
  changes(relay: string, since: number, limit = 200): Promise<{ cursor: number; questions: QRow[]; selections: Record<string, unknown>[]; n_changes: number }> {
    return call(relay, "", `/api/changes?since=${since}&limit=${limit}`);
  },

  selections(relay: string, state?: string, limit = 1000): Promise<{ selections: Record<string, unknown>[] }> {
    const p = new URLSearchParams();
    if (state) p.set("state", state);
    p.set("limit", String(limit));
    return call(relay, "", `/api/selections?${p.toString()}`);
  },
  select(relay: string, code: string, payload: { file_id: string; state: string; reason?: string; stratum?: string }): Promise<{ ok: boolean; file_id: string; state: string }> {
    return call(relay, code, "/api/selections", { method: "POST", body: JSON.stringify(payload) });
  },
  /** Undo: "undecided" is the absence of a row, so this deletes one. */
  unselect(relay: string, code: string, fileId: string): Promise<{ ok: boolean; file_id: string; state: null }> {
    return call(relay, code, `/api/selections?file_id=${encodeURIComponent(fileId)}`, { method: "DELETE" });
  },
  /** All nomination votes. The nominated board joins these by file_id. */
  votes(relay: string, limit = 20000): Promise<{ votes: { file_id: string; actor_id: string; actor_name: string; created_at: string }[]; threshold: number }> {
    return call(relay, "", `/api/selections/votes?limit=${limit}`);
  },
  /** Upvote a nomination. Two distinct votes move it to chosen. */
  vote(relay: string, code: string, fileId: string): Promise<{ ok: boolean; file_id: string; votes: number; state: string; threshold: number }> {
    return call(relay, code, "/api/selections/votes", { method: "POST", body: JSON.stringify({ file_id: fileId }) });
  },
  /** Retract your vote — below two, a vote-promotion goes back to nominated. */
  unvote(relay: string, code: string, fileId: string): Promise<{ ok: boolean; file_id: string; votes: number; state: string; threshold: number }> {
    return call(relay, code, `/api/selections/votes?file_id=${encodeURIComponent(fileId)}`, { method: "DELETE" });
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
  // ---- v6: the review room for model-drafted VQA candidates ----
  vqaCounts(relay: string, code: string): Promise<VqaCounts> {
    return call(relay, code, "/api/vqa/counts");
  },
  vqaImages(relay: string, code: string, opts: { status?: string; limit?: number; after?: number } = {}): Promise<{ images: VqaImageGroup[] }> {
    const p = new URLSearchParams();
    if (opts.status) p.set("status", opts.status);
    if (opts.limit) p.set("limit", String(opts.limit));
    if (opts.after) p.set("after", String(opts.after));
    const qs = p.toString();
    return call(relay, code, `/api/vqa/images${qs ? `?${qs}` : ""}`);
  },
  vqaCandidates(relay: string, code: string, opts: {
    file_id?: string; status?: string; capability?: string; level?: string; domain?: string;
    search?: string; limit?: number; after?: number;
  } = {}): Promise<{ candidates: VqaCandidate[] }> {
    const p = new URLSearchParams();
    for (const k of ["file_id", "status", "capability", "level", "domain", "search"] as const) {
      const v = opts[k];
      if (v) p.set(k, v);
    }
    if (opts.limit) p.set("limit", String(opts.limit));
    if (opts.after) p.set("after", String(opts.after));
    const qs = p.toString();
    return call(relay, code, `/api/vqa/candidates${qs ? `?${qs}` : ""}`);
  },
  vqaReview(relay: string, code: string, payload: {
    candidate_id: number;
    verdict: "approve" | "edit" | "reject";
    reason?: string;
    reviewer?: string;
    edits?: Record<string, unknown>;
  }): Promise<{ ok: boolean; candidate: VqaCandidate }> {
    return call(relay, code, "/api/vqa/review", { method: "POST", body: JSON.stringify(payload) });
  },
};

/** Canonical question identity — single source: @agi-eval/shared. */
export { normQ, normTags } from "@agi-eval/shared";
