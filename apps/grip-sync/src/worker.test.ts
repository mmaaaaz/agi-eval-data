import { describe, expect, it, vi, beforeEach } from "vitest";
import worker, { type Env, type StagedPatch } from "./worker";

/* minimal ExecutionContext stub */
const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;


/* Mock KV namespace */
function mockKV() {
  const store = new Map<string, string>();
  return {
    store,
    async put(k: string, v: string) { store.set(k, v); },
    async get(k: string) { return store.get(k) ?? null; },
    async delete(k: string) { store.delete(k); },
    async list({ prefix = "", cursor }: { prefix?: string; cursor?: string; limit?: number }) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix))
        .sort().map((name) => ({ name }));
      return { keys, list_complete: true, cursor: undefined };
    },
  };
}

const env: Env = {
  GRIP_EDITS: mockKV() as unknown as Env["GRIP_EDITS"],
  GRIP_GITHUB_PAT: "test-token",
  GRIP_ACCESS_CODE: "test-code",
  GRIP_UPSTREAM_REPO: "bilaljawaid980/Geomatric-Reasoning-Benchmark-Dataset",
  GITHUB_REPOSITORY: "mmaaaaz/agi-eval-data",
};

const HEAD_SHA = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
const TREE_SHA = "t1e2e3e4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
const NEW_COMMIT = "c0ffee0000000000000000000000000000000001";

function req(path: string, method = "GET", body?: unknown, code?: string): Request {
  return new Request(`https://grip-sync.test${path}`, {
    method,
    headers: { "content-type": "application/json", ...(code ? { "x-questions-code": code } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const patch = {
  version: 1,
  author: "maaz",
  reason: "test fix",
  editedAt: "2026-08-30T00:00:00Z",
  changes: [{ field: "q:x_q1.ground_truth", from: "45", to: "135" }],
};

/* mock GitHub: HEAD ref → commit → tree; blob POSTs; commit POST; ref PATCH */
function mockGithubFetch(opts: { refMoveStatus?: number } = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const j = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

    if (method === "GET" && url.endsWith("/git/ref/heads/main")) {
      return j({ object: { sha: HEAD_SHA } });
    }
    if (method === "GET" && url.includes("/git/commits/")) {
      return j({ tree: { sha: TREE_SHA } });
    }
    if (method === "POST" && url.endsWith("/git/blobs")) {
      return j({ sha: `blob-${Math.random().toString(36).slice(2, 10)}` }, 201);
    }
    if (method === "POST" && url.endsWith("/git/trees")) {
      return j({ sha: "new-tree-sha" }, 201);
    }
    if (method === "POST" && url.endsWith("/git/commits")) {
      return j({ sha: NEW_COMMIT }, 201);
    }
    if (method === "PATCH" && url.endsWith("/git/refs/heads/main")) {
      return j({ object: { sha: NEW_COMMIT } }, opts.refMoveStatus ?? 200);
    }
    if (method === "POST" && url.endsWith("/dispatches")) {
      return j({ ok: true }, 204);
    }
    return j({ message: "unexpected" }, 500);
  });
}

beforeEach(() => {
  (env.GRIP_EDITS as unknown as { store: Map<string, string> }).store.clear();
  vi.stubGlobal("fetch", mockGithubFetch());
});

describe("grip-sync worker", () => {
  it("stages and lists edits (gated)", async () => {
    const denied = await worker.fetch(req("/api/edits/route/route_puzzle_0001", "PUT", patch, "wrong"), env, ctx);
    expect(denied.status).toBe(403);

    const ok = await worker.fetch(req("/api/edits/route/route_puzzle_0001", "PUT", patch, "test-code"), env, ctx);
    expect(ok.status).toBe(200);

    const listed = await worker.fetch(req("/api/edits"), env, ctx);
    const body = (await listed.json()) as { edits: { slug: string; sampleId: string; patch: StagedPatch }[] };
    expect(body.edits).toHaveLength(1);
    expect(body.edits[0].slug).toBe("route");
    expect(body.edits[0].patch.baseCommitAtEdit).toBe(HEAD_SHA); // stamped at stage time
  });

  it("rejects a patch without reason/changes", async () => {
    const bad = await worker.fetch(req("/api/edits/route/x", "PUT", { version: 1 }, "test-code"), env, ctx);
    expect(bad.status).toBe(400);
  });

  it("sync: no edits → error", async () => {
    const res = await worker.fetch(req("/api/sync", "POST", undefined, "test-code"), env, ctx);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("error");
  });

  it("sync: happy path → one atomic commit, KV cleared", async () => {
    await worker.fetch(req("/api/edits/route/route_puzzle_0001", "PUT", patch, "test-code"), env, ctx);
    await worker.fetch(req("/api/edits/route/route_puzzle_0002", "PUT", { ...patch, reason: "second" }, "test-code"), env, ctx);

    const spy = mockGithubFetch();
    vi.stubGlobal("fetch", spy);

    const res = await worker.fetch(req("/api/sync", "POST", undefined, "test-code"), env, ctx);
    const body = (await res.json()) as { status: string; commitSha: string };
    expect(body.status).toBe("synced");
    expect(body.commitSha).toBe(NEW_COMMIT);

    // exactly one ref PATCH (atomic move) and one tree POST for 2 files
    const patchCalls = spy.mock.calls.filter((c) => String(c[0]).endsWith("/git/refs/heads/main") && c[1]?.method === "PATCH");
    const treeCalls = spy.mock.calls.filter((c) => String(c[0]).endsWith("/git/trees"));
    const blobCalls = spy.mock.calls.filter((c) => String(c[0]).endsWith("/git/blobs"));
    expect(patchCalls).toHaveLength(1);
    expect(treeCalls).toHaveLength(1);
    expect(blobCalls).toHaveLength(2);

    // KV cleared + artifact version bumped
    const store = (env.GRIP_EDITS as unknown as { store: Map<string, string> }).store;
    expect([...store.keys()].filter((k) => k.startsWith("ov:"))).toHaveLength(0);
    expect(store.get("site:artifactVersion")).toBe(NEW_COMMIT);
  });

  it("sync: upstream moved since edit → conflict, nothing pushed", async () => {
    await worker.fetch(req("/api/edits/route/route_puzzle_0001", "PUT", { ...patch, baseCommitAtEdit: "old-sha" }, "test-code"), env, ctx);
    // note: worker re-stamps baseCommitAtEdit at PUT from mocked HEAD… override after staging:
    const store = (env.GRIP_EDITS as unknown as { store: Map<string, string> }).store;
    const key = [...store.keys()][0];
    const entry = JSON.parse(store.get(key)!);
    entry.patch.baseCommitAtEdit = "0000000000000000000000000000000000000000";
    store.set(key, JSON.stringify(entry));

    const res = await worker.fetch(req("/api/sync", "POST", undefined, "test-code"), env, ctx);
    const body = (await res.json()) as { status: string; staleIds: string[] };
    expect(body.status).toBe("conflict");
    expect(body.staleIds).toContain("route/route_puzzle_0001");
  });

  it("sync: non-fast-forward ref move → conflict", async () => {
    await worker.fetch(req("/api/edits/route/route_puzzle_0001", "PUT", patch, "test-code"), env, ctx);
    vi.stubGlobal("fetch", mockGithubFetch({ refMoveStatus: 422 }));
    const res = await worker.fetch(req("/api/sync", "POST", undefined, "test-code"), env, ctx);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("conflict");
  });

  it("sync: dispatches grip-rebake to our repo after a successful sync", async () => {
    await worker.fetch(req("/api/edits/route/route_puzzle_0001", "PUT", patch, "test-code"), env, ctx);
    const spy = mockGithubFetch();
    vi.stubGlobal("fetch", spy);
    const res = await worker.fetch(req("/api/sync", "POST", undefined, "test-code"), env, ctx);
    const body = (await res.json()) as { status: string; rebakeDispatched: boolean };
    expect(body.status).toBe("synced");
    const dispatch = spy.mock.calls.find((c) => String(c[0]).endsWith("/dispatches"));
    expect(dispatch).toBeTruthy();
    expect(String(dispatch![1]?.body)).toContain('"event_type":"grip-rebake"');
    expect(String(dispatch![0])).toContain("mmaaaaz/agi-eval-data");
    expect(body.rebakeDispatched).toBe(true);
  });
});
