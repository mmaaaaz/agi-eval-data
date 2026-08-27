import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Skeleton, Sheet, SheetContent, SheetTitle } from "./ui";
import { VirtualGallery } from "./VirtualGallery";
import { ThumbImage } from "./ThumbImage";
import { fmtB, fmtN } from "./format";
import { useData } from "./dataContext";
import type { AskSettings } from "./settings";
import { questionsApi, normQ, normTags as parseTags, type QRow } from "./questions";
import type { Row, Latest } from "./data";

export type Sort = "needs" | "recent" | "name";

export interface AuthorSite {
  /** grid count label, e.g. "images" or "maps" */
  imageLabel: string;
  /** contributor string sent with each question ("" for web, "metro" for metro) */
  contributor: string;
  searchPlaceholder: string;
  /** extra per-row search/caption text (e.g. countryOf(r)) */
  searchText?: (row: Row) => string;
  /** extra tag chips for the authoring sheet (e.g. [branchOf(r), countryOf(r)]) */
  tagChips?: (row: Row) => string[];
  /** where the "N marked →" button navigates */
  navigateMarkedTo: string;
  questionPlaceholder: string;
  /** placeholder for the ground-truth answer input per answer type */
  answerPlaceholderMap: Record<string, string>;
  /** label for the existing-questions list */
  existingWording: string;
  /** relay + access code loader (site-specific localStorage key) */
  loadSettings: () => AskSettings;
  	/** owner display name for the sheet subtitle (resolved from the dataset) */
	ownerName?: (latest: Latest, email: string) => string;
  /** title for the sheet header (e.g. cityName(row) || row[1]) */
  titleFor?: (row: Row) => string;
}

/** The /contribute authoring queue: images → per-image question authoring. */
export function AuthorQuestions({ site }: { site: AuthorSite }) {
  const { data } = useData();
  const navigate = useNavigate();
  const [settings] = useState(site.loadSettings);
  const relay = settings.relay.replace(/\/+$/, "");
  const code = settings.accessCode;

  const [counts, setCounts] = useState<Record<string, number>>({});
  const [countsLoaded, setCountsLoaded] = useState(false);
  const [apiError, setApiError] = useState("");
  const [excluded, setExcluded] = useState<{ file_id: string; reason: string }[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("needs");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [existing, setExisting] = useState<QRow[]>([]);

  /* form */
  const [question, setQuestion] = useState("");
  const [answerType, setAnswerType] = useState("number");
  const [answer, setAnswer] = useState("");
  const [choices, setChoices] = useState<string[]>(["", ""]);
  const [difficulty, setDifficulty] = useState("medium");
  const [tags, setTags] = useState("");
  const [allTags, setAllTags] = useState<[string, number][]>([]);
  const [dupeWarn, setDupeWarn] = useState<{ id: number; question: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [markReason, setMarkReason] = useState("");

  const excludedSet = useMemo(() => new Set(excluded.map((x) => x.file_id)), [excluded]);

  const refreshCounts = useCallback(() => {
    questionsApi.counts(relay, code)
      .then((r) => { setCounts(r.counts); setCountsLoaded(true); })
      .catch((e) => { setCountsLoaded(true); setApiError(e instanceof Error ? e.message : String(e)); });
  }, [relay, code]);

  const refreshExcluded = useCallback(() => {
    questionsApi.excluded(relay, code).then((r) => setExcluded(r.excluded)).catch(() => {});
  }, [relay, code]);

  useEffect(() => {
    refreshCounts();
    refreshExcluded();
    questionsApi.tags(relay, code).then((r) => setAllTags(r.tags)).catch(() => {});
  }, [refreshCounts, refreshExcluded, relay, code]);

  /* grid rows: images, not excluded, sorted */
  const rows = useMemo(() => {
    if (!data || !countsLoaded) return [];
    const s = search.trim().toLowerCase();
    const items = data.files
      .filter((r) => r[7] === "i" && !excludedSet.has(r[0]))
      .filter((r) => !s || r[1].toLowerCase().includes(s) || (site.searchText?.(r) ?? "").toLowerCase().includes(s));
    const cmp: Record<Sort, (a: (typeof items)[0], b: (typeof items)[0]) => number> = {
      needs: (a, b) => (counts[a[0]] ?? 0) - (counts[b[0]] ?? 0) || b[4].localeCompare(a[4]),
      recent: (a, b) => b[4].localeCompare(a[4]),
      name: (a, b) => a[1].localeCompare(b[1]),
    };
    return items.sort(cmp[sort]);
  }, [data, search, counts, countsLoaded, excludedSet, sort, site.searchText]);

  const selected = useMemo(
    () => (data && selectedId ? data.files.find((r) => r[0] === selectedId) ?? null : null),
    [data, selectedId],
  );
  const selectedCount = selectedId ? counts[selectedId] ?? 0 : 0;

  const loadExisting = useCallback((fileId: string) => {
    questionsApi.list(relay, code, { file_id: fileId })
      .then((r) => setExisting(r.questions))
      .catch(() => setExisting([]));
  }, [relay, code]);

  useEffect(() => {
    if (selectedId) loadExisting(selectedId);
    else setExisting([]);
  }, [selectedId, loadExisting]);

  /* live duplicate check (debounced) */
  useEffect(() => {
    if (!selectedId || normQ(question).length < 4) { setDupeWarn([]); return; }
    const t = window.setTimeout(() => {
      questionsApi.check(relay, code, selectedId, question)
        .then((r) => setDupeWarn(r.matches))
        .catch(() => setDupeWarn([]));
    }, 400);
    return () => window.clearTimeout(t);
  }, [question, selectedId, relay, code]);

  const tagSuggestions = useMemo(() => {
    const segs = tags.split(",");
    const last = (segs[segs.length - 1] ?? "").trim().toLowerCase();
    if (last.length < 2) return [];
    return allTags
      .filter(([t]) => t.startsWith(last) && !parseTags(tags).includes(t))
      .slice(0, 6);
  }, [tags, allTags]);

  const submit = async () => {
    if (!selectedId || !question.trim()) return;
    if (dupeWarn.some((m) => normQ(m.question) === normQ(question))) {
      toast.error("identical question already exists for this image");
      return;
    }
    setBusy(true);
    try {
      await questionsApi.add(relay, code, {
        file_id: selectedId,
        contributor: site.contributor,
        question: question.trim(),
        answer_type: answerType,
        answer: answer.trim(),
        choices: answerType === "choice" ? JSON.stringify(choices.map((c) => c.trim()).filter(Boolean)) : "",
        difficulty,
        tags,
      });
      setQuestion(""); setAnswer(""); setChoices(["", ""]); setDupeWarn([]);
      toast.success(`saved — ${selectedCount + 1} question${selectedCount ? "s" : ""} on this ${site.imageLabel === "maps" ? "map" : "image"} now`);
      loadExisting(selectedId);
      refreshCounts();
      questionsApi.tags(relay, code).then((r) => setAllTags(r.tags)).catch(() => {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const removeQuestion = async (id: number) => {
    try {
      await questionsApi.remove(relay, code, id);
      if (selectedId) loadExisting(selectedId);
      refreshCounts();
      toast.success("question deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const markExcluded = async (fileId: string) => {
    try {
      await questionsApi.exclude(relay, code, fileId, markReason.trim());
      toast.success("marked do-not-work");
      setSelectedId(null);
      refreshExcluded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  if (!data) return null;
  if (!relay) {
    return (
      <p className="py-16 text-center font-mono text-xs text-muted-foreground">
        set the relay URL in settings first
      </p>
    );
  }

  const badgeFor = (row: (typeof rows)[0]) => {
    const n = counts[row[0]] ?? 0;
    if (n === 0) return null;
    return (
      <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] tabular-nums ${
        n >= 5 ? "border border-[#0cce6b]/40 text-[#0cce6b]" : "border border-[#262626] text-[#a1a1a1]"
      }`}>
        {n}/5
      </span>
    );
  };

  const chips = selected ? (site.tagChips?.(selected) ?? []) : [];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Author questions
          <span className="ml-3 font-mono text-sm font-normal tabular-nums text-[#666]">
            {fmtN(rows.length)} {site.imageLabel}
          </span>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={site.searchPlaceholder}
            className="w-48 rounded-md border border-[#262626] bg-[#0a0a0a] px-3 py-1.5 font-mono text-xs text-[#ededed] outline-none transition-colors placeholder:text-muted-foreground focus:border-accent"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="rounded-md border border-[#262626] bg-[#0a0a0a] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-accent"
          >
            <option value="needs">needs questions first</option>
            <option value="recent">recent first</option>
            <option value="name">name A–Z</option>
          </select>
          {excluded.length > 0 && (
            <button
              onClick={() => navigate({ to: site.navigateMarkedTo })}
              className="rounded-md border border-danger/40 px-2.5 py-1.5 font-mono text-[10px] text-danger transition-colors hover:bg-danger/10"
            >
              {excluded.length} marked →
            </button>
          )}
        </div>
      </div>

      {apiError && (
        <p className="mt-4 rounded-md border border-danger/40 bg-danger/5 p-2.5 font-mono text-[11px] text-danger">{apiError}</p>
      )}

      <div className="mt-5 flex h-[calc(100dvh-13rem)] min-h-[420px] flex-col">
        {!countsLoaded ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i}>
                <Skeleton className="aspect-[4/3] w-full rounded-md" />
                <Skeleton className="mt-1.5 h-3 w-3/4 rounded" />
              </div>
            ))}
          </div>
        ) : (
          <VirtualGallery rows={rows} dupSet={new Set()} onOpen={(i) => setSelectedId(rows[i][0])} badge={badgeFor} />
        )}
      </div>

      {/* authoring sheet */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto border-[#262626] bg-black p-0 sm:max-w-[560px]">
          {selected && (
            <div className="flex h-full flex-col">
              <div className="border-b border-[#262626] p-4">
                <SheetTitle className="truncate pr-8 font-mono text-xs text-white" title={selected[1]}>
                  {site.titleFor ? site.titleFor(selected) : selected[1]}
                </SheetTitle>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {site.ownerName ? `${site.ownerName(data, selected[5])} · ` : site.searchText ? `${site.searchText(selected)} · ` : ""}
                  {selected[4]} · {fmtB(selected[3])}
                </p>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <ThumbImage
                  fileId={selected[0]}
                  alt={selected[1]}
                  w={1600}
                  className="mb-4 h-56 w-full rounded-lg border border-[#262626]"
                />

                <div className="mb-4 flex items-center justify-between gap-2">
                  <span className="rounded border border-[#262626] px-2 py-0.5 font-mono text-[10px] tabular-nums text-[#a1a1a1]">
                    {selectedCount}/5 questions
                  </span>
                  {chips.length > 0 && (
                    <div className="flex min-w-0 items-center gap-1.5">
                      {chips.slice(0, 3).map((t) => (
                        <button
                          key={t}
                          onClick={() => setTags((prev) => {
                            if (parseTags(prev).includes(t.toLowerCase())) return prev;
                            return prev ? `${prev}, ${t}` : t;
                          })}
                          title={`add "${t}" tag`}
                          className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] transition-colors ${
                            parseTags(tags).includes(t.toLowerCase())
                              ? "border-accent/50 text-accent"
                              : "border-[#262626] text-[#666] hover:border-accent hover:text-accent"
                          }`}
                        >
                          + {t}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex min-w-0 items-center gap-2">
                    <input
                      value={markReason}
                      onChange={(e) => setMarkReason(e.target.value)}
                      placeholder="reason (optional)"
                      className="w-36 rounded-md border border-[#262626] bg-[#050505] px-2 py-1 font-mono text-[10px] text-[#ededed] outline-none focus:border-danger"
                    />
                    <button
                      onClick={() => markExcluded(selected[0])}
                      title="hide from the queue — for duplicates or images slated for removal"
                      className="shrink-0 font-mono text-[10px] text-danger hover:underline"
                    >
                      ⃠ do-not-work
                    </button>
                  </div>
                </div>

                {existing.length > 0 && (
                  <div className="mb-4 rounded-lg border border-[#262626] p-3">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{site.existingWording}</p>
                    <div className="mt-2 space-y-1.5">
                      {existing.map((q) => (
                        <div key={q.id} className="flex items-start gap-2">
                          <span className="min-w-0 flex-1 font-mono text-[11px] text-[#ededed]">
                            {q.question}
                            <span className="ml-2 text-[9px] text-muted-foreground">
                              {q.answer_type}{q.answer ? ` · ${q.answer}` : ""}{q.status === "draft" ? " · draft" : ""}
                            </span>
                          </span>
                          <button
                            onClick={() => removeQuestion(q.id)}
                            aria-label="Delete question"
                            className="shrink-0 font-mono text-[10px] text-muted-foreground transition-colors hover:text-danger"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <label className="block">
                    <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">question</span>
                    <textarea
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      rows={2}
                      placeholder={site.questionPlaceholder}
                      className="w-full resize-y rounded-md border border-[#262626] bg-[#050505] px-3 py-2 font-mono text-xs text-[#ededed] outline-none transition-colors placeholder:text-muted-foreground focus:border-accent"
                    />
                  </label>
                  {dupeWarn.length > 0 && (
                    <div className="rounded-md border border-danger/40 bg-danger/5 p-2.5">
                      <p className="font-mono text-[10px] text-danger">⚠ near-identical question exists:</p>
                      {dupeWarn.map((m) => (
                        <p key={m.id} className="mt-1 font-mono text-[10px] text-[#a1a1a1]">{m.question}</p>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">answer type</span>
                      <select
                        value={answerType}
                        onChange={(e) => setAnswerType(e.target.value)}
                        className="w-full rounded-md border border-[#262626] bg-[#050505] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-accent"
                      >
                        {["text", "number", "yesno", "choice"].map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">difficulty</span>
                      <select
                        value={difficulty}
                        onChange={(e) => setDifficulty(e.target.value)}
                        className="w-full rounded-md border border-[#262626] bg-[#050505] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-accent"
                      >
                        {["easy", "medium", "hard"].map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </label>
                  </div>

                  {answerType === "choice" && (
                    <div>
                      <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">options (min 2)</span>
                      <div className="space-y-1.5">
                        {choices.map((c, i) => (
                          <input
                            key={i}
                            value={c}
                            onChange={(e) => setChoices((cs) => cs.map((x, j) => (j === i ? e.target.value : x)))}
                            placeholder={`option ${i + 1}`}
                            className="w-full rounded-md border border-[#262626] bg-[#050505] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-accent"
                          />
                        ))}
                      </div>
                      <button
                        onClick={() => setChoices((cs) => [...cs, ""])}
                        className="mt-1.5 font-mono text-[10px] text-accent hover:underline"
                      >
                        + option
                      </button>
                    </div>
                  )}

                  <label className="block">
                    <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      ground-truth answer {answerType === "text" ? "(optional — saves as draft)" : "(required)"}
                    </span>
                    <input
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      placeholder={site.answerPlaceholderMap[answerType] ?? "the answer"}
                      className="w-full rounded-md border border-[#262626] bg-[#050505] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none transition-colors placeholder:text-muted-foreground focus:border-accent"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">tags (comma-separated)</span>
                    <input
                      value={tags}
                      onChange={(e) => setTags(e.target.value)}
                      placeholder="counting, indoor, perspective…"
                      className="w-full rounded-md border border-[#262626] bg-[#050505] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none transition-colors placeholder:text-muted-foreground focus:border-accent"
                    />
                    {tagSuggestions.length > 0 && (
                      <span className="mt-1.5 flex flex-wrap gap-1.5">
                        {tagSuggestions.map(([t, c]) => (
                          <button
                            key={t}
                            onClick={() => setTags((prev) => {
                              const current = parseTags(prev);
                              return current.includes(t.toLowerCase())
                                ? prev
                                : [...current, t].join(", ");
                            })}
                            className="rounded-full border border-[#262626] px-2 py-0.5 font-mono text-[9px] text-[#a1a1a1] transition-colors hover:border-accent hover:text-accent"
                          >
                            {t} · {fmtN(c)}
                          </button>
                        ))}
                      </span>
                    )}
                  </label>

                  <button
                    onClick={submit}
                    disabled={busy || !question.trim() || dupeWarn.some((m) => normQ(m.question) === normQ(question))}
                    className="w-full rounded-lg bg-white px-4 py-2.5 font-mono text-xs font-semibold text-black transition-opacity disabled:opacity-30"
                  >
                    {busy ? "saving…" : "submit question"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
