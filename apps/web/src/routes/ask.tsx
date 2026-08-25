import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import type { UIMessage } from "ai";
import { z } from "zod";
import { viewingContext } from "../lib/brief";
import { loadParquet, isParquetLoaded, runSql } from "../lib/duck";
import {
  listChats, getChat, saveChat, deleteChat, titleFrom,
  type StoredChat,
} from "../lib/chats";
import { loadSettings, saveSettings, type AskSettings as AskSettingsData } from "../lib/ai/settings";
import { MsgView } from "../components/ask/AskMessages";
import { normSql } from "@agi-eval/shared";
import { Eyebrow } from "../components/Section";
import { fmtN } from "../lib/format";

const searchSchema = z.object({ c: z.string().optional() });

export const Route = createFileRoute("/ask")({
  validateSearch: searchSchema,
  component: Ask,
});

const SQL_TOOL = {
  name: "run_sql",
  description:
    "Execute a read-only SELECT (DuckDB dialect) against the dataset. Tables: images(id, name, ext, size, day 'YYYY-MM-DD', owner email, md5, kind 'i'|'v'|'o', width, height, megapixels, camera, orientation 'landscape'|'portrait'|'square'), owners(email, name), dup_groups(md5, copies, bytes). Use for ANY precise count, filter, group-by, ranking or listing question instead of guessing from the brief.",
  parameters: {
    type: "object",
    properties: {
      sql: { type: "string", description: "Single SELECT statement. LIMIT added automatically (200) if missing." },
    },
    required: ["sql"],
  },
};
const CONTRIBUTOR_STOP = new Set(["the", "and", "has", "was", "all", "who", "how", "many", "much", "are", "did", "does", "what", "when", "where", "which", "with", "for", "from", "that", "this", "have", "been", "were", "their", "them", "they", "about", "into", "over", "under", "most", "least", "more", "some", "any", "total"]);

/** Exact-email context for contributors the question mentions; "" when none.
 *  Token matching only — raw substrings once made "the" match "theyellowdog123". */
function contributorContext(text: string, ownerEmails: string[]): string {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !CONTRIBUTOR_STOP.has(w));
  if (words.length === 0) return "";
  const tokensOf = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const matches = ownerEmails.filter((email) => {
    const toks = tokensOf(email.split("@")[0]);
    return words.some((w) => toks.some((t) => t === w || (t.startsWith(w) && w.length >= 4)));
  });
  return matches.length
    ? `CONTRIBUTOR MATCHES (use these exact owner emails):\n${matches.map((e) => `- ${e}`).join("\n")}`
    : "";
}

/** Request-side context window: 16 messages, old tool results compressed to 8 rows. */
const MAX_CONTEXT_MESSAGES = 16;
const MAX_TOOL_ROWS_IN_HISTORY = 8;

function leanHistory(messages: UIMessage[]): UIMessage[] {
  const alive = messages.filter((m) => {
    if (m.role !== "assistant") return true;
    const dead = new Set(["streaming", "input-streaming", "input-available"]);
    return m.parts.every((p) => !("state" in p) || !dead.has(String(p.state)));
  });
  const windowed = alive.length > MAX_CONTEXT_MESSAGES ? alive.slice(-MAX_CONTEXT_MESSAGES) : alive;
  return windowed.map((m) => {
    if (m.role !== "assistant") return m;
    const parts = m.parts.map((p) => {
      if (p.type !== "tool-run_sql" || !("output" in p) || typeof p.output !== "string") return p;
      try {
        const o = JSON.parse(p.output) as { rows?: unknown[]; rowCount?: number; columns?: string[] };
        if (Array.isArray(o.rows) && o.rows.length > MAX_TOOL_ROWS_IN_HISTORY) {
          return { ...p, output: JSON.stringify({ columns: o.columns, rows: o.rows.slice(0, MAX_TOOL_ROWS_IN_HISTORY), rowCount: o.rowCount, note: `showing ${MAX_TOOL_ROWS_IN_HISTORY} of ${o.rows.length} rows — re-run the query if you need different rows` }) };
        }
      } catch { /* keep original output */ }
      return p;
    });
    return { ...m, parts };
  });
}

const newChatId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function sysNote(content: string): UIMessage {
  return { id: `n${Date.now()}${Math.random().toString(36).slice(2, 6)}`, role: "system", parts: [{ type: "text", text: content }] };
}

function Ask() {
  const location = useLocation();
  const navigate = useNavigate();
  const search = Route.useSearch();

  const [settings] = useState<AskSettingsData>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [pooledModel, setPooledModel] = useState<string | null>(null);

  const [chats, setChats] = useState<StoredChat[]>([]);
  const [activeId, setActiveId] = useState<string | null>(search.c ?? null);
  const saveTimer = useRef<number | null>(null);
  const chatMeta = useRef(new Map<string, number>());

  const [input, setInput] = useState("");
  const [openTool, setOpenTool] = useState<string | null>(null);
  const [executingTool, setExecutingTool] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bootstrapped = useRef(false);
  const sqlCache = useRef(new Map<string, string>());
  const ranSqlCount = useRef(0);

  const [totalItems, setTotalItems] = useState<number | null>(null);
  const [ownerEmails, setOwnerEmails] = useState<string[]>([]);
  const [sqlStatus, setSqlStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [sqlError, setSqlError] = useState("");

  useEffect(() => saveSettings(settings), [settings]);

  /* ---------------- DuckDB preload ---------------- */

  useEffect(() => {
    if (isParquetLoaded()) { setSqlStatus("ready"); return; }
    setSqlStatus("loading");
    fetch("/data/version.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => {
        if (v?.counts?.all != null) setTotalItems(v.counts.all);
        if (Array.isArray(v?.owners)) setOwnerEmails(v.owners);
      })
      .catch(() => {});
    loadParquet()
      .then(() => setSqlStatus("ready"))
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        setSqlStatus("error");
        setSqlError(msg);
        console.error("[duckdb]", msg);
      });
  }, []);

  // pooled model name for the chip
  useEffect(() => {
    const relay = (settings.relay || "").replace(/\/+$/, "");
    if (!relay) return;
    fetch(`${relay}/api/info`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.model) setPooledModel(j.model);
      })
      .catch(() => {});
  }, [settings.relay]);

  const retrySql = useCallback(() => {
    setSqlStatus("loading");
    loadParquet()
      .then(() => setSqlStatus("ready"))
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        setSqlStatus("error");
        setSqlError(msg);
        console.error("[duckdb]", msg);
      });
  }, []);

  /* ---------------- persistence (debounced) ---------------- */

  const refreshList = useCallback(() => {
    void listChats().then(setChats);
  }, []);

  /* ---------------- boot: restore or fresh ---------------- */

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void (async () => {
      const list = await listChats();
      setChats(list);
      const want = search.c ?? list[0]?.id ?? null;
      if (want) {
        const chat = list.find((x) => x.id === want) ?? (await getChat(want));
        if (chat) {
          setActiveId(chat.id);
          setMessages(chat.messages);
          return;
        }
      }
      setActiveId(null);
      setMessages([]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- AI SDK v5 chat ---------------- */

  /* one-shot retry around the transport: transient network failures (e.g. the
     auto-continuation after a tool result) get a second chance instead of a
     dead-end NetworkError. HTTP errors are NOT retried. */
  const fetchWithRetry = useMemo(() => {
    const f: typeof fetch = async (input, init) => {
      try {
        return await fetch(input, init);
      } catch (e) {
        if (init?.signal?.aborted) throw e;
        const sleep = Promise.withResolvers<void>();
        setTimeout(sleep.resolve, 700);
        await sleep.promise;
        return fetch(input, init);
      }
    };
    return f;
  }, []);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${settings.relay.replace(/\/+$/, "")}/api/chat`,
        headers: settings.accessCode ? { "x-access-code": settings.accessCode } : undefined,
        // the relay needs the tool schema to enable tool-calling on the model.
        prepareSendMessagesRequest: ({ messages }) => {
          // per-turn context (viewing + contributor emails) rides in the body,
          // NOT in the message text — the user's bubble stays pristine and the
          // relay injects it into the model's view server-side
          const lastUser = [...messages].reverse().find((m) => m.role === "user");
          const q = lastUser?.parts.find((p) => p.type === "text")?.text ?? "";
          const viewing = viewingContext(location.pathname, location.search as Record<string, unknown>);
          const ctx = [viewing, ownerEmails.length ? contributorContext(q, ownerEmails) : ""].filter(Boolean).join("\n\n");
          return {
            body: {
              messages: leanHistory(messages),
              tools: [SQL_TOOL],
              ...(ctx ? { context: ctx } : {}),
            },
          };
        },
        fetch: fetchWithRetry,
      }),
    [settings.relay, settings.accessCode, ownerEmails, location, fetchWithRetry],
  );


  const { messages, sendMessage, status, stop, setMessages, addToolOutput, error } = useChat({
    id: activeId ?? "default",
    transport,
    async onToolCall({ toolCall }) {
      if (toolCall.toolName !== "run_sql") return;
      const input = toolCall.input as { sql?: string };
      const cacheKey = normSql(input.sql ?? "");

      // identical query already ran in this conversation → instant cached
      // result plus a nudge, since weak models tend to re-call before answering
      const cached = sqlCache.current.get(cacheKey);
      if (cached) {
        addToolOutput({
          tool: "run_sql",
          toolCallId: toolCall.toolCallId,
          output: JSON.stringify({
            note: "identical query already executed in this conversation — its result is included below. Do NOT call run_sql again; answer the user now.",
            ...(JSON.parse(cached) as Record<string, unknown>),
          }),
        });
        return;
      }

      // per-turn budget: room for self-correction + one refinement, then force
      // the answer. gpt-5-nano loops re-runs otherwise (measured: 4 in a row).
      if (ranSqlCount.current >= 3) {
        addToolOutput({
          tool: "run_sql",
          toolCallId: toolCall.toolCallId,
          output: JSON.stringify({ error: "3 SQL queries already answered this question. Do NOT call run_sql again. Write the final answer now from the results above." }),
        });
        return;
      }

      setExecutingTool(toolCall.toolCallId);
      try {
        const out = await runSql(input.sql ?? "");
        // the wrap-up note is the anti-repeat measure: weak models tend to
        // re-run the identical query to "verify" before answering — tell them
        // the execution is final at the exact place they read it
        const outNote = ranSqlCount.current >= 1
          ? `This is result #${ranSqlCount.current + 1} of this turn. You have enough data. Your next message MUST be the final answer with NO tool calls.`
          : "query executed — this result is final. Answer the user now; do NOT re-run this query.";
        const output = "error" in out
          ? JSON.stringify(out)
          : JSON.stringify({ ...out, note: outNote });
        if (!("error" in out)) {
          sqlCache.current.set(cacheKey, output);
        }
        ranSqlCount.current++;
        // provide the result; sendAutomaticallyWhen continues the conversation
        addToolOutput({ tool: "run_sql", toolCallId: toolCall.toolCallId, output });
      } finally {
        setExecutingTool(null);
      }
    },
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onError: (e) => console.error("[chat]", e),
  });

  const streaming = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (!streaming) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [streaming]);

  // restore messages when switching to a chat that exists in IndexedDB
  useEffect(() => {
    if (!activeId || messages.length > 0) return;
    let cancelled = false;
    void (async () => {
      const chat = await getChat(activeId);
      if (!cancelled && chat && chat.messages.length) {
        setMessages(chat.messages);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId, messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // persist on message changes (debounced)
  useEffect(() => {
    if (!activeId || messages.length === 0) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const chat: StoredChat = {
        id: activeId,
        title: titleFrom(messages),
        createdAt: chatMeta.current.get(activeId) ?? Date.now(),
        updatedAt: Date.now(),
        messages,
      };
      chatMeta.current.set(activeId, chat.createdAt);
      void saveChat(chat).then(refreshList);
    }, 350);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [messages, activeId, refreshList]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- chat ops ---------------- */

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    ranSqlCount.current = 0;
    sqlCache.current.clear();
    const id = newChatId();
    setActiveId(id);
    setMessages([]);
    setOpenTool(null);
    navigate({ to: "/ask", search: { c: id } });
  }, [navigate]);

  const switchChat = useCallback(
    (id: string) => {
      if (id === activeId) return;
      abortRef.current?.abort();
      void (async () => {
        const chat = await getChat(id);
        ranSqlCount.current = 0;
        sqlCache.current.clear();
        setActiveId(id);
        setMessages(chat?.messages ?? []);
        setOpenTool(null);
        navigate({ to: "/ask", search: { c: id } });
      })();
    },
    [activeId, navigate],
  );

  const removeChat = useCallback(
    (id: string) => {
      void deleteChat(id).then(() => {
        refreshList();
        if (id === activeId) newChat();
      });
    },
    [activeId, newChat, refreshList],
  );

  /* ---------------- send ---------------- */

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || streaming) return;
    if (sqlStatus === "error") {
      setMessages((m) => [...m, sysNote("SQL engine unavailable — try again in a moment")]);
      return;
    }

    // fresh question → fresh per-turn SQL attempt budget
    ranSqlCount.current = 0;
    let sqlAvailable = isParquetLoaded();
    if (!sqlAvailable) {
      setSqlStatus("loading");
      void loadParquet()
        .then(() => {
          sqlAvailable = true;
          setSqlStatus("ready");
        })
        .catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          setSqlStatus("error");
          setSqlError(msg);
          setMessages((m) => [...m, sysNote(`sql engine unavailable (${msg}) — answering from the dataset summary only`)]);
        });
    }

    // viewing + contributor context is attached invisibly at request time
    // (prepareSendMessagesRequest → body.context) — never in the message text
    sendMessage({ text });
  };

  const sqlReady = sqlStatus === "ready";
  const sqlUsable = sqlStatus === "ready" || sqlStatus === "error";

  return (
    <div className="flex h-[calc(100dvh-11rem)] min-h-[440px] lg:h-[calc(100dvh-9rem)]">
      {/* sidebar (desktop) */}
      <aside className="mr-4 hidden w-56 shrink-0 flex-col border-r border-[#262626] pr-3 lg:flex">
        <button
          onClick={newChat}
          className="mb-3 w-full rounded-md border border-accent/50 px-3 py-2 font-mono text-[11px] text-accent transition-colors hover:bg-accent hover:text-white"
        >
          + new chat
        </button>
        <div className="scrollbar-none min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {chats.map((ch) => (
            <div key={ch.id} className="group relative">
              <button
                onClick={() => switchChat(ch.id)}
                className={`w-full truncate rounded-md px-2.5 py-2 pr-7 text-left font-mono text-[11px] transition-colors ${
                  ch.id === activeId ? "bg-[#141414] text-white" : "text-[#a1a1a1] hover:bg-[#0f0f0f] hover:text-white"
                }`}
                title={ch.title}
              >
                {ch.title}
              </button>
              <button
                onClick={() => removeChat(ch.id)}
                aria-label="Delete chat"
                className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded p-1 font-mono text-[10px] text-[#666] transition-colors hover:text-danger group-hover:block"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Eyebrow n="03">ask ai</Eyebrow>

        {/* mobile chat switcher */}
        <div className="mb-2 flex items-center gap-2 lg:hidden">
          <button
            onClick={newChat}
            className="rounded-md border border-accent/50 px-2.5 py-1 font-mono text-[10px] text-accent transition-colors hover:bg-accent hover:text-white"
          >
            + new
          </button>
          {chats.length > 0 && (
            <select
              value={activeId ?? ""}
              onChange={(e) => (e.target.value ? switchChat(e.target.value) : newChat())}
              className="min-w-0 flex-1 rounded-md border border-[#262626] bg-[#0a0a0a] px-2 py-1 font-mono text-[10px] text-[#ededed] outline-none focus:border-accent"
            >
              {activeId && !chats.some((ch) => ch.id === activeId) && (
                <option value={activeId}>current chat</option>
              )}
              {chats.map((ch) => (
                <option key={ch.id} value={ch.id}>{ch.title}</option>
              ))}
            </select>
          )}
        </div>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-white">Chat with the dataset</h1>
          <div className="flex items-center gap-2">
            <span
              className={`rounded border px-2 py-1 font-mono text-[10px] ${
                sqlStatus === "ready"
                  ? "border-[#0cce6b]/40 text-[#0cce6b]"
                  : sqlStatus === "error"
                    ? "border-danger/40 text-danger"
                    : "border-[#262626] text-[#666]"
              }`}
              title={sqlStatus === "error" ? sqlError : "in-browser DuckDB over the artifact"}
            >
              SQL: {sqlStatus}
              {sqlReady && totalItems != null ? ` · ${fmtN(totalItems)} rows` : ""}
            </span>
            <span className="rounded border border-[#262626] px-2 py-1 font-mono text-[10px] text-[#666]" title="fixed model, set on the relay">
              {pooledModel ?? "pooled"}
            </span>
            <button
              onClick={() => setShowSettings((v) => !v)}
              className="rounded-md border border-[#262626] px-2.5 py-1 font-mono text-[11px] text-[#a1a1a1] transition-colors hover:border-[#404040] hover:text-white"
            >
              {showSettings ? "hide settings ▴" : "settings ▾"}
            </button>
          </div>
        </div>

        {sqlStatus === "error" && (
          <div className="mb-3 rounded-lg border border-danger/40 bg-danger/5 p-3">
            <p className="break-all font-mono text-[11px] leading-5 text-danger">{sqlError}</p>
            <button
              onClick={retrySql}
              className="mt-2 rounded-md border border-danger/50 px-3 py-1.5 font-mono text-[11px] text-danger transition-colors hover:bg-danger/10"
            >
              retry SQL engine
            </button>
            <p className="mt-2 font-mono text-[10px] text-[#666]">chat works without SQL — answers will come from the dataset summary only</p>
          </div>
        )}

        {/* messages */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-[#262626] bg-[#0a0a0a]/40 p-4">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <p className="font-mono text-xs text-[#666]">
                ask anything — the AI answers from real SQL over {totalItems != null ? fmtN(totalItems) : "…"} rows
              </p>
              <p className="max-w-md font-mono text-[10px] leading-5 text-[#404040]">
                "how many landscape shots from bilal in august?" · "top 5 days by uploads" · "which contributor has the most duplicates?"
              </p>
            </div>
          )}
          <div className="space-y-4">
            {(() => {
              const shownSql = new Set<string>();
              return messages.map((m) => (
                <MsgView key={m.id} m={m} shownSql={shownSql} executingTool={executingTool} openTool={openTool} setOpenTool={setOpenTool} />
              ));
            })()}
            {streaming && (
              <div className="flex items-center gap-2 font-mono text-[10px] text-[#666]">
                <span className="h-[6px] w-[6px] animate-pulse rounded-full bg-accent" />
                {executingTool ? "running query…" : "thinking…"} · {elapsed}s
              </div>
            )}
            {error && (
              <p className="rounded-md border border-danger/40 bg-danger/5 p-2 font-mono text-[10px] text-danger">
                {error.message.slice(0, 300)}
              </p>
            )}
          </div>
        </div>

        {/* composer */}
        <form
          className="mt-3 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) {
              send(input);
              setInput("");
            }
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (input.trim()) {
                  send(input);
                  setInput("");
                }
              }
            }}
            rows={1}
            disabled={sqlStatus === "loading"}
            placeholder={
              sqlStatus === "loading"
                ? "loading SQL engine…"
                : streaming
                  ? "streaming…"
                  : "ask about the dataset… (Enter to send, Shift+Enter newline)"
            }
            className="max-h-40 min-h-[42px] flex-1 resize-y rounded-lg border border-[#262626] bg-[#0a0a0a] px-3.5 py-2.5 font-mono text-xs text-[#ededed] outline-none transition-colors placeholder:text-[#666] focus:border-accent"
          />
          {streaming ? (
            <button
              type="button"
              onClick={() => stop()}
              className="h-[42px] rounded-lg border border-danger/50 px-4 font-mono text-xs text-danger transition-colors hover:bg-danger/10"
            >
              stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim() || !sqlUsable}
              title={!sqlUsable ? "waiting for the SQL engine" : undefined}
              className="h-[42px] rounded-lg bg-white px-4 font-mono text-xs font-semibold text-black transition-opacity disabled:opacity-30"
            >
              send
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

/* ---------------- message rendering ---------------- */
