import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { Check, ChevronsUpDown } from "lucide-react";
import { Skeleton, Sheet, SheetContent, SheetTitle } from "./ui";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "./ui";
import { Popover, PopoverContent, PopoverTrigger } from "./ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui";
import { Badge } from "./ui";
import { cn } from "./lib/utils";
import { VirtualGallery } from "./VirtualGallery";
import { ThumbImage } from "./ThumbImage";
import { fmtN } from "./format";
import {
  questionsApi, runOpenRouter, fetchOpenRouterModels, familyOf,
  type QRow, type EvalRow, type Insights, type ORModel, type SiteMeta,
} from "./questions";
import type { AskSettings } from "./settings";
import { useData } from "./dataContext";

const VERDICTS = ["correct", "close", "wrong", "unanswered"] as const;

/** Unified sort set — 'recent' was dead/buggy in both apps; only most/fewest exist. */
export type Sort = "most" | "fewest";

export interface GradeSite {
  /** count label for the header, e.g. "images with questions" / "maps with questions" */
  countsWording: string;
  /** "question(s) on this image" / "… on this map" */
  onThisWording: (n: number) => string;
  /** relay + access code loader */
  loadSettings: () => AskSettings;
  /** OpenRouter identity for this site */
  orMeta: SiteMeta;
  /** accent color for the by-tag bar gradient, e.g. "from-[#155a9d]" / "from-[#0a5c40]" */
  tagBarFrom: string;
}

/** The /contribute/evaluate grading grid: images-with-questions → model runs. */
export function GradeModels({ site }: { site: GradeSite }) {
  const [settings] = useState(site.loadSettings);
  const relay = settings.relay.replace(/\/+$/, "");
  const code = settings.accessCode;

  const [tab, setTab] = useState<"grade" | "board">("grade");

  /* grid */
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [countsLoaded, setCountsLoaded] = useState(false);
  const [sort, setSort] = useState<Sort>("most");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QRow[]>([]);
  const [selected, setSelected] = useState<QRow | null>(null);
  const [evals, setEvals] = useState<EvalRow[]>([]);

  /* model + key */
  const [orModels, setOrModels] = useState<ORModel[]>([]);
  const [visionOnly, setVisionOnly] = useState(true);
  const [model, setModel] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const [orKey] = useState(() => localStorage.getItem("evaluate.openrouterKey") ?? "");

  /* response + grading */
  const [response, setResponse] = useState("");
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [insights, setInsights] = useState<Insights | null>(null);

  const refreshCounts = useCallback(() => {
    questionsApi.counts(relay, code)
      .then((r) => { setCounts(r.counts); setCountsLoaded(true); })
      .catch(() => setCountsLoaded(true));
  }, [relay, code]);

  useEffect(() => {
    refreshCounts();
    fetchOpenRouterModels()
      .then(setOrModels)
      .catch(() => {});
  }, [refreshCounts]);

  /* grid rows: images that HAVE questions */
  const rows = useMemo(() => {
    if (!countsLoaded) return [];
    const items = Object.entries(counts).map(([fileId, n]) => ({ fileId, n }));
    const cmp: Record<Sort, (a: (typeof items)[0], b: (typeof items)[0]) => number> = {
      most: (a, b) => b.n - a.n,
      fewest: (a, b) => a.n - b.n,
    };
    return items.sort(cmp[sort]).map((x) => x.fileId);
  }, [counts, countsLoaded, sort]);

  /* file rows for VirtualGallery (it expects Row[]) — synthesize minimal rows from the artifact */
  const { data } = useData();
  const gridRows = useMemo(() => {
    if (!data) return [];
    const byId = new Map(data.files.map((r) => [r[0], r] as const));
    return rows.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
  }, [rows, data]);

  const loadEvals = useCallback((questionId: number) => {
    questionsApi.evaluations(relay, code, { question_id: questionId })
      .then((r) => setEvals(r.evaluations))
      .catch(() => setEvals([]));
  }, [relay, code]);

  const loadQuestions = useCallback((fileId: string) => {
    questionsApi.list(relay, code, { file_id: fileId })
      .then((r) => {
        setQuestions(r.questions);
        setSelected(r.questions[0] ?? null);
        if (r.questions[0]) loadEvals(r.questions[0].id);
      })
      .catch(() => { setQuestions([]); setSelected(null); });
  }, [relay, code, loadEvals]);

  const saveEvaluation = async (verdict?: string, src: "openrouter" | "manual" = "manual") => {
    if (!selected || !model) return;
    setBusy(true);
    try {
      await questionsApi.saveEvaluation(relay, code, {
        question_id: selected.id,
        model,
        response,
        verdict,
        source: src,
        graded_by: "",
      });
      loadEvals(selected.id);
      if (verdict) toast.success(`graded ${verdict}`);
      else toast.success("response saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setRunning(false);
    }
  };

  const runModel = async () => {
    if (!selected || !model || !orKey) return;
    setRunning(true);
    setResponse("");
    try {
      const answer = await runOpenRouter(orKey, model, selected.file_id, selected.question, site.orMeta);
      setResponse(answer);
      await questionsApi.saveEvaluation(relay, code, {
        question_id: selected.id,
        model,
        response: answer,
        source: "openrouter",
      });
      loadEvals(selected.id);
      toast.success("response stored — grade it below");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const loadInsights = useCallback(() => {
    questionsApi.insights(relay, code)
      .then(setInsights)
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
  }, [relay, code]);

  useEffect(() => {
    if (tab === "board") loadInsights();
  }, [tab, loadInsights]);

  const modelOptions = useMemo(() => orModels.filter((m) => (visionOnly ? m.vision : true)).slice(0, 500), [orModels, visionOnly]);
  const existingForModel = evals.find((e) => e.model === model);
  const selectedRow = useMemo(
    () => (data && selectedId ? data.files.find((r) => r[0] === selectedId) ?? null : null),
    [data, selectedId],
  );

  const badgeFor = (row: (typeof gridRows)[0]) => (
    <span className="rounded border border-[#262626] px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-[#a1a1a1]">
      {counts[row[0]] ?? 0}q
    </span>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Grade models
          <span className="ml-3 font-mono text-sm font-normal tabular-nums text-[#666]">
            {countsLoaded ? `${fmtN(Object.keys(counts).length)} ${site.countsWording}` : "…"}
          </span>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="rounded-md border border-[#262626] bg-[#0a0a0a] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-accent"
          >
            <option value="most">most questions first</option>
            <option value="fewest">fewest questions first</option>
          </select>
          <div className="flex rounded-lg border border-[#262626] p-0.5">
            {(["grade", "board"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "rounded-md px-3 py-1 font-mono text-[11px] transition-colors",
                  tab === t ? "bg-white text-black" : "text-[#a1a1a1] hover:text-white",
                )}
              >
                {t === "grade" ? "grade" : "leaderboard"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === "grade" ? (
        <div className="mt-5 flex h-[calc(100dvh-13rem)] min-h-[420px] flex-col">
          {!countsLoaded ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i}>
                  <Skeleton className="aspect-[4/3] w-full rounded-md" />
                  <Skeleton className="mt-1.5 h-3 w-1/2 rounded" />
                </div>
              ))}
            </div>
          ) : gridRows.length === 0 ? (
            <p className="py-16 text-center font-mono text-xs text-muted-foreground">
              no questions yet — author some in the questions tab first
            </p>
          ) : (
            <VirtualGallery rows={gridRows} dupSet={new Set()} onOpen={(i) => { setSelectedId(gridRows[i][0]); loadQuestions(gridRows[i][0]); }} badge={badgeFor} />
          )}
        </div>
      ) : (
        /* leaderboard */
        <div className="mt-6 space-y-8">
          <section>
            <h2 className="mb-4 font-medium tracking-tight text-white">Leaderboard</h2>
            {!insights || insights.leaderboard.length === 0 ? (
              <p className="py-8 text-center font-mono text-xs text-muted-foreground">no graded evaluations yet</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-[#262626]">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>model</TableHead>
                      <TableHead className="text-right">graded</TableHead>
                      <TableHead className="text-right">correct</TableHead>
                      <TableHead className="text-right">close</TableHead>
                      <TableHead className="text-right">wrong</TableHead>
                      <TableHead className="text-right">accuracy</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {insights.leaderboard.map((row) => {
                      const acc = row.graded ? Math.round((row.correct / row.graded) * 100) : 0;
                      return (
                        <TableRow key={row.model}>
                          <TableCell className="min-w-0 truncate font-mono text-[11px] text-[#ededed]" title={row.model}>
                            <Badge variant="outline" className="mr-1.5 font-mono text-[9px]">{familyOf(row.model)}</Badge>
                            {row.model}
                          </TableCell>
                          <TableCell className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">{row.graded.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-mono text-[11px] tabular-nums text-[#0cce6b]">{row.correct.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">{row.close.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-mono text-[11px] tabular-nums text-danger">{row.wrong.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-mono text-[11px] font-semibold tabular-nums text-white">{acc}%</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>

          {insights && insights.byTag.length > 0 && (
            <section>
              <h2 className="mb-4 font-medium tracking-tight text-white">Accuracy by tag</h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {insights.byTag.map((t) => {
                  const acc = t.graded ? Math.round((t.correct / t.graded) * 100) : 0;
                  return (
                    <div key={t.tag} className="rounded-lg border border-[#262626] px-3 py-2.5">
                      <div className="flex items-center justify-between">
                        <span className="truncate font-mono text-[11px] text-[#ededed]">{t.tag}</span>
                        <span className="font-mono text-[11px] tabular-nums text-white">{acc}%</span>
                      </div>
                      <p className="mt-0.5 font-mono text-[9px] text-muted-foreground">{t.correct}/{t.graded} correct</p>
                      <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-[#161616]">
                        <div
                          className={`h-full rounded-full bg-gradient-to-r ${site.tagBarFrom} to-accent`}
                          style={{ width: `${Math.max(2, acc)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}

      {/* grading sheet */}
      <Sheet open={!!selectedId} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto border-[#262626] bg-black p-0 sm:max-w-[560px]">
          {selectedId && selectedRow && (
            <div className="flex h-full flex-col">
              <div className="border-b border-[#262626] p-4">
                <SheetTitle className="truncate pr-8 font-mono text-xs text-white" title={selectedRow[1]}>
                  {selectedRow[1]}
                </SheetTitle>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {counts[selectedId] ?? 0} question{counts[selectedId] === 1 ? "" : "s"} on this {site.onThisWording(counts[selectedId] ?? 0)}
                </p>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <ThumbImage
                  fileId={selectedId}
                  alt={selectedRow[1]}
                  w={1600}
                  className="mb-4 h-56 w-full rounded-lg border border-[#262626]"
                />

                {/* question picker */}
                <div className="mb-4 space-y-1.5">
                  {questions.map((q) => (
                    <button
                      key={q.id}
                      onClick={() => { setSelected(q); loadEvals(q.id); setResponse(""); }}
                      className={cn(
                        "block w-full rounded-md border px-2.5 py-2 text-left transition-colors",
                        selected?.id === q.id ? "border-accent/60 bg-[#0f0f0f]" : "border-[#262626] hover:border-[#404040]",
                      )}
                    >
                      <span className="block font-mono text-[11px] text-[#ededed]">{q.question}</span>
                      <span className="mt-0.5 block font-mono text-[9px] text-muted-foreground">
                        gt: {q.answer ?? "—"} · {q.answer_type} · {q.difficulty}
                      </span>
                    </button>
                  ))}
                </div>

                {selected && (
                  <>
                    {/* stored evaluations */}
                    {evals.length > 0 && (
                      <div className="mb-4 rounded-lg border border-[#262626] p-3">
                        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">stored responses ({evals.length})</p>
                        <div className="mt-2 space-y-2">
                          {evals.map((e) => (
                            <div key={e.id} className="rounded border border-[#262626]/60 p-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="min-w-0 truncate font-mono text-[10px] text-[#ededed]" title={e.model}>
                                  <Badge variant="outline" className="mr-1.5 font-mono text-[9px]">{familyOf(e.model)}</Badge>
                                  {e.model}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "shrink-0 font-mono text-[9px]",
                                    e.verdict === "correct" && "border-[#0cce6b]/40 text-[#0cce6b]",
                                    e.verdict === "wrong" && "border-danger/40 text-danger",
                                  )}
                                >
                                  {e.verdict ?? "ungraded"}
                                </Badge>
                              </div>
                              <p className="mt-1 font-mono text-[10px] leading-4 text-muted-foreground">{e.response || "(no response)"}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* model + run */}
                    <div className="space-y-3 rounded-lg border border-[#262626] bg-card/40 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">model under test</span>
                        <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                          <input type="checkbox" checked={visionOnly} onChange={(e) => setVisionOnly(e.target.checked)} className="accent-accent" />
                          vision only
                        </label>
                      </div>

                      <Popover open={modelOpen} onOpenChange={setModelOpen}>
                        <PopoverTrigger asChild>
                          <button
                            role="combobox"
                            aria-expanded={modelOpen}
                            className="flex w-full items-center justify-between gap-2 rounded-md border border-[#262626] bg-[#050505] px-3 py-2 font-mono text-xs text-[#ededed] outline-none transition-colors hover:border-[#404040]"
                          >
                            <span className="min-w-0 truncate">{model || "search and select a model…"}</span>
                            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                          <Command>
                            <CommandInput placeholder="filter models…" />
                            <CommandList>
                              <CommandEmpty>no model matches</CommandEmpty>
                              <CommandGroup>
                                {modelOptions.map((m) => (
                                  <CommandItem
                                    key={m.id}
                                    value={m.id}
                                    onSelect={() => { setModel(m.id); setModelOpen(false); }}
                                  >
                                    <Check className={cn("mr-1 h-3.5 w-3.5", model === m.id ? "opacity-100" : "opacity-0")} />
                                    <span className="min-w-0 truncate">{m.id}</span>
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>

                      <div className="rounded-md border border-[#262626] px-2.5 py-2 font-mono text-[10px] leading-4 text-muted-foreground">
                        openrouter key: {orKey ? "configured ✓" : "not set"} — manage in{" "}
                        <Link to="/settings" className="text-accent hover:underline">settings →</Link>
                      </div>

                      <button
                        onClick={runModel}
                        disabled={running || !model || !orKey}
                        className="w-full rounded-lg bg-white px-4 py-2 font-mono text-xs font-semibold text-black transition-opacity disabled:opacity-30"
                        title="sends the image + crafted prompt to this model via OpenRouter, stores the response"
                      >
                        {running ? "running…" : "run on openrouter"}
                      </button>

                      <label className="block">
                        <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          response {running ? "(waiting for openrouter…)" : "(auto-filled after a run, or paste a manually-run response)"}
                        </span>
                        <textarea
                          value={response}
                          onChange={(e) => setResponse(e.target.value)}
                          rows={3}
                          className="w-full resize-y rounded-md border border-[#262626] bg-[#050505] px-3 py-2 font-mono text-xs text-[#ededed] outline-none focus:border-accent"
                        />
                      </label>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => saveEvaluation()}
                          disabled={busy || !model || !response.trim()}
                          className="rounded-lg border border-accent/60 px-4 py-2 font-mono text-xs text-accent transition-colors hover:bg-accent hover:text-white disabled:opacity-30"
                        >
                          save response
                        </button>
                        <span className="font-mono text-[10px] text-muted-foreground">grade:</span>
                        {VERDICTS.map((v) => (
                          <button
                            key={v}
                            onClick={() => saveEvaluation(v)}
                            disabled={busy || !model}
                            className={cn(
                              "rounded-md border px-2.5 py-1 font-mono text-[10px] transition-colors disabled:opacity-30",
                              existingForModel?.verdict === v
                                ? "border-white bg-white text-black"
                                : "border-[#262626] text-[#a1a1a1] hover:border-[#404040] hover:text-white",
                            )}
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
