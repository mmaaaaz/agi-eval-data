import type { UIMessage } from "ai";
import type { SqlResult } from "../../lib/duck";
import { normSql } from "@shared/text";

export function MsgView({
  m,
  shownSql,
  executingTool,
  openTool,
  setOpenTool,
}: {
  m: UIMessage;
  /** SQL results already rendered anywhere in this conversation (cross-message dedupe) */
  shownSql: Set<string>;
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
            // a repeated identical call adds no information — show first run only
            if (hasOutput && p.input?.sql && shownSql.has(normSql(p.input.sql))) return null;
            if (hasOutput && p.input?.sql) shownSql.add(normSql(p.input.sql));
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

