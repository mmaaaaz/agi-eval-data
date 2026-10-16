import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ThumbImage } from "./ThumbImage";
import { useData } from "./dataContext";
import { getActor, questionsApi } from "./questions";
import type { AskSettings } from "./settings";
import type { Row } from "./data";

/** The nominated board's data: selections rows as the API returns them. */
interface SelRow {
  file_id: string;
  state: string;
  actor_id?: string;
  actor_name?: string;
  promoted_by?: string | null;
}
interface VoteRow {
  file_id: string;
  actor_id: string;
  actor_name: string;
  created_at: string;
}

export interface NominationSite {
  loadSettings: () => AskSettings;
}

/** Two distinct votes promote a nomination; retracting below two undoes it.
 *  The threshold lives here for display only — the API is the enforcement. */
const THRESHOLD = 2;

/**
 * The Nominated tab. A `maybe` is one person's opinion; this board is where the
 * community agrees or disagrees. Two votes from people other than the nominator
 * move the image to Selected, and retracting a vote below two moves it back —
 * the API records promoted_by, so that reversal can only ever undo what votes
 * did, never a human's own pick.
 */
export function NominationBoard({ site }: { site: NominationSite }) {
  const { data } = useData();
  const [settings] = useState<AskSettings>(() => site.loadSettings());
  const [sels, setSels] = useState<Record<string, SelRow>>({});
  const [votes, setVotes] = useState<VoteRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const me = useMemo(() => getActor().id, []);
  const relay = settings.relay.replace(/\/+$/, "");
  const code = settings.accessCode;

  const load = useCallback(async () => {
    setError("");
    try {
      const [s, v] = await Promise.all([
        questionsApi.selections(relay, undefined, 20000),
        questionsApi.votes(relay),
      ]);
      const map: Record<string, SelRow> = {};
      for (const row of s.selections as unknown as SelRow[]) map[row.file_id] = row;
      setSels(map);
      setVotes(v.votes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, [relay]);

  useEffect(() => {
    void load();
  }, [load]);

  const votesByFile = useMemo(() => {
    const m = new Map<string, VoteRow[]>();
    for (const v of votes) {
      const list = m.get(v.file_id) ?? [];
      list.push(v);
      m.set(v.file_id, list);
    }
    return m;
  }, [votes]);

  /* nominated + the vote-promoted ones (visible so a vote can be retracted) */
  const board = useMemo(() => {
    const byId = new Map((data?.files ?? []).map((r) => [r[0], r]));
    return Object.values(sels)
      .filter((s) => s.state === "nominated" || (s.state === "chosen" && s.promoted_by === "votes"))
      .map((s) => ({ sel: s, row: byId.get(s.file_id) as Row | undefined, votes: votesByFile.get(s.file_id) ?? [] }))
      .sort((a, b) => (a.row?.[1] ?? a.sel.file_id).localeCompare(b.row?.[1] ?? b.sel.file_id));
  }, [sels, data, votesByFile]);

  const toggle = useCallback(
    async (fileId: string, mine: boolean) => {
      if (busy.has(fileId)) return;
      setBusy((s) => new Set(s).add(fileId));
      try {
        const r = mine
          ? await questionsApi.unvote(relay, code, fileId)
          : await questionsApi.vote(relay, code, fileId);
        if (!mine && Number(r.votes ?? 0) >= THRESHOLD) toast.success("two votes — moved to Selected");
        else if (mine && r.state === "nominated") toast("vote retracted — back to Nominated");
        else if (!mine) toast.success(`vote recorded (${r.votes}/${THRESHOLD})`);
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy((s) => {
          const c = new Set(s);
          c.delete(fileId);
          return c;
        });
      }
    },
    [busy, relay, code, load],
  );

  if (!loaded) {
    return <p className="font-mono text-[11px] text-[#666]">loading nominations…</p>;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Nominated
            <span className="ml-3 font-mono text-sm font-normal tabular-nums text-[#666]">
              {board.length} {board.length === 1 ? "image" : "images"}
            </span>
          </h1>
          <p className="mt-1 font-mono text-[11px] text-[#666]">
            two votes from different people move an image to Selected · you can't vote for your own
            nomination · retract your vote to reverse it
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="rounded-md border border-[#262626] px-3 py-1.5 font-mono text-[11px] text-[#a1a1a1] transition-colors hover:border-[#404040] hover:text-white"
        >
          refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-danger/40 p-4 font-mono text-[11px] text-danger">
          {error}
        </div>
      )}

      {board.length === 0 && !error && (
        <p className="rounded-lg border border-[#262626] bg-[#0a0a0a]/60 p-6 font-mono text-[11px] text-[#a1a1a1]">
          Nothing is nominated right now — flag images with{" "}
          <span className="text-[#ededed]">~ maybe</span> in the{" "}
          <a href="/contribute" className="text-accent underline decoration-dotted hover:no-underline">
            Select tab
          </a>
          {" "}and they appear here for votes.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {board.map(({ sel, row, votes: vs }) => {
          const mine = vs.some((v) => v.actor_id === me);
          const iAmNominator = !!sel.actor_id && sel.actor_id === me;
          const promoted = sel.state === "chosen";
          const isBusy = busy.has(sel.file_id);
          return (
            <div key={sel.file_id} className="rounded-lg border border-[#262626] bg-[#0a0a0a]/40 p-2">
              {row ? (
                <ThumbImage
                  fileId={row[0]}
                  alt={row[1]}
                  className="h-36 w-full rounded-md border border-[#262626]"
                />
              ) : (
                <div className="flex h-36 items-center justify-center rounded-md border border-[#262626] bg-[#0a0a0a] px-2 text-center font-mono text-[9px] text-[#555]">
                  not in this ledger snapshot
                </div>
              )}
              <p className="mt-1.5 truncate font-mono text-[10px] text-[#a1a1a1]" title={row?.[1]}>
                {row?.[1] ?? sel.file_id}
              </p>
              <p className="truncate font-mono text-[9px] text-[#555]" title={sel.actor_id}>
                nominated by {sel.actor_name || sel.actor_id || "someone"}
              </p>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span
                  className={`font-mono text-[10px] tabular-nums ${promoted ? "text-[#0cce6b]" : "text-[#a1a1a1]"}`}
                >
                  {vs.length}/{THRESHOLD} {vs.length === 1 ? "vote" : "votes"}
                </span>
                {promoted ? (
                  mine ? (
                    <button
                      onClick={() => void toggle(sel.file_id, true)}
                      disabled={isBusy}
                      className="rounded border border-[#262626] px-2 py-1 font-mono text-[9px] text-[#a1a1a1] transition-colors hover:border-danger hover:text-danger disabled:opacity-30"
                      title="retract your vote — below two votes this returns to Nominated"
                    >
                      ↩ retract
                    </button>
                  ) : (
                    <span className="font-mono text-[9px] text-[#555]">✓ promoted</span>
                  )
                ) : iAmNominator ? (
                  <span className="font-mono text-[9px] text-[#555]" title="somebody else has to vote for it">
                    yours
                  </span>
                ) : (
                  <button
                    onClick={() => void toggle(sel.file_id, mine)}
                    disabled={isBusy}
                    className={`rounded border px-2 py-1 font-mono text-[9px] transition-colors disabled:opacity-30 ${
                      mine
                        ? "border-accent/60 text-accent hover:border-danger hover:text-danger"
                        : "border-[#0cce6b]/60 text-[#0cce6b] hover:bg-[#0cce6b] hover:text-black"
                    }`}
                    title={mine ? "retract your vote" : "upvote — two votes move it to Selected"}
                  >
                    {mine ? "✓ voted · retract" : "▲ upvote"}
                  </button>
                )}
              </div>
              {vs.length > 0 && (
                <p className="mt-1 truncate font-mono text-[9px] text-[#555]" title={vs.map((v) => v.actor_name || v.actor_id).join(", ")}>
                  voted: {vs.map((v) => v.actor_name || v.actor_id).join(", ")}
                </p>
              )}
              {promoted && (
                <p className="mt-1 font-mono text-[9px] text-[#0cce6b]">
                  ✓ selected by votes — retract to undo
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
