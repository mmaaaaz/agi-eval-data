import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import type { UIMessage } from "ai";
import { z } from "zod";
import { useData } from "../lib/dataContext";
import { viewingContext } from "../lib/brief";
import { loadArtifact, isLoaded, runSql, type SqlResult } from "../lib/duck";
import {
  listChats, getChat, saveChat, deleteChat, titleFrom,
  type StoredChat,
} from "../lib/chats";
import { loadSettings, saveSettings, type AskSettings as AskSettingsData } from "../lib/ai/settings";
import { AskSettings } from "../components/AskSettings";
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

const newChatId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function sysNote(content: string): UIMessage {
  return { id: `n${Date.now()}${Math.random().toString(36).slice(2, 6)}`, role: "system", parts: [{ type: "text", text: content }] };
}

function Ask() {
  const { data } = useData();
  const location = useLocation();
  const navigate = useNavigate();
  const search = Route.useSearch();

  const [settings, setSettings] = useState<AskSettingsData>(loadSettings);
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

  const [sqlStatus, setSqlStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [sqlError, setSqlError] = useState("");

  useEffect(() => saveSettings(settings), [settings]);

  /* ---------------- DuckDB preload ---------------- */

  useEffect(() => {
    if (!data || isLoaded(data)) return;
    setSqlStatus("loading");
    loadArtifact(data)
      .then(() => setSqlStatus("ready"))
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        setSqlStatus("error");
        setSqlError(msg);
        console.error("[duckdb]", msg);
      });
  }, [data]);

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
    if (!data) return;
    setSqlStatus("loading");
    loadArtifact(data)
      .then(() => setSqlStatus("ready"))
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        setSqlStatus("error");
        setSqlError(msg);
        console.error("[duckdb]", msg);
      });
  }, [data]);

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

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${settings.relay.replace(/\/+$/, "")}/api/chat`,
        headers: settings.accessCode ? { "x-access-code": settings.accessCode } : undefined,
        // the relay needs the tool schema to enable tool-calling on the model
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { messages, tools: [SQL_TOOL] },
        }),
      }),
    [settings.relay, settings.accessCode],
  );


  const { messages, sendMessage, status, stop, setMessages, addToolOutput, error } = useChat({
    id: activeId ?? "default",
    transport,
    async onToolCall({ toolCall }) {
      if (toolCall.toolName !== "run_sql") return;
      const input = toolCall.input as { sql?: string };
      const cacheKey = (input.sql ?? "").replace(/\s+/g, " ").trim();

      // identical query already ran in this conversation → instant cached result
      const cached = sqlCache.current.get(cacheKey);
      if (cached) {
        addToolOutput({ tool: "run_sql", toolCallId: toolCall.toolCallId, output: cached });
        return;
      }

      // one execution per turn — nudge the model to answer from existing results
      if (ranSqlCount.current >= 1) {
        addToolOutput({
          tool: "run_sql",
          toolCallId: toolCall.toolCallId,
          output: JSON.stringify({ note: "you already have this query's result — answer the user now without calling tools again" }),
        });
        return;
      }

      setExecutingTool(toolCall.toolCallId);
      try {
        if (ranSqlCount.current >= 3) {
          addToolOutput({
            tool: "run_sql",
            toolCallId: toolCall.toolCallId,
            output: JSON.stringify({ error: "3 SQL attempts failed. Stop calling run_sql and answer the user from the dataset summary, or say what data you need." }),
          });
          return;
        }
        const out = await runSql(input.sql ?? "");
        const output = JSON.stringify(out);
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
    if (!data) {
      setMessages((m) => [...m, sysNote("dataset still loading — try again in a moment")]);
      return;
    }

    let sqlAvailable = isLoaded(data);
    if (!sqlAvailable && sqlStatus !== "error") {
      setSqlStatus("loading");
      void loadArtifact(data)
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

    // resolve mentioned contributors to exact emails (kills name-guessing):
    // tokenize the question and match words against names/emails in both directions
    const words = text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
    const matches = Object.entries(data.owners)
      .filter(([email, name]) => {
        const n = name.toLowerCase();
        const e = email.toLowerCase();
        return words.some((w) => n.includes(w) || e.includes(w));
      })
      .map(([email, name]) => `- ${name} <${email}>`);
    const matchLine = matches.length
      ? `CONTRIBUTOR MATCHES (use these exact owner emails):\n${matches.join("\n")}\n\n`
      : "";

    const viewing = viewingContext(location.pathname, location.search as Record<string, unknown>);
    const prefix = [viewing, matchLine].filter(Boolean).join("\n\n");
    sendMessage({ text: prefix ? `${prefix}\n\n${text}` : text });
  };

  const sqlReady = data && sqlStatus === "ready";
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
        <Eyebrow n="04">ask ai</Eyebrow>

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
              {sqlReady && data ? ` · ${fmtN(data.files.length)} rows` : ""}
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

        {showSettings && (
          <AskSettings settings={settings} onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))} />
        )}

        {/* messages */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-[#262626] bg-[#0a0a0a]/40 p-4">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <p className="font-mono text-xs text-[#666]">
                ask anything — the AI answers from real SQL over {data ? fmtN(data.files.length) : "…"} rows
              </p>
              <p className="max-w-md font-mono text-[10px] leading-5 text-[#404040]">
                "how many landscape shots from bilal in august?" · "top 5 days by uploads" · "which contributor has the most duplicates?"
              </p>
            </div>
          )}
          <div className="space-y-4">
            {messages.map((m) => (
              <MsgView key={m.id} m={m} executingTool={executingTool} openTool={openTool} setOpenTool={setOpenTool} />
            ))}
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

function MsgView({
  m,
  executingTool,
  openTool,
  setOpenTool,
}: {
  m: UIMessage;
  executingTool: string | null;
  openTool: string | null;
  setOpenTool: (id: string | null) => void;
}) {
  if (m.role === "system") {
    const text = m.parts.find((p) => p.type === "text");
    return (
      <div className="flex items-center gap-3 py-1">
        <span className="h-px flex-1 bg-[#262626]/60" />
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#666]">
          {text && partText(text) ? partText(text) : ""}
        </span>
        <span className="h-px flex-1 bg-[#262626]/60" />
      </div>
    );
  }

  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg border border-[#262626] bg-[#141414] px-3.5 py-2.5">
          {m.parts.map((part, i) =>
            part.type === "text" ? (
              <p key={i} className="whitespace-pre-wrap font-mono text-xs leading-5 text-[#ededed]">{part.text}</p>
            ) : null,
          )}
        </div>
      </div>
    );
  }

  // assistant — typed tool parts (live SQL via input-streaming state)
  return (
    <div className="max-w-[92%]">
      <div className="space-y-2 text-sm leading-6 text-[#ededed]">
        {m.parts.map((part, i) => {
          const prev = i > 0 ? (m.parts[i - 1] as { type?: string; input?: { sql?: string }; state?: string }) : null;
          if (part.type.startsWith("tool-") && prev?.type?.startsWith("tool-") && p_sql(part) && p_sql(part) === p_sql(prev)) {
            return null; // duplicate consecutive identical call — hide
          }
          if (part.type === "text") {
            return <div key={i} className="space-y-2">{renderContent(part.text)}</div>;
          }
          if (part.type.startsWith("tool-")) {
            const toolName = part.type.replace("tool-", "");
            const p = part as {
              state?: string;
              input?: { sql?: string };
              output?: string;
              errorText?: string;
            };
            const running = p.state === "input-streaming" || p.state === "input-available";
            const hasOutput = p.state === "output-available";
            const isErr = p.state === "output-error";
            return (
              <div key={i}>
                <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[9px] ${
                  isErr ? "border-danger/40 text-danger" : running ? "border-accent/40 text-accent" : "border-[#262626] text-[#666]"
                }`}>
                  {running && <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-accent" />}
                  {running ? `running ${toolName}…` : hasOutput ? `ran ${toolName}` : `${toolName} · ${p.state ?? ""}`}
                </span>
                {p.input?.sql && (
                  <details className="mt-1" open={p.state === "input-streaming"}>
                    <summary className="cursor-pointer font-mono text-[9px] text-[#666] hover:text-[#a1a1a1]">show SQL</summary>
                    <pre className="mt-1 overflow-x-auto rounded-md border border-[#262626] bg-[#050505] p-2 font-mono text-[10px] text-[#a1a1a1]">{p.input.sql}</pre>
                  </details>
                )}
                {hasOutput && p.output && <ResultTable output={p.output} />}
                {isErr && p.errorText && (
                  <p className="mt-1 font-mono text-[9px] text-danger">{p.errorText.slice(0, 200)}</p>
                )}
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

function partText(p: { type: string; text?: string }): string {
  return p.text ?? "";
}

function p_sql(part: unknown): string {
  return (part as { input?: { sql?: string } }).input?.sql ?? "";
}

/** fenced-code-aware plain renderer (no markdown dep) */
function renderContent(content: string) {
  const parts = content.split(/```(?:\w+)?\n?/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <pre key={i} className="overflow-x-auto rounded-md border border-[#262626] bg-[#050505] p-3 font-mono text-[11px] leading-4 text-[#a1a1a1]">
        {part.replace(/\n$/, "")}
      </pre>
    ) : (
      <p key={i} className="whitespace-pre-wrap">{part}</p>
    ),
  );
}

/** Parses the tool output JSON string and renders the result table. */
function ResultTable({ output }: { output: string }) {
  let parsed: SqlResult | { error: string } | null = null;
  try {
    parsed = JSON.parse(output) as SqlResult | { error: string };
  } catch {
    parsed = null;
  }
  if (!parsed || !("columns" in parsed) || !Array.isArray(parsed.rows)) {
    if (parsed && "error" in parsed) {
      return <p className="font-mono text-[10px] text-danger">{parsed.error}</p>;
    }
    return null;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse font-mono text-[10px]">
        <thead>
          <tr>
            {parsed.columns.map((c) => (
              <th key={c} className="border-b border-[#262626] px-2 py-1 text-left uppercase tracking-wider text-[#666]">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {parsed.rows.slice(0, 12).map((row, i) => (
            <tr key={i}>
              {parsed.columns.map((c) => (
                <td key={c} className="border-b border-[#262626]/40 px-2 py-1 tabular-nums text-[#ededed]">
                  {row[c] == null ? "—" : String(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {parsed.rows.length > 12 && (
        <p className="mt-1 font-mono text-[9px] text-[#666]">+{parsed.rows.length - 12} more rows</p>
      )}
    </div>
  );
}
