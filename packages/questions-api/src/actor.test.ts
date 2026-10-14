import { describe, expect, it } from "vitest";
import {
  ACTOR_COOKIE,
  actorSetCookie,
  issueActor,
  newActorId,
  parseCookies,
  verifyActor,
} from "./actor";

/**
 * The threat model is narrow and so are these tests: a contributor must not be
 * able to sign in as somebody else by editing localStorage. This is NOT
 * authentication and nothing here should be read as an access control.
 */

const SECRET = "test-secret";

describe("issuing an identity", () => {
  it("produces an id and a cookie that verifies", async () => {
    const { id, cookie } = await issueActor(SECRET);
    expect(id).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(cookie.startsWith(id + ".")).toBe(true);
    expect(await verifyActor(SECRET, cookie)).toBe(id);
  });

  it("reuses a client-supplied id only when it looks like one", async () => {
    const good = await issueActor(SECRET, "abcdefgh-1234");
    expect(good.id).toBe("abcdefgh-1234");
    // anything that is not an id shape is replaced, not trusted
    const bad = await issueActor(SECRET, "../../etc/passwd");
    expect(bad.id).not.toBe("../../etc/passwd");
    expect(bad.id).toMatch(/^[A-Za-z0-9-]{8,64}$/);
  });

  it("generates distinct ids", () => {
    const seen = new Set(Array.from({ length: 50 }, () => newActorId()));
    expect(seen.size).toBe(50);
  });
});

describe("verifying a cookie", () => {
  it("rejects a cookie signed with a different secret", async () => {
    const { cookie } = await issueActor("other-secret");
    expect(await verifyActor(SECRET, cookie)).toBeNull();
  });

  it("rejects a tampered id inside a valid cookie", async () => {
    const { cookie } = await issueActor(SECRET);
    const mac = cookie.slice(cookie.lastIndexOf(".") + 1);
    expect(await verifyActor(SECRET, "someone-else-1234." + mac)).toBeNull();
  });

  it("rejects a tampered signature", async () => {
    const { id } = await issueActor(SECRET);
    expect(await verifyActor(SECRET, id + ".not-a-real-mac")).toBeNull();
  });

  it("rejects absent, empty and malformed values without throwing", async () => {
    for (const v of [null, undefined, "", "no-dot", ".", "id.", ".mac", "a.b.c.d"]) {
      expect(await verifyActor(SECRET, v as string | null)).toBeNull();
    }
  });

  it("rejects an id of the wrong shape even with a correct-looking mac", async () => {
    const { cookie } = await issueActor(SECRET);
    const mac = cookie.slice(cookie.lastIndexOf(".") + 1);
    expect(await verifyActor(SECRET, "short." + mac)).toBeNull();
  });
});

describe("cookie plumbing", () => {
  it("parses a cookie header", () => {
    const c = parseCookies("a=1; " + ACTOR_COOKIE + "=xyz.abc; b=2");
    expect(c[ACTOR_COOKIE]).toBe("xyz.abc");
    expect(c.a).toBe("1");
  });

  it("survives a missing or odd header", () => {
    expect(parseCookies(null)).toEqual({});
    expect(parseCookies("garbage")).toEqual({});
    expect(parseCookies("=noname")).toEqual({});
  });

  it("sets HttpOnly, SameSite and a long life", () => {
    const s = actorSetCookie("id.mac");
    expect(s).toContain("HttpOnly");
    expect(s).toContain("SameSite=Lax");
    expect(s).toContain("Path=/");
    expect(s).toContain("Max-Age=");
    expect(s).toContain("Secure");
  });

  it("can drop Secure for local development", () => {
    expect(actorSetCookie("id.mac", false)).not.toContain("Secure");
  });
});
