import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import { useData } from "../lib/dataContext";
import { datasetBrief, viewingContext } from "../lib/brief";
import { loadArtifact, isLoaded, runSql, type SqlResult } from "../lib/duck";
import { streamPooled, streamChat, type ChatMessage } from "../lib/ai/stream";
import { loadSettings, saveSettings, type AskSettings } from "../lib/ai/settings";
import { AskSettings as AskSettingsPanel } from "../components/AskSettings";
import { Eyebrow } from "../components/Section";
import { fmtN } from "../lib/format";

export const Route = createFileRoute("/ask")({ component: Ask });

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

interface UiMsg {
  id: string;
  role: "user" | "assistant" | "tool" | "note";
  content: string;
  toolCalls?: { id: string; name: string; args: string }[];
  toolResults?: Record<string, SqlResult | { error: string }>;
  toolCallId?: string;
}

let uid = 0;
const nextId = () => `m${++uid}`;

function Ask() {
  const { data } = useData();
  const location = useLocation();

  const [settings, setSettings] = useState<AskSettings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [pooledModel, setPooledModel] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [sqlStatus, setSqlStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [sqlError, setSqlError] = useState("");
  const [openTool, setOpenTool] = useState<string | null>(null);
  const [executingSql, setExecutingSql] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => saveSettings(settings), [settings]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // pooled model name for the chip
  useEffect(() => {
    const relay = settings.relay || "http://localhost:8787";
    fetch(`${relay.replace(/\/+$/, "")}/api/info`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.model && setPooledModel(j.model))
      .catch(() => {});
  }, [settings.relay]);

  // load artifact into DuckDB as soon as data exists
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

  /* ---------------- chat ---------------- */

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || streaming) return;
    if (!data) {
      setMessages((m) => [...m, { id: nextId(), role: "note", content: "dataset still loading — try again in a moment" }]);
      return;
    }

    const useByok = settings.byokEnabled && settings.byokBase && settings.byokKey && settings.byokModel;
    if (!useByok && !settings.relay) {
      setMessages((m) => [...m, { id: nextId(), role: "note", content: "no relay URL configured — set it in providers" }]);
      return;
    }

    // SQL engine is OPTIONAL: on failure we still chat from the brief
    let sqlAvailable = isLoaded(data);
    if (!sqlAvailable && sqlStatus !== "error") {
      setSqlStatus("loading");
      try {
        await loadArtifact(data);
        sqlAvailable = true;
        setSqlStatus("ready");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setSqlStatus("error");
        setSqlError(msg);
        console.error("[duckdb]", msg);
        setMessages((m) => [
          ...m,
          { id: nextId(), role: "note", content: `sql engine unavailable (${msg}) — answering from the dataset summary only` },
        ]);
      }
    }

    const userMsg: UiMsg = {
      id: nextId(),
      role: "user",
      content: `${viewingContext(location.pathname, location.search as Record<string, unknown>)}\n\n${text}`,
    };
    const baseMsgs = [...messages, userMsg];
    setMessages(baseMsgs);
    setInput("");
    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const toWire = (msgs: UiMsg[]): ChatMessage[] =>
        msgs
          .filter((m): m is UiMsg & { role: "user" | "assistant" | "tool" } => m.role !== "note")
          .map((m) => ({ role: m.role, content: m.content, toolCalls: m.toolCalls, toolCallId: m.toolCallId }));

      // keep context healthy: recent turns only (the brief carries the facts)
      let convo = toWire(baseMsgs.slice(-16));

      for (let iter = 0; iter < 5; iter++) {
        const assistantId = nextId();
        setMessages((m) => [...m, { id: assistantId, role: "assistant", content: "" }]);

        const system = datasetBrief(data);
        const result = useByok
          ? await streamChat({
              protocol: settings.byokProtocol,
              base: settings.byokBase,
              key: settings.byokKey,
              model: settings.byokModel,
              system,
              messages: convo,
              tools: sqlAvailable ? [SQL_TOOL] : undefined,
              signal: ctrl.signal,
              onDelta: (t) =>
                setMessages((m) =>
                  m.map((x) => (x.id === assistantId ? { ...x, content: x.content + t } : x)),
                ),
            })
          : await streamPooled({
              relay: settings.relay,
              accessCode: settings.accessCode || undefined,
              system,
              messages: convo,
              tools: sqlAvailable ? [SQL_TOOL] : undefined,
              signal: ctrl.signal,
              onDelta: (t) =>
                setMessages((m) =>
                  m.map((x) => (x.id === assistantId ? { ...x, content: x.content + t } : x)),
                ),
            });

        if (!result.toolCalls.length) break;

        const toolMsgs: UiMsg[] = [];
        const toolResults: Record<string, SqlResult | { error: string }> = {};
        for (const tc of result.toolCalls) {
          let args: { sql?: string } = {};
          try {
            args = JSON.parse(tc.args || "{}");
          } catch { /* fall through */ }
          setExecutingSql(tc.id);
          const out = sqlAvailable
            ? args.sql
              ? await runSql(args.sql)
              : { error: "missing sql argument" }
            : { error: "sql engine unavailable in this session" };
          toolResults[tc.id] = out as SqlResult | { error: string };
          toolMsgs.push({
            id: nextId(),
            role: "tool",
            content: JSON.stringify(out).slice(0, 8000),
            toolCallId: tc.id,
            toolResults: { [tc.id]: out as SqlResult | { error: string } },
          });
        }
        setMessages((m) =>
          m.map((x) => (x.id === assistantId ? { ...x, toolCalls: result.toolCalls, toolResults } : x)),
        );
        convo = [...convo, ...toWire([
          { id: assistantId, role: "assistant", content: result.text, toolCalls: result.toolCalls },
          ...toolMsgs,
        ])];
        setMessages((m) => [...m, ...toolMsgs]);
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setMessages((m) => [
          ...m,
          { id: nextId(), role: "assistant", content: `⚠ ${e instanceof Error ? e.message : String(e)}` },
        ]);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const sqlReady = data && sqlStatus === "ready";
  const usingByok = settings.byokEnabled;

  return (
    <div className="flex h-[calc(100dvh-11rem)] min-h-[440px] flex-col lg:h-[calc(100dvh-9rem)]">
      <Eyebrow n="04">ask ai</Eyebrow>
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
            {pooledModel && !usingByok ? pooledModel : usingByok ? settings.byokModel || "byok" : "pooled"}
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
        <AskSettingsPanel settings={settings} onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))} />
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
            <MsgView key={m.id} m={m} executingSql={executingSql} openTool={openTool} setOpenTool={setOpenTool} />
          ))}
          {streaming && (
            <div className="flex items-center gap-2 font-mono text-[10px] text-[#666]">
              <span className="h-[6px] w-[6px] animate-pulse rounded-full bg-accent" />
              {executingSql ? "running query…" : "thinking…"}
            </div>
          )}
        </div>
      </div>

      {/* composer */}
      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={1}
          placeholder={streaming ? "streaming…" : "ask about the dataset… (Enter to send, Shift+Enter newline)"}
          className="max-h-40 min-h-[42px] flex-1 resize-y rounded-lg border border-[#262626] bg-[#0a0a0a] px-3.5 py-2.5 font-mono text-xs text-[#ededed] outline-none transition-colors placeholder:text-[#666] focus:border-accent"
        />
        {streaming ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="h-[42px] rounded-lg border border-danger/50 px-4 font-mono text-xs text-danger transition-colors hover:bg-danger/10"
          >
            stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="h-[42px] rounded-lg bg-white px-4 font-mono text-xs font-semibold text-black transition-opacity disabled:opacity-30"
          >
            send
          </button>
        )}
      </form>
    </div>
  );
}

/* ---------------- message rendering ---------------- */

function MsgView({
  m,
  executingSql,
  openTool,
  setOpenTool,
}: {
  m: UiMsg;
  executingSql: string | null;
  openTool: string | null;
  setOpenTool: (id: string | null) => void;
}) {
  if (m.role === "note") {
    return (
      <div className="flex items-center gap-3 py-1">
        <span className="h-px flex-1 bg-[#262626]/60" />
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#666]">{m.content}</span>
        <span className="h-px flex-1 bg-[#262626]/60" />
      </div>
    );
  }

  if (m.role === "user") {
    const [ctx, ...rest] = m.content.split("\n\n");
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg border border-[#262626] bg-[#141414] px-3.5 py-2.5">
          {ctx.startsWith("VIEWING:") && <p className="mb-1 font-mono text-[9px] text-[#666]">{ctx}</p>}
          <p className="whitespace-pre-wrap font-mono text-xs leading-5 text-[#ededed]">{rest.join("\n\n") || ctx}</p>
        </div>
      </div>
    );
  }

  if (m.role === "tool") {
    const result = m.toolResults?.[m.toolCallId ?? ""];
    const isOpen = openTool === m.toolCallId;
    const isError = result && "error" in result;
    const rows = result && "rows" in result ? result.rowCount : 0;
    return (
      <div>
        <button
          onClick={() => setOpenTool(isOpen ? null : m.toolCallId ?? null)}
          className={`rounded border px-2 py-1 font-mono text-[10px] transition-colors ${
            isError ? "border-danger/40 text-danger" : "border-accent/40 text-accent hover:bg-accent hover:text-white"
          }`}
        >
          {isError ? "sql error ✕" : `run_sql · ${fmtN(rows)} rows`} {isOpen ? "▴" : "▾"}
        </button>
        {isOpen && result && (
          <div className="mt-2 rounded-lg border border-[#262626] bg-[#050505] p-3">
            {"sql" in result && (
              <pre className="mb-2 overflow-x-auto font-mono text-[10px] leading-4 text-[#a1a1a1]">{result.sql}</pre>
            )}
            {"error" in result ? (
              <p className="font-mono text-[10px] text-danger">{result.error}</p>
            ) : (
              <ResultTable result={result} />
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-[92%]">
      <div className="space-y-2 text-sm leading-6 text-[#ededed]">{renderContent(m.content)}</div>
      {m.toolCalls?.map((tc) => {
        const result = m.toolResults?.[tc.id];
        const isErr = result && "error" in result;
        const running = !result || executingSql === tc.id;
        return (
          <div key={tc.id} className="mt-2">
            <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[9px] ${
              isErr ? "border-danger/40 text-danger" : "border-accent/40 text-accent"
            }`}>
              {running && <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-accent" />}
              {running ? `running ${tc.name}…` : `ran ${tc.name}`}
            </span>
          </div>
        );
      })}
    </div>
  );
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

function ResultTable({ result }: { result: SqlResult }) {
  const shown = result.rows.slice(0, 12);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse font-mono text-[10px]">
        <thead>
          <tr>
            {result.columns.map((c) => (
              <th key={c} className="border-b border-[#262626] px-2 py-1 text-left uppercase tracking-wider text-[#666]">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, i) => (
            <tr key={i}>
              {result.columns.map((c) => (
                <td key={c} className="border-b border-[#262626]/40 px-2 py-1 tabular-nums text-[#ededed]">
                  {row[c] == null ? "—" : String(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.rows.length > shown.length && (
        <p className="mt-1 font-mono text-[9px] text-[#666]">+{result.rows.length - shown.length} more rows</p>
      )}
    </div>
  );
}
