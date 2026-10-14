/**
 * Server-issued actor identity.
 *
 * NOT authentication, and it must never be described as such. The point is
 * narrower and worth stating precisely: an actor id in the ledger should be one
 * the SERVER chose and can verify, so a contributor cannot casually impersonate
 * somebody else by editing localStorage. That is the whole threat model — a
 * research ledger, not an access control system.
 *
 * The display name stays client-supplied, because it is a label for credit, not a
 * security boundary. An email address must never reach this module or the API.
 */

export const ACTOR_COOKIE = "bench_actor";

/** How long an issued identity is reused before the server rotates it. */
export const ACTOR_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return base64url(new Uint8Array(mac));
}

/** Constant-time compare, so a wrong guess cannot be timed byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function newActorId(): string {
  return crypto.randomUUID();
}

/** The cookie value is "<id>.<mac>". Nothing else is trusted. */
export async function issueActor(secret: string, id?: string): Promise<{ id: string; cookie: string }> {
  const actorId = id && /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : newActorId();
  const mac = await hmac(secret, actorId);
  return { id: actorId, cookie: actorId + "." + mac };
}

/**
 * Verify a cookie and return the actor id, or null if it is absent, malformed, or
 * was not signed by this server. A null return means "issue a fresh identity";
 * it never means "reject the request", because attribution is not a gate.
 */
export async function verifyActor(secret: string, cookie: string | undefined | null): Promise<string | null> {
  if (!cookie) return null;
  const i = cookie.lastIndexOf(".");
  if (i <= 0 || i === cookie.length - 1) return null;
  const id = cookie.slice(0, i);
  const mac = cookie.slice(i + 1);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return null;
  const expected = await hmac(secret, id);
  return timingSafeEqual(expected, mac) ? id : null;
}

export function actorSetCookie(cookie: string, secure = true): string {
  return [
    ACTOR_COOKIE + "=" + encodeURIComponent(cookie),
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=" + ACTOR_MAX_AGE_SECONDS,
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}
