/** grip-sync worker client — staged edits + sync status.
 *  The worker is optional: when unconfigured, the UI falls back to
 *  copy-JSON override files (documented in docs/grip.md).
 */
import type { StagedEdit } from "./gripTypes";

const SETTINGS_KEY = "grip.settings.v1";

export interface GripSettings {
  /** worker base URL, e.g. https://grip-sync.<account>.workers.dev */
  relay: string;
  /** access code for mutating endpoints (x-questions-code) */
  accessCode: string;
}

export function loadSettings(): GripSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<GripSettings>;
      return { relay: s.relay ?? "", accessCode: s.accessCode ?? "" };
    }
  } catch { /* ignore */ }
  return { relay: "", accessCode: "" };
}

export function saveSettings(s: GripSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function base(): string {
  return loadSettings().relay.replace(/\/+$/, "");
}

function code(): string {
  return loadSettings().accessCode;
}

export function workerConfigured(): boolean {
  return base().length > 0;
}

/* ---------- staged edits ---------- */

export async function listStagedEdits(slug?: string): Promise<StagedEdit[]> {
  const url = `${base()}/api/edits${slug ? `?slug=${encodeURIComponent(slug)}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`edits fetch failed: ${res.status}`);
  const j = (await res.json()) as { edits: StagedEdit[] };
  return j.edits ?? [];
}

export async function stageEdit(slug: string, sampleId: string, patch: StagedEdit["patch"]): Promise<void> {
  const res = await fetch(`${base()}/api/edits/${encodeURIComponent(slug)}/${encodeURIComponent(sampleId)}`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-questions-code": code() },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`stage failed: ${res.status} ${text.slice(0, 120)}`);
  }
}

export async function deleteStagedEdit(slug: string, sampleId: string): Promise<void> {
  const res = await fetch(
    `${base()}/api/edits/${encodeURIComponent(slug)}/${encodeURIComponent(sampleId)}`,
    { method: "DELETE", headers: { "x-questions-code": code() } },
  );
  if (!res.ok) throw new Error(`delete failed: ${res.status}`);
}

/* ---------- sync ---------- */

export interface SyncStatus {
  staged: number;
  upstreamSha: string | null;
  baseShasMatch: boolean;
}

export async function syncStatus(): Promise<SyncStatus> {
  const res = await fetch(`${base()}/api/sync/status`);
  if (!res.ok) throw new Error(`status failed: ${res.status}`);
  return (await res.json()) as SyncStatus;
}

export type SyncResult =
  | { status: "synced"; commitSha: string }
  | { status: "conflict"; upstreamSha: string; staleIds: string[] }
  | { status: "error"; message: string };

export async function runSync(): Promise<SyncResult> {
  const res = await fetch(`${base()}/api/sync`, {
    method: "POST",
    headers: { "x-questions-code": code() },
  });
  return (await res.json()) as SyncResult;
}
