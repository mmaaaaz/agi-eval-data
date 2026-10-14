import { describe, expect, it } from "vitest";
import worker from "./worker";

/*
 * THE WORKER'S fetch TAKES TWO ARGUMENTS, NOT THREE.
 *
 * The first version copied grip-sync's shape and passed an ExecutionContext third. That is
 * correct for a worker typed against the full `ExportedHandler`, and this one is not — so it
 * COMPILED UNDER VITEST AND FAILED `tsc`. **The tests passed and the typecheck did not**, which
 * is exactly the state a test-only run cannot see.
 */
/*
 * THE CAST IS THE POINT, NOT A WORKAROUND. The DOM lib's `Request` and the Workers runtime's
 * `Request<unknown, IncomingRequestCfProperties>` are structurally close and nominally different.
 * Stubbing the runtime's type would mean importing the whole binding surface for a unit test;
 * casting once, here, keeps the cost in one line and keeps the assertions typed.
 */
const call = (path: string, init?: RequestInit, env: Record<string, unknown> = {}) =>
  worker.fetch(new Request("https://relay.test" + path, init) as never, env as never);

/*
 * THE THIRD DOOR, AND THE REASON THIS FILE EXISTS.
 *
 * `/api/chat` was `if (env.ACCESS_CODE && ...)` — an UNSET secret meant NO AUTHENTICATION AT ALL,
 * the opposite of the rule this project states about its other two doors. It also spends: it
 * reaches a paid OpenAI model through the AI gateway.
 *
 * The fix was made in round 89 and **had no test**. These are the assertions that make it a
 * property rather than a change: a door that fails closed stays closed when a future edit makes
 * the check look redundant.
 */
describe("the chat door fails CLOSED", () => {
  it("refuses when ACCESS_CODE is unset — an unconfigured door is disabled, not open", async () => {
    const res = await call("/api/chat", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("refuses a WRONG code", async () => {
    const res = await call("/api/chat", {
      method: "POST",
      headers: { "x-access-code": "guess" },
    }, { ACCESS_CODE: "s3cret" });
    expect(res.status).toBe(401);
  });

  it("refuses a MISSING header when a code is configured", async () => {
    const res = await call("/api/chat", { method: "POST" }, { ACCESS_CODE: "s3cret" });
    expect(res.status).toBe(401);
  });

  it("says WHICH case it is, so an operator is not left guessing", async () => {
    const unset = await call("/api/chat", { method: "POST" });
    const wrong = await call("/api/chat", { method: "POST", headers: { "x-access-code": "x" } },
      { ACCESS_CODE: "s3cret" });
    const a = (await unset.json()) as { error?: string };
    const b = (await wrong.json()) as { error?: string };
    expect(String(a.error)).toMatch(/ACCESS_CODE/);
    expect(String(b.error)).toMatch(/invalid access code/);
  });

  it("lets the RIGHT code through to the next check, which is the gateway", async () => {
    // It passes the door and is stopped by the missing key rather than by the code — which
    // proves the door OPENED, and that the failure is a different one.
    const res = await call("/api/chat", {
      method: "POST",
      headers: { "x-access-code": "s3cret" },
    }, { ACCESS_CODE: "s3cret" });
    expect(res.status).not.toBe(401);
  });
});

describe("the open routes", () => {
  it("answers /api/health without any credential", async () => {
    const res = await call("/api/health");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { service?: string }).service).toBe("agi-eval-relay");
  });

  it("reports which DOORS are configured, without inventing a transport", async () => {
    const res = await call("/api/info");
    const j = (await res.json()) as {
      role?: string; doors?: { approval?: string; measurement?: string; chat?: string }
    };
    // THE TRANSPORT IS GONE. This used to assert `model: "unset"` and
    // `transport: "ai-sdk-v5"` - a transport the Worker no longer has, since the chat route was
    // retired and the AI SDK removed in round 134. **A deployed endpoint advertising a transport
    // it does not have is a claim nothing checks.**
    expect(j.role).toBe("questions API");
    expect(j.doors?.approval).toMatch(/DISABLED/);
    expect(j.doors?.measurement).toMatch(/DISABLED/);
    expect(j.doors?.chat).toBe("retired");
  });

  it("says a door is CONFIGURED when its secret is set", async () => {
    const res = await call("/api/info", undefined, { QUESTIONS_CODE: "s3cret" });
    const j = (await res.json()) as { doors?: { approval?: string } };
    expect(j.doors?.approval).toBe("configured");
  });

  it("answers a preflight with 204 and CORS headers", async () => {
    const res = await call("/api/health", { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
  });
});
