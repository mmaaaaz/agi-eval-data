import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Skeleton, Sheet, SheetContent, SheetTitle } from "./ui";
import { VirtualGallery } from "./VirtualGallery";
import { ThumbImage } from "./ThumbImage";
import { fmtB, fmtN } from "./format";
import { useData } from "./dataContext";
import { ActorBar } from "./ActorBar";
import { AnchorBox } from "./AnchorBox";
import { assignBatch } from "./batch";
import { getActor } from "./questions";
import { useLiveSync } from "./useLiveSync";
import type { AskSettings } from "./settings";
import { ApiError, parseChoices, questionsApi, normQ, normTags as parseTags, type QRow, type RevRow } from "./questions";
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
  /** per-row graph badge (stations/edges) rendered beside the question count in the grid/sheet */
  graphBadgeFor?: (row: Row) => import("react").ReactNode;
  /** title for the sheet header (e.g. cityName(row) || row[1]) */
  titleFor?: (row: Row) => string;
  /** optional overlay for the selected sheet's image (Lightbox relative container, disabled for PDFs) */
  overlayFor?: (row: Row) => React.ReactNode;
}
/** Fixed question taxonomy. A suite needs a closed set, not free-form tags:
 *  results cannot be grouped by domain without one, and two annotators will
 *  never invent the same words. Relevance classes follow Ray et al. (EMNLP 2016).
 *  Families are those published work reports VLMs failing on. */
export type FamilyId =
  | "counting" | "scene_text" | "spatial" | "attribute_binding"
  | "absent_entity" | "knowledge_boundary";
export type Relevance = "visual_true_premise" | "visual_false_premise" | "non_visual";

const QUESTION_FAMILIES: { id: FamilyId; label: string; hint: string }[] = [
  { id: "counting", label: "counting", hint: "exact count of objects, often under clutter" },
  { id: "scene_text", label: "scene text", hint: "reading a sign, plate, receipt or label" },
  { id: "spatial", label: "spatial", hint: "relative position of two things in the same photo" },
  { id: "attribute_binding", label: "attribute binding", hint: "which object carries the property" },
  { id: "absent_entity", label: "absent entity", hint: "asks about something not in the photo" },
  { id: "knowledge_boundary", label: "knowledge boundary", hint: "needs knowledge beyond the photo" },
];

const UNANSWERABLE_REASONS = [
  "occlusion", "out_of_frame", "indeterminate_spatial",
  "absent_entity", "insufficient_resolution", "requires_world_knowledge",
] as const;

/** Axis B — what competence an item tests. THE REPORTING AXIS.
 *  Independent of `family` below, which says what failure occurred.
 *  Keep this list in step with the paper's taxonomy table. */
const CAPABILITIES: { group: string; items: { id: string; label: string }[] }[] = [
  {
    group: "geometry — how the scene is laid out",
    items: [
      { id: "G1", label: "G1 · depth and occlusion" },
      { id: "G2", label: "G2 · relative size and distance" },
      { id: "G3", label: "G3 · shape and structure" },
      { id: "G4", label: "G4 · lines and angles" },
      { id: "G5", label: "G5 · perspective and viewpoint" },
      { id: "G6", label: "G6 · spatial layout" },
      { id: "G7", label: "G7 · symmetry and pattern" },
      { id: "G8", label: "G8 · fit and clearance" },
    ],
  },
  {
    group: "physics — what the scene would do",
    items: [
      { id: "P1", label: "P1 · material properties" },
      { id: "P2", label: "P2 · support and stability" },
      { id: "P3", label: "P3 · contact and containment" },
      { id: "P4", label: "P4 · forces and load paths" },
      { id: "P5", label: "P5 · dynamics and prediction" },
      { id: "P6", label: "P6 · light and shadow" },
      { id: "P7", label: "P7 · fluids, air and heat" },
      { id: "P8", label: "P8 · function and affordance" },
    ],
  },
  {
    group: "bridge — physics that depends on geometry (always build these as PAIRS)",
    items: [
      { id: "B1", label: "B1 · tipping and balance" },
      { id: "B2", label: "B2 · shadow reasoning" },
      { id: "B3", label: "B3 · rolling and sliding" },
      { id: "B4", label: "B4 · passage and collision" },
    ],
  },
  { group: "control", items: [{ id: "PERC", label: "PERC · perception only (the L1 control rung)" }] },
];

/** Axis C — how many reasoning steps. Independent of capability. */
const LEVELS = [
  { id: "L1", label: "L1 · perception only", hint: "is there a box on top" },
  { id: "L2", label: "L2 · one judgement", hint: "is the forklift closer than the SUV" },
  { id: "L3", label: "L3 · two linked steps", hint: "which way does the road curve after the median ends" },
  { id: "L4", label: "L4 · prediction or counterfactual", hint: "would the overhead guard hit the canopy" },
  { id: "L5", label: "L5 · multi-step plus outside knowledge", hint: "why is the frame triangulated" },
];

const PAIR_ROLES = [
  { id: "geometry", label: "geometry probe", hint: "asks about the layout: is the gap wider, is the centre above the base" },
  { id: "physics", label: "physics probe", hint: "asks the outcome: will it pass, will it stay standing" },
  { id: "perception", label: "perception probe", hint: "asks only what is there, so a failure can be split" },
] as const;

/** A bridge item is one member of a pair, so it needs a shared id. */
function newPairId(): string {
  return "pair_" + Math.random().toString(36).slice(2, 10);
}

/** Shared styling for the taxonomy selects, so they match the rest of the sheet. */
const INPUT =
  "w-full rounded-md border border-[#262626] bg-[#050505] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none transition-colors focus:border-accent";

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
  const [family, setFamily] = useState<FamilyId | "">("");
  const [relevance, setRelevance] = useState<Relevance>("visual_true_premise");
  const [unanswerableReason, setUnanswerableReason] = useState("");
  const [tolerance, setTolerance] = useState("");
  const [tags, setTags] = useState("");
  const [capability, setCapability] = useState("");
  const [level, setLevel] = useState("");
  const [pairRole, setPairRole] = useState<"" | "geometry" | "physics" | "perception">("");
  const [pairId, setPairId] = useState("");
  // Set after saving a PHYSICS probe: the required pair is now complete, and the perception
  // control is genuinely optional. Offered rather than auto-selected, because unlike the
  // physics twin it is not needed for the 2x2 — switching the form to it unasked would push
  // a contributor into a third item they may not want.
  const [offerPerception, setOfferPerception] = useState(false);
  const [allTags, setAllTags] = useState<[string, number][]>([]);
  const [dupeWarn, setDupeWarn] = useState<{ id: number; question: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [markReason, setMarkReason] = useState("");
  const [groundingBox, setGroundingBox] = useState("");
  const [editing, setEditing] = useState<{ id: number; rev: number } | null>(null);
  const [conflict, setConflict] = useState<{ current: QRow; mine: { question: string; answer: string } } | null>(null);
  const [historyFor, setHistoryFor] = useState<number | null>(null);
  const [history, setHistory] = useState<RevRow[]>([]);
  const [histBusy, setHistBusy] = useState(false);

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

  /* my batch: a bounded, deterministic slice so nobody duplicates anyone else */
  const [myBatchOnly, setMyBatchOnly] = useState(false);
  const actorId = useMemo(() => getActor().id, []);
  const myBatch = useMemo(() => {
    if (!data) return new Set<string>();
    const ids = data.files.filter((r) => r[7] === "i").map((r) => r[0]);
    return new Set(assignBatch(ids, actorId));
  }, [data, actorId]);

  /* grid rows: images, not excluded, sorted */
  const rows = useMemo(() => {
    if (!data || !countsLoaded) return [];
    const s = search.trim().toLowerCase();
    const items = data.files
      .filter((r) => r[7] === "i" && !excludedSet.has(r[0]))
      .filter((r) => !myBatchOnly || myBatch.has(r[0]))
      .filter((r) => !s || r[1].toLowerCase().includes(s) || (site.searchText?.(r) ?? "").toLowerCase().includes(s));
    const cmp: Record<Sort, (a: (typeof items)[0], b: (typeof items)[0]) => number> = {
      needs: (a, b) => (counts[a[0]] ?? 0) - (counts[b[0]] ?? 0) || b[4].localeCompare(a[4]),
      recent: (a, b) => b[4].localeCompare(a[4]),
      name: (a, b) => a[1].localeCompare(b[1]),
    };
    return items.sort(cmp[sort]);
  }, [data, search, counts, countsLoaded, excludedSet, sort, site.searchText, myBatchOnly, myBatch]);

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

  // Live sync, scoped to the image on screen. A longer interval than the review
  // queue on purpose: authoring is a writing task, so freshness matters less than
  // not disturbing someone mid-sentence, and a lower poll rate keeps the free
  // request allowance well clear of the ceiling with fifteen contributors.
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  useLiveSync({
    relay,
    intervalMs: 30000,
    onDelta: (d) => {
      const id = selectedIdRef.current;
      if (id && d.questions.some((q) => q.file_id === id)) loadExisting(id);
      if (d.questions.length > 0) refreshCounts();
    },
  });

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

  // fill from graph assist without auto-submit
  useEffect(() => {
    const h = (e: Event) => {
      const ce = e as CustomEvent<{ question: string; answer: string; tags: string }>;
      const d = ce.detail;
      if (!d) return;
      if (d.question) setQuestion(d.question);
      if (typeof d.answer === "string") setAnswer(d.answer);
      if (d.tags) setTags(d.tags);
    };
    window.addEventListener("metro:use-template", h as EventListener);
    return () => window.removeEventListener("metro:use-template", h as EventListener);
  }, []);

  const tagSuggestions = useMemo(() => {
    const segs = tags.split(",");
    const last = (segs[segs.length - 1] ?? "").trim().toLowerCase();
    if (last.length < 2) return [];
    return allTags
      .filter(([t]) => t.startsWith(last) && !parseTags(tags).includes(t))
      .slice(0, 6);
  }, [tags, allTags]);

  /** The form's fields, in the shape both create and edit send. */
  const formPayload = () => ({
    question: question.trim(),
    answer_type: answerType,
    answer: answer.trim(),
    choices: answerType === "choice" ? JSON.stringify(choices.map((c) => c.trim()).filter(Boolean)) : "",
    difficulty,
    tags: [family, ...parseTags(tags)].join(", "),
    capability,
    level,
    pair_id: capability.startsWith("B") ? pairId : "",
    pair_role: capability.startsWith("B") ? pairRole : "",
    tolerance: tolerance.trim() === "" ? null : Number(tolerance),
    grounding_box: groundingBox,
  });

  const startEdit = (q: QRow) => {
    setEditing({ id: q.id, rev: Number(q.rev ?? 0) });
    setConflict(null);
    setQuestion(q.question);
    setAnswerType(q.answer_type || "text");
    setAnswer(q.answer ?? "");
    // The shared parser, so the form reads options exactly as the release and the review
    // screen do. The inline JSON.parse here handled only the JSON form.
    setChoices(q.choices ? (() => { const c = parseChoices(q.choices); return c.length ? c : ["", ""]; })() : ["", ""]);
    setDifficulty(q.difficulty || "medium");
    setFamily((q.family as FamilyId | undefined) ?? "");
    setCapability(q.capability ?? "");
    setLevel(q.level ?? "");
    setPairRole((q.pair_role as "" | "geometry" | "physics" | "perception" | null) ?? "");
    setPairId(q.pair_id ?? "");
    setTolerance(q.tolerance === null || q.tolerance === undefined ? "" : String(q.tolerance));
    setTags(parseTags(q.tags).filter((t) => t !== (q.family ?? "")).join(", "));
    setGroundingBox(q.grounding_box ?? "");
    toast.success("editing — save changes, or cancel");
  };

  const cancelEdit = () => {
    setEditing(null);
    setConflict(null);
    setQuestion(""); setAnswer(""); setChoices(["", ""]); setDupeWarn([]); setGroundingBox("");
    setOfferPerception(false);
  };

  /** Re-send my version using THEIR revision, so the write is no longer stale. */
  const keepMine = async () => {
    if (!conflict || !editing) return;
    try {
      await questionsApi.patch(relay, code, editing.id, Number(conflict.current.rev ?? 0), formPayload());
      toast.success("yours kept — their version is in the history and can be restored");
      setConflict(null);
      setEditing(null);
      setQuestion(""); setAnswer(""); setChoices(["", ""]); setDupeWarn([]); setGroundingBox("");
      if (selectedId) loadExisting(selectedId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const takeTheirs = () => {
    if (!conflict) return;
    const theirs = conflict.current;
    setConflict(null);
    startEdit(theirs);
  };

  const submit = async () => {
    if (!selectedId || !question.trim()) return;
    if (dupeWarn.some((m) => normQ(m.question) === normQ(question))) {
      toast.error("identical question already exists for this image");
      return;
    }
    if (!capability) {
      toast.error("pick a capability — the leaderboard is grouped by it");
      return;
    }
    if (!level) {
      toast.error("pick a level — it is reported beside the capability");
      return;
    }
    if (capability.startsWith("B") && !pairRole) {
      toast.error("a bridge item is one member of a pair — say which probe this is");
      return;
    }
    if (!family) {
      toast.error("pick a question family — the error analysis is grouped by it");
      return;
    }
    if (answerType === "number" && tolerance.trim() === "") {
      toast.error("a numeric answer needs a tolerance (0 for exact)");
      return;
    }
    if (relevance !== "visual_true_premise" && !unanswerableReason) {
      toast.error("say why it is not answerable");
      return;
    }
    setBusy(true);
    if (editing) {
      // EDIT: send the revision we read. A stale one returns 409 WITH the current
      // row, so a conflict becomes a diff to resolve rather than lost work.
      try {
        await questionsApi.patch(relay, code, editing.id, editing.rev, formPayload());
        toast.success("saved — the previous version is kept and can be restored");
        setEditing(null);
        setConflict(null);
        setQuestion(""); setAnswer(""); setChoices(["", ""]); setDupeWarn([]); setGroundingBox("");
        if (selectedId) loadExisting(selectedId);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setConflict({
            current: err.body.current as QRow,
            mine: { question: question.trim(), answer: answer.trim() },
          });
          toast.error("someone else edited this while you were typing — compare and choose");
        } else if (err instanceof ApiError && err.status === 428) {
          // The API now requires a revision on every edit. This can only happen to a
          // caller that sent none, which the form never does — but the message should
          // tell a person what to do rather than print a status code.
          toast.error("this item needs a fresh revision before saving — reopen it and try again");
        } else {
          toast.error(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      const result = await questionsApi.add(relay, code, {
        file_id: selectedId,
        contributor: site.contributor,
        question: question.trim(),
        answer_type: answerType,
        answer: answer.trim(),
        choices: answerType === "choice" ? JSON.stringify(choices.map((c) => c.trim()).filter(Boolean)) : "",
        difficulty,
        family,
        relevance,
        unanswerable_reason: relevance === "visual_true_premise" ? "" : unanswerableReason,
        tolerance: tolerance.trim() === "" ? null : Number(tolerance),
        tags: [family, ...parseTags(tags)].join(", "),
        capability,
        level,
        pair_id: capability.startsWith("B") ? pairId : "",
        pair_role: capability.startsWith("B") ? pairRole : "",
      });
      setQuestion(""); setAnswer(""); setChoices(["", ""]); setDupeWarn([]); setGroundingBox("");
      if (capability.startsWith("B") && pairRole === "geometry") {
        // ONE CLICK TO THE TWIN: same image, same anchor, same pair, other role.
        // Pairing has to be easier than not pairing, or there will be no pairs.
        setPairRole("physics");
        setAnswer("");
        setOfferPerception(false);
        toast.success("saved as the geometry probe — now write its physics twin on the same object");
      } else if (capability.startsWith("B") && pairRole === "physics") {
        // The pair is COMPLETE. Perception is the optional third member, so it is offered
        // rather than assumed.
        setOfferPerception(true);
        toast.success("pair complete — a perception control on the same object is optional");
      } else if (result.status === "draft") {
        setPairRole(""); setPairId(""); setOfferPerception(false);
        toast.success("saved as a DRAFT — a reviewer approves it before it enters the benchmark");
      } else {
        setPairRole(""); setPairId(""); setOfferPerception(false);
        toast.success(`saved and approved — ${selectedCount + 1} question${selectedCount ? "s" : ""} on this ${site.imageLabel === "maps" ? "map" : "image"} now`);
      }
      loadExisting(selectedId);
      refreshCounts();
      questionsApi.tags(relay, code).then((r) => setAllTags(r.tags)).catch(() => {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openHistory = async (id: number) => {
    if (historyFor === id) { setHistoryFor(null); setHistory([]); return; }
    setHistoryFor(id);
    setHistBusy(true);
    try {
      const r = await questionsApi.revisions(relay, code, id);
      setHistory(r.revisions);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setHistory([]);
    } finally {
      setHistBusy(false);
    }
  };

  const restoreRevision = async (id: number, revId: number) => {
    try {
      await questionsApi.restore(relay, code, id, revId);
      toast.success("restored — the change is itself undoable");
      setHistoryFor(null);
      setHistory([]);
      if (selectedId) loadExisting(selectedId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
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
    const qBadge = n === 0 ? null : (
      <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] tabular-nums ${n >= 5 ? "border border-[#0cce6b]/40 text-[#0cce6b]" : "border border-[#262626] text-[#a1a1a1]"}`}>
        {n}/5
      </span>
    );
    const gBadge = site.graphBadgeFor?.(row) ?? null;
    if (!qBadge && !gBadge) return null;
    return (
      <span className="inline-flex items-center gap-1">
        {qBadge}
        {gBadge}
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

      {/* Onboarding: the rules, and a batch you can actually finish. */}
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-[#262626] bg-[#0a0a0a]/40 px-3 py-2">
        <button
          onClick={() => setMyBatchOnly((v) => !v)}
          className={
            "rounded-md border px-2.5 py-1 font-mono text-[10px] transition-colors " +
            (myBatchOnly ? "border-accent text-accent" : "border-[#262626] text-[#a1a1a1] hover:border-accent hover:text-accent")
          }
        >
          {myBatchOnly ? "showing my batch" : "show only my batch"}
        </button>
        <span className="font-mono text-[10px] text-[#666]">
          {myBatch.size} images assigned to you · deterministic, so two people never get the same ones
        </span>
        <a
          href="/contribute/rules"
          className="ml-auto font-mono text-[10px] text-accent underline decoration-dotted hover:no-underline"
        >
          the six writing rules →
        </a>
      </div>

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
                {(() => {
                  const overlay = site.overlayFor?.(selected);
                  const isPdf = selected[7] === "o";
                  return (
                    <div className="relative mb-4 overflow-hidden rounded-lg border border-[#262626]">
                      <ThumbImage
                        fileId={selected[0]}
                        alt={selected[1]}
                        w={1600}
                        className="h-56 w-full"
                      />
                      {overlay && !isPdf && (
                        <div className="pointer-events-auto absolute inset-0 rounded-lg">{overlay}</div>
                      )}
                    </div>
                  );
                })()}
                <div className="mb-4 flex items-center justify-between gap-2">
                  <span className="rounded border border-[#262626] px-2 py-0.5 font-mono text-[10px] tabular-nums text-[#a1a1a1]">
                    {selectedCount}/5 questions
                  </span>
                  {site.graphBadgeFor && selected && (() => { const g = site.graphBadgeFor!(selected); return g ? <span className="rounded border border-[#262626] px-2 py-0.5 font-mono text-[10px] tabular-nums text-[#a1a1a1]">{g}</span> : null; })()}
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
                    <div className="mt-2 space-y-2.5">
                      {existing.map((q) => {
                        // An author must be able to see what happened to what they wrote.
                        // Without this they repeat a rejected pattern for two months, and
                        // the reviewer writes the same reason over and over.
                        const rs = (q.review_status ?? "").toLowerCase();
                        const state =
                          q.status !== "draft"
                            ? { label: "in the benchmark", cls: "text-[#0cce6b] border-[#0cce6b]/40" }
                            : rs === "rejected"
                              ? { label: "rejected", cls: "text-danger border-danger/40" }
                              : rs === "fixed"
                                ? { label: "sent back to fix", cls: "text-[#f59e0b] border-[#f59e0b]/40" }
                                : rs === "accepted"
                                  ? { label: "accepted", cls: "text-[#0cce6b] border-[#0cce6b]/40" }
                                  : { label: "awaiting review", cls: "text-[#a1a1a1] border-[#262626]" };
                        const tags = [q.capability, q.level, q.pair_role].filter(Boolean).join(" · ");
                        return (
                          <div key={q.id}>
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1 font-mono text-[11px] text-[#ededed]">
                              {q.question}
                              <span className="ml-2 text-[9px] text-muted-foreground">
                                {tags || q.answer_type}{q.answer ? ` · ${q.answer}` : ""}
                              </span>
                              <span className={"ml-2 rounded-full border px-1.5 py-0.5 text-[9px] " + state.cls}>
                                {state.label}
                              </span>
                              {q.blind_passed === 1 && (
                                <span
                                  className="ml-2 rounded-full border border-danger/50 px-1.5 py-0.5 text-[9px] text-danger"
                                  title="a text-only model answered this correctly with no image — rewrite it or it measures priors, not vision"
                                >
                                  answerable without the image
                                </span>
                              )}
                              {q.review_reason ? (
                                <span className="mt-1 block text-[10px] italic leading-4 text-[#a1a1a1]">
                                  reviewer: {q.review_reason}
                                </span>
                              ) : null}
                            </div>
                            <button
                              onClick={() => startEdit(q)}
                              aria-label="Edit question"
                              title="edit the text, the answer or the classification"
                              className="shrink-0 font-mono text-[10px] text-muted-foreground transition-colors hover:text-accent"
                            >
                              ✎
                            </button>
                            <button
                              onClick={() => void openHistory(q.id)}
                              aria-label="Show history"
                              title="every save is kept, and any of them can be restored"
                              className="shrink-0 font-mono text-[10px] text-muted-foreground transition-colors hover:text-accent"
                            >
                              ⟲
                            </button>
                            <button
                              onClick={() => removeQuestion(q.id)}
                              aria-label="Delete question"
                              className="shrink-0 font-mono text-[10px] text-muted-foreground transition-colors hover:text-danger"
                            >
                              ✕
                            </button>
                          </div>
                          {historyFor === q.id && (
                            <div className="ml-3 mt-1.5 space-y-1 border-l border-[#262626] pl-3">
                              {histBusy && <span className="font-mono text-[10px] text-[#666]">loading history…</span>}
                              {!histBusy && history.length === 0 && (
                                <span className="font-mono text-[10px] text-[#666]">no revisions recorded</span>
                              )}
                              {history.map((h) => (
                                <div key={h.rev_id} className="flex items-center gap-2 font-mono text-[10px]">
                                  <span className="text-[#666]">{h.created_at}</span>
                                  <span className="text-[#a1a1a1]">{h.op}</span>
                                  <span className="truncate text-[#666]">{h.actor_name || h.actor_id || "—"}</span>
                                  <span className="ml-auto shrink-0 text-[#555]">rev {h.seq}</span>
                                  {h.op !== "insert" && (
                                    <button
                                      onClick={() => void restoreRevision(q.id, h.rev_id)}
                                      className="shrink-0 text-accent transition-colors hover:underline"
                                      title="a revision records the state BEFORE a change, so restoring reverts that change"
                                    >
                                      restore
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <ActorBar />
                  {selectedId && (
                    <AnchorBox fileId={selectedId} value={groundingBox} onChange={setGroundingBox} />
                  )}
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
                  {/* Fixed taxonomy. Free-form tags alone cannot support a suite:
                      results cannot be grouped by domain, and two annotators will
                      never use the same words. The three relevance classes are
                      taken verbatim from Ray et al. (EMNLP 2016); the six families
                      are those published work says VLMs fail on. */}
                  <label className="block">
                    <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      question family <span className="text-[#f59e0b]">required</span>
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {QUESTION_FAMILIES.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          title={f.hint}
                          onClick={() => setFamily(f.id)}
                          className={`rounded-full border px-2.5 py-1 font-mono text-[10px] transition-colors ${
                            family === f.id
                              ? "border-accent text-accent"
                              : "border-[#262626] text-[#a1a1a1] hover:border-[#404040]"
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </label>

                  <label className="block">
                    <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">answerable from the image?</span>
                    <select
                      value={relevance}
                      onChange={(e) => setRelevance(e.target.value as Relevance)}
                      className="w-full rounded-md border border-[#262626] bg-[#050505] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none transition-colors focus:border-accent"
                    >
                      <option value="visual_true_premise">yes — the photo contains it</option>
                      <option value="visual_false_premise">no — it asks about something absent</option>
                      <option value="non_visual">no — needs knowledge beyond the photo</option>
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">if not answerable, why</span>
                    <select
                      value={unanswerableReason}
                      onChange={(e) => setUnanswerableReason(e.target.value)}
                      className="w-full rounded-md border border-[#262626] bg-[#050505] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none transition-colors focus:border-accent"
                    >
                      <option value="">—</option>
                      {UNANSWERABLE_REASONS.map((r) => (
                        <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      numeric tolerance {answerType === "number" && <span className="text-[#f59e0b]">required</span>}
                    </span>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={tolerance}
                      onChange={(e) => setTolerance(e.target.value)}
                      placeholder={answerType === "number" ? "0 for exact" : "not applicable"}
                      className="w-full rounded-md border border-[#262626] bg-[#050505] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none transition-colors placeholder:text-[#555] focus:border-accent"
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

                  {/* The two-axis taxonomy. `capability` and `level` are the REPORTING
                      axes; `family` above is the error-analysis axis. They answer
                      different questions and are deliberately independent. */}
                  <label className="block">
                    <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      capability <span className="text-[#f59e0b]">required</span>
                    </span>
                    <select
                      value={capability}
                      onChange={(e) => {
                        const v = e.target.value;
                        setCapability(v);
                        if (v.startsWith("B")) {
                          if (!pairId) setPairId(newPairId());
                        } else {
                          setPairRole(""); setPairId("");
                        }
                      }}
                      className={INPUT}
                    >
                      <option value="">—</option>
                      {CAPABILITIES.map((g) => (
                        <optgroup key={g.group} label={g.group}>
                          {g.items.map((c) => (
                            <option key={c.id} value={c.id}>{c.label}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <span className="mt-1 block font-mono text-[10px] leading-4 text-[#666]">
                      what competence this tests. grouped in every results table.
                    </span>
                  </label>

                  <label className="block">
                    <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      level <span className="text-[#f59e0b]">required</span>
                    </span>
                    <select value={level} onChange={(e) => setLevel(e.target.value)} className={INPUT}>
                      <option value="">—</option>
                      {LEVELS.map((l) => (
                        <option key={l.id} value={l.id} title={l.hint}>{l.label}</option>
                      ))}
                    </select>
                    <span className="mt-1 block font-mono text-[10px] leading-4 text-[#666]">
                      how many reasoning steps. reported beside the capability.
                    </span>
                  </label>

                  {capability.startsWith("B") && (
                    <div className="space-y-2 rounded-lg border border-accent/40 bg-accent/5 p-3">
                      <span className="block font-mono text-[10px] uppercase tracking-wider text-accent">
                        paired probe
                      </span>
                      <p className="font-mono text-[10px] leading-4 text-[#a1a1a1]">
                        A bridge item is always one member of a pair on the same object.
                        Geometry right plus physics wrong is the finding this whole
                        benchmark exists to produce.
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {PAIR_ROLES.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            title={p.hint}
                            onClick={() => setPairRole(p.id)}
                            className={
                              "rounded-full border px-2.5 py-1 font-mono text-[10px] transition-colors " +
                              (pairRole === p.id
                                ? "border-accent text-accent"
                                : "border-[#262626] text-[#a1a1a1] hover:border-[#404040]")
                            }
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                      <span className="block font-mono text-[10px] text-[#666]">
                        pair id {pairId || "—"} · shared by every probe on this anchor
                      </span>
                      {offerPerception && (
                        <div className="flex items-center gap-2 rounded-md border border-[#0cce6b]/40 bg-[#0cce6b]/5 p-2">
                          <span className="font-mono text-[10px] leading-4 text-[#0cce6b]">
                            pair complete. a perception control on the same object is optional —
                            it splits "did not see" from "saw but misjudged".
                          </span>
                          <button
                            type="button"
                            onClick={() => { setPairRole("perception"); setOfferPerception(false); setAnswer(""); }}
                            className="shrink-0 rounded-md border border-[#0cce6b]/60 px-2 py-1 font-mono text-[10px] text-[#0cce6b] transition-colors hover:bg-[#0cce6b] hover:text-black"
                          >
                            add perception
                          </button>
                          <button
                            type="button"
                            onClick={() => setOfferPerception(false)}
                            className="shrink-0 font-mono text-[10px] text-[#666] hover:text-[#a1a1a1]"
                          >
                            not needed
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="space-y-1 rounded-lg border border-[#262626] bg-[#0a0a0a]/60 p-3">
                    <span className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      ready to save
                    </span>
                    {[
                      { label: "capability set", ok: !!capability },
                      { label: "level set", ok: !!level },
                      { label: "family set", ok: !!family },
                      { label: "one defensible answer", ok: answer.trim() !== "" || answerType === "text" },
                      { label: "the photo contains the answer", ok: relevance === "visual_true_premise" },
                      { label: "pair role set (bridge items)", ok: !capability.startsWith("B") || !!pairRole },
                      { label: "anchor marked", ok: groundingBox !== "" },
                    ].map((c) => (
                      <div key={c.label} className="flex items-center gap-2 font-mono text-[10px]">
                        <span className={c.ok ? "text-[#0cce6b]" : "text-[#f59e0b]"}>{c.ok ? "✓" : "○"}</span>
                        <span className={c.ok ? "text-[#a1a1a1]" : "text-[#ededed]"}>{c.label}</span>
                      </div>
                    ))}
                  </div>

                  {conflict && (
                    <div className="space-y-2 rounded-lg border border-danger/40 bg-danger/5 p-3">
                      <span className="block font-mono text-[10px] uppercase tracking-wider text-danger">
                        someone else changed this item
                      </span>
                      <p className="font-mono text-[10px] leading-4 text-[#a1a1a1]">
                        Nothing was saved, so nothing was lost. Pick a version — whichever you
                        do not pick stays in the history and can be restored.
                      </p>
                      <div className="grid gap-2 md:grid-cols-2">
                        <div className="rounded-md border border-[#262626] bg-[#050505] p-2">
                          <span className="block font-mono text-[9px] uppercase tracking-wider text-[#666]">theirs (saved)</span>
                          <p className="mt-1 font-mono text-[11px] text-[#ededed]">{conflict.current.question}</p>
                          <p className="font-mono text-[10px] text-[#a1a1a1]">answer: {conflict.current.answer ?? "—"}</p>
                        </div>
                        <div className="rounded-md border border-accent/40 bg-[#050505] p-2">
                          <span className="block font-mono text-[9px] uppercase tracking-wider text-accent">yours (unsaved)</span>
                          <p className="mt-1 font-mono text-[11px] text-[#ededed]">{conflict.mine.question}</p>
                          <p className="font-mono text-[10px] text-[#a1a1a1]">answer: {conflict.mine.answer || "—"}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => void keepMine()}
                          className="rounded-md border border-accent/60 px-3 py-1.5 font-mono text-[10px] text-accent transition-colors hover:bg-accent hover:text-white"
                        >
                          keep mine
                        </button>
                        <button
                          onClick={takeTheirs}
                          className="rounded-md border border-[#262626] px-3 py-1.5 font-mono text-[10px] text-[#a1a1a1] transition-colors hover:border-[#404040]"
                        >
                          take theirs
                        </button>
                      </div>
                    </div>
                  )}

                  {editing && (
                    <p className="font-mono text-[10px] text-[#f59e0b]">
                      editing item #{editing.id} · saving keeps the previous version
                    </p>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={submit}
                      disabled={busy || !question.trim() || dupeWarn.some((m) => normQ(m.question) === normQ(question))}
                      className="flex-1 rounded-lg bg-white px-4 py-2.5 font-mono text-xs font-semibold text-black transition-opacity disabled:opacity-30"
                    >
                      {busy ? "saving…" : editing ? "save changes" : "submit question"}
                    </button>
                    {editing && (
                      <button
                        onClick={cancelEdit}
                        className="rounded-lg border border-[#262626] px-4 py-2.5 font-mono text-xs text-[#a1a1a1] transition-colors hover:border-[#404040]"
                      >
                        cancel
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
