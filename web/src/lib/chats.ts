/** Chat persistence — IndexedDB, zero dependencies. Graceful fallback to memory. */

export interface UiMsg {
  id: string;
  role: "user" | "assistant" | "tool" | "note";
  content: string;
  toolCalls?: { id: string; name: string; args: string }[];
  toolResults?: Record<string, { columns: string[]; rows: Record<string, unknown>[]; rowCount: number; sql: string } | { error: string }>;
  toolCallId?: string;
  durationMs?: number;
}

export interface StoredChat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: UiMsg[];
}

const DB_NAME = "agi-eval-chats";
const STORE = "chats";
let mem = new Map<string, StoredChat>();
let idbf: IDBDatabase | null = null;

function db(): Promise<IDBDatabase | null> {
  if (idbf) return Promise.resolve(idbf);
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => {
        idbf = req.result;
        resolve(idbf);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T | null> {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const req = fn(d.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function listChats(): Promise<StoredChat[]> {
  const all = (await tx<StoredChat[]>("readonly", (s) => s.getAll())) ?? [...mem.values()];
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getChat(id: string): Promise<StoredChat | null> {
  const c = await tx<StoredChat>("readonly", (s) => s.get(id));
  if (c) return c;
  return mem.get(id) ?? null;
}

export async function saveChat(chat: StoredChat): Promise<void> {
  mem.set(chat.id, chat);
  await tx("readwrite", (s) => s.put(chat));
}

export async function deleteChat(id: string): Promise<void> {
  mem.delete(id);
  await tx("readwrite", (s) => s.delete(id));
}

export function titleFrom(messages: UiMsg[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "new chat";
  const body = first.content.split("\n\n").slice(-1)[0] || first.content;
  return body.slice(0, 64) || "new chat";
}
