/** Canonical HTTP constants + helpers for the relay — single source of CORS. */

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
    // EVERY HEADER THE CLIENT ACTUALLY SENDS, OR THE BROWSER REFUSES THE REQUEST.
    //
    // Found in round 152 from the owner's report that /choose showed
    // "NetworkError when attempting to fetch resource". **Every request from the site failed**,
    // not just that page: `call()` in packages/site/src/questions.ts attaches `x-actor` and
    // `x-actor-name` to EVERY call, including plain GETs, so each one triggered a preflight
    // that this list rejected.
    //
    // **Nothing caught it because every test calls the handler directly.** A CORS preflight is
    // performed by a BROWSER, and no test in this repository is a browser. The API was correct
    // and the site was unusable.
    "Access-Control-Allow-Headers":
      "Content-Type, X-Access-Code, X-Questions-Code, X-Harness-Code, X-Actor, X-Actor-Name",
  "Access-Control-Max-Age": "86400",
};

export function jsonResponse(obj: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...extra },
  });
}
