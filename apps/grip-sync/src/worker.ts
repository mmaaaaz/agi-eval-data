/**
 * grip-sync — stages GRIP override edits in KV and syncs them to the upstream
 * dataset repo as ONE atomic commit via the Git Data API.
 *
 * Endpoints (mutating ones require header x-questions-code === GRIP_ACCESS_CODE):
 *   GET    /api/edits?slug=X            → { edits: StagedEdit[] }         (public)
 *   PUT    /api/edits/:slug/:sampleId   → { ok: true }                    (gated)
 *   DELETE /api/edits/:slug/:sampleId   → { ok: true }                    (gated)
 *   GET    /api/sync/status             → { staged, upstreamSha, baseShasMatch }
 *   POST   /api/sync                    → { status: synced|conflict|error }
 *
 * Design/ops doc: docs/grip.md · plan: .hermes/plans/…-v3.md §3.
 */

export interface Env {
  GRIP_EDITS: KVNamespace;
  GRIP_GITHUB_PAT: string;
  GRIP_ACCESS_CODE: string;
  GRIP_UPSTREAM_REPO: string;
}

export interface StagedPatch {
  version: number;
  author: string;
  reason: string;
  editedAt: string;
  baseCommitAtEdit?: string;
  changes: { field: string; from?: unknown; to: unknown }[];
}

interface StagedEntry {
  slug: string;
  sampleId: string;
  patch: StagedPatch;
}

const GH = "https://api.github.com";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

function gated(request: Request, env: Env): boolean {
  return request.headers.get("x-questions-code") === env.GRIP_ACCESS_CODE;
}

/* ---------------- GitHub helpers ---------------- */

async function gh<T>(env: Env, path: string, init?: RequestInit): Promise<{ data: T; status: number; headers: Headers }> {
  const res = await fetch(`${GH}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GRIP_GITHUB_PAT}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "grip-sync-worker",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  const data = (text ? JSON.parse(text) : null) as T;
  return { data, status: res.status, headers: res.headers };
}

async function upstreamHead(env: Env): Promise<{ sha: string; treeSha: string } | null> {
  const ref = await gh<{ object: { sha: string } }>(env, `/repos/${env.GRIP_UPSTREAM_REPO}/git/ref/heads/main`);
  if (ref.status !== 200) return null;
  const sha = ref.data.object.sha;
  const commit = await gh<{ tree: { sha: string } }>(env, `/repos/${env.GRIP_UPSTREAM_REPO}/git/commits/${sha}`);
  if (commit.status !== 200) return null;
  return { sha, treeSha: commit.data.tree.sha };
}

/* ---------------- request handlers ---------------- */

async function listEdits(env: Env, slug?: string): Promise<Response> {
  const prefix = slug ? `ov:${slug}:` : "ov:";
  const out: StagedEntry[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await env.GRIP_EDITS.list({ prefix, cursor, limit: 100 });
    for (const key of page.keys) {
      const raw = await env.GRIP_EDITS.get(key.name);
      if (raw) out.push(JSON.parse(raw) as StagedEntry);
    }
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }
  return json({ edits: out });
}

async function putEdit(request: Request, env: Env, slug: string, sampleId: string): Promise<Response> {
  if (!gated(request, env)) return json({ error: "forbidden" }, 403);
  const patch = (await request.json()) as StagedPatch;
  if (!patch?.changes?.length || !patch.reason) {
    return json({ error: "patch requires reason and changes[]" }, 400);
  }
  const head = await upstreamHead(env);
  const entry: StagedEntry = {
    slug,
    sampleId,
    patch: { ...patch, baseCommitAtEdit: head?.sha ?? patch.baseCommitAtEdit },
  };
  await env.GRIP_EDITS.put(`ov:${slug}:${sampleId}`, JSON.stringify(entry));
  return json({ ok: true });
}

async function deleteEdit(env: Env, slug: string, sampleId: string): Promise<Response> {
  await env.GRIP_EDITS.delete(`ov:${slug}:${sampleId}`);
  return json({ ok: true });
}

async function syncStatus(env: Env): Promise<Response> {
  const entries = await collectStaged(env);
  const head = env.GRIP_GITHUB_PAT ? await upstreamHead(env) : null;
  const allMatch = entries.length > 0 && entries.every(
    (e) => e.patch.baseCommitAtEdit && head && e.patch.baseCommitAtEdit === head.sha);
  return json({ staged: entries.length, upstreamSha: head?.sha ?? null, baseShasMatch: allMatch });
}

async function collectStaged(env: Env): Promise<StagedEntry[]> {
  const out: StagedEntry[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await env.GRIP_EDITS.list({ prefix: "ov:", cursor, limit: 100 });
    for (const key of page.keys) {
      const raw = await env.GRIP_EDITS.get(key.name);
      if (raw) out.push(JSON.parse(raw) as StagedEntry);
    }
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }
  return out;
}

async function runSync(request: Request, env: Env): Promise<Response> {
  if (!gated(request, env)) return json({ status: "error", message: "forbidden" }, 403);
  if (!env.GRIP_GITHUB_PAT) return json({ status: "error", message: "GRIP_GITHUB_PAT not set" });

  const entries = await collectStaged(env);
  if (entries.length === 0) return json({ status: "error", message: "no staged edits" });

  const head = await upstreamHead(env);
  if (!head) return json({ status: "error", message: "cannot read upstream main" });

  // drift check: every patch must be staged against the CURRENT upstream sha
  const staleIds = entries
    .filter((e) => e.patch.baseCommitAtEdit && e.patch.baseCommitAtEdit !== head.sha)
    .map((e) => `${e.slug}/${e.sampleId}`);
  if (staleIds.length > 0) {
    return json({ status: "conflict", upstreamSha: head.sha, staleIds });
  }

  try {
    // 1. blobs for every override file
    const treeEntries: { path: string; mode: "100644"; type: "blob"; sha: string }[] = [];
    for (const e of entries) {
      const blob = await gh<{ sha: string }>(env, `/repos/${env.GRIP_UPSTREAM_REPO}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: JSON.stringify(e.patch, null, 2), encoding: "utf-8" }),
      });
      if (blob.status !== 201) throw new Error(`blob failed for ${e.slug}/${e.sampleId}: ${blob.status}`);
      treeEntries.push({
        path: `data/overrides/${e.slug}/${e.sampleId}.json`,
        mode: "100644",
        type: "blob",
        sha: blob.data.sha,
      });
    }

    // 2. one tree on top of upstream HEAD
    const tree = await gh<{ sha: string }>(env, `/repos/${env.GRIP_UPSTREAM_REPO}/git/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: head.treeSha, tree: treeEntries }),
    });
    if (tree.status !== 201) throw new Error(`tree failed: ${tree.status}`);

    // 3. one commit
    const reasons = entries.map((e) => `- ${e.slug}/${e.sampleId}: ${e.patch.reason}`).join("\n");
    const commit = await gh<{ sha: string }>(env, `/repos/${env.GRIP_UPSTREAM_REPO}/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        message: `site: apply ${entries.length} override edit(s) (batch)\n\n${reasons}`,
        tree: tree.data.sha,
        parents: [head.sha],
      }),
    });
    if (commit.status !== 201) throw new Error(`commit failed: ${commit.status}`);

    // 4. atomic ref move (409/422 here = upstream moved mid-flight → conflict)
    const ref = await gh(env, `/repos/${env.GRIP_UPSTREAM_REPO}/git/refs/heads/main`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.data.sha, force: false }),
    });
    if (ref.status === 409 || ref.status === 422) {
      return json({ status: "conflict", upstreamSha: head.sha, staleIds: [] });
    }
    if (ref.status !== 200) throw new Error(`ref update failed: ${ref.status}`);

    // 5. clear staging
    for (const e of entries) await env.GRIP_EDITS.delete(`ov:${e.slug}:${e.sampleId}`);
    await env.GRIP_EDITS.put("site:artifactVersion", commit.data.sha);

    return json({ status: "synced", commitSha: commit.data.sha });
  } catch (e) {
    return json({ status: "error", message: e instanceof Error ? e.message : "sync failed" });
  }
}

/* ---------------- router ---------------- */

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,PUT,DELETE,POST,OPTIONS",
          "access-control-allow-headers": "content-type,x-questions-code",
        },
      });
    }

    if (path === "/api/edits" && request.method === "GET") {
      return listEdits(env, url.searchParams.get("slug") ?? undefined);
    }
    const editMatch = path.match(/^\/api\/edits\/([^/]+)\/([^/]+)$/);
    if (editMatch) {
      const [, slug, sampleId] = editMatch;
      if (request.method === "PUT") return putEdit(request, env, slug, decodeURIComponent(sampleId));
      if (request.method === "DELETE") return deleteEdit(env, slug, decodeURIComponent(sampleId));
    }
    if (path === "/api/sync/status" && request.method === "GET") return syncStatus(env);
    if (path === "/api/sync" && request.method === "POST") return runSync(request, env);

    return json({ error: "not found" }, 404);
  },
};
