import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useData } from "../lib/dataContext";
import { countriesOf } from "../lib/data";
import { fmtN } from "../lib/format";
import { Eyebrow } from "@site/section";
import { Copy, Check } from "lucide-react";

export const Route = createFileRoute("/project")({ component: Project });

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "dataset", label: "Dataset" },
  { id: "graph-oracle", label: "Graph oracle" },
  { id: "contributor-guide", label: "Contributor guide" },
  { id: "api-provenance", label: "API & provenance" },
  { id: "links", label: "Links" },
] as const;

const S_TEMPLATES = [
  "How many stations are on the {line} line?",
  "Which line(s) serve station {station}?",
  "How many transfer stations does this network have?",
  "Which station has the most lines intersecting?",
  "List the stations on the {line} line in order.",
] as const;

const L_TEMPLATES = [
  "How many stops (hops) from {from} to {to} via the shortest path?",
  "How many transfers are needed to go from {from} to {to}?",
  "What is the shortest path from {from} to {to} (list stations)?",
  "Which line(s) would you ride from {from} to {to} with the fewest transfers?",
  "Is there a direct (no-transfer) route from {from} to {to}? If not, where is the transfer?",
] as const;

function Project() {
  const { data } = useData();
  const c = data?.meta.counts;
  const countries = data ? countriesOf(data) : [];
  const ours = countries.filter((s) => s.branch === "ours").length;
  const reason = countries.length - ours;

  return (
    <div className="max-w-3xl">
      <Eyebrow n="05">project</Eyebrow>
      <h1 className="text-2xl font-semibold tracking-tight text-white">About the metro/transit benchmark</h1>

      {/* anchor nav */}
      <nav className="mt-4 flex flex-wrap gap-1.5 border-b border-[#262626] pb-4">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="rounded-full border border-[#262626] px-3 py-1 font-mono text-[11px] text-[#a1a1a1] transition-colors hover:border-accent hover:text-white">
            {s.label}
          </a>
        ))}
      </nav>

      {/* Overview */}
      <section id="overview" className="mt-8 scroll-mt-6 space-y-4">
        <h2 className="font-medium tracking-tight text-white">Overview</h2>
        <p className="text-sm leading-6 text-[#a1a1a1]">
          This is one of three sub-projects for a CVPR submission on vision-language model
          failure modes. The metro/transit dataset is a curated collection of{" "}
          <span className="text-[#ededed]">{c ? fmtN(c.images) : "—"} metro network maps</span>{" "}
          from {c ? fmtN(c.countries) : "—"} countries — real-world transit diagrams that are
          dense, rotated, and multilingual, making them hard for VLMs to read correctly.
        </p>
        <p className="text-sm leading-6 text-[#a1a1a1]">
          Each map targets <span className="text-[#ededed]">5+ benchmark questions</span> (route
          tracing, transfer counting, line identification, spatial reasoning on the diagram).
          The goal is the same as the real-world images site: make frontier models fail.
        </p>
        {c && (
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#262626] bg-[#262626] sm:grid-cols-4">
            <Tile label="maps" value={fmtN(c.images)} />
            <Tile label="countries" value={fmtN(c.countries)} />
            <Tile label="cities" value={fmtN(c.cities)} />
            <Tile label="PDFs" value={fmtN(c.pdfs)} />
          </div>
        )}
      </section>

      {/* Dataset */}
      <section id="dataset" className="mt-10 scroll-mt-6 space-y-4">
        <h2 className="font-medium tracking-tight text-white">Dataset</h2>
        <p className="text-sm leading-6 text-[#a1a1a1]">
          The Drive folder <code className="rounded bg-[#141414] px-1.5 py-0.5 font-mono text-[11px] text-[#ededed]">metro/transit_dataset</code>{" "}
          has two branches (<code className="font-mono text-[11px]">folders[0]</code> normalized via <code className="font-mono text-[11px]">normalizeBranch</code>):
        </p>
        <ul className="space-y-2 text-sm text-[#a1a1a1]">
          <li className="flex gap-3">
            <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
            <span><span className="text-[#ededed]">ours</span> — {ours} countries, curated network maps by city</span>
          </li>
          <li className="flex gap-3">
            <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[#666]" />
            <span><span className="text-[#ededed]">reason_map(exisiting_dataset)</span> — {reason} countries from an existing dataset, kept as a separate reference branch (tolerates <code className="font-mono text-[10px]">reason_map(existing_dataset)</code> / <code className="font-mono text-[10px]">reason_map</code> via normalization)</span>
          </li>
        </ul>
        <p className="text-sm leading-6 text-[#a1a1a1]">
          <code className="rounded bg-[#141414] px-1 py-0.5 font-mono text-[11px] text-[#ededed]">data/metro.json</code> v4 — 9-col <code className="font-mono text-[11px]">MetroRow</code> with <code className="font-mono text-[11px]">folders</code> at <code className="font-mono text-[11px]">[8]</code>. Branch = <code className="font-mono text-[11px]">normalizeBranch(folders[0])</code>, country = <code className="font-mono text-[11px]">folders[1].trim()</code>. Verified counts: 115/85/30/38/85, branches 55 ours / 30 reason_map. Hourly sync <code className="font-mono text-[11px]">0 * * * *</code>. PDFs (30) are reference only.
        </p>
      </section>

      {/* Graph oracle */}
      <section id="graph-oracle" className="mt-10 scroll-mt-6 space-y-4">
        <h2 className="font-medium tracking-tight text-white">Graph oracle (free forever, sidecar + routing)</h2>
        <p className="text-sm leading-6 text-[#a1a1a1]">
          The oracle is graph-native and sidecar-only — never inline into <code className="font-mono text-[11px]">data/metro.json</code> v4, no hosted Maps keys, no sync coupling. Artifact: <code className="font-mono text-[11px]">data/metro-graph.json</code> single file <code className="font-mono text-[11px]">graphs[file_id]</code> (see <code className="font-mono text-[11px]">data/metro-graph.schema.json</code> v1). Fetched from <code className="font-mono text-[11px]">raw.githubusercontent.com</code> with a jsDelivr fallback — <code className="font-mono text-[11px]">drive.metadata.readonly</code> only. Routing: local BFS (unweighted) + Dijkstra when weighted — $0 forever. Flag: <code className="font-mono text-[11px]">VITE_ENABLE_MAPS_ASSIST</code> (on by default; set <code className="font-mono text-[11px]">0</code>/<code className="font-mono text-[11px]">false</code> to disable).
        </p>
        <p className="text-sm leading-6 text-[#a1a1a1]">
          Full spec: <a href="#contributor-guide" className="text-accent hover:underline">contributor guide</a> below and <a href="https://github.com/mmaaaaz/agi-eval-data/blob/main/docs/metro-graph.md" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">docs/metro-graph.md ↗</a> (or the repo <code className="font-mono text-[10px]">docs/metro-graph.md</code>).
        </p>
      </section>

      {/* Contributor guide */}
      <section id="contributor-guide" className="mt-10 scroll-mt-6 space-y-6">
        <h2 className="font-medium tracking-tight text-white">Contributor guide</h2>
        <p className="text-sm leading-6 text-[#a1a1a1]">Eight steps to a reviewed submission. Templates are verbatim — copy them exactly.</p>

        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { n: "1", t: "Open /contribute (access-code gated). Queue sorted by fewest questions (n/5 badges)." },
            { n: "2", t: "Pick a map — sheet shows branch/country/city chips, existing questions, and n/5 count." },
            { n: "3", t: "The graph assist loads the city sidecar via slug/file id (disable with VITE_ENABLE_MAPS_ASSIST=0)." },
            { n: "4", t: "MarkLayer inside Lightbox — station dots + SVG lines + BFS path highlight; disabled for PDFs (k=o); Esc clears." },
            { n: "5", t: "AssistPanel — coverage, marks chips, computed hops/transfers/path, and template preview." },
            { n: "6", t: "Pick S (short) or L (long) template below; preview shows the filed question + answer." },
            { n: "7", t: 'Click "Use as question" — fills fields without auto-submit. Review difficulty, then submit.' },
            { n: "8", t: "QA on /contribute/evaluate — run OpenRouter (BYOK) or manual grade; leaderboard + by-tag accuracy update." },
          ].map((c) => (
            <div key={c.n} className="rounded-lg border border-[#262626] bg-[#0a0a0a] p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-accent">Step {c.n}</p>
              <p className="mt-1 text-sm leading-5 text-[#a1a1a1]">{c.t}</p>
            </div>
          ))}
        </div>

        <div>
          <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#666]">Short templates — S1–S5 (copyable)</h3>
          <div className="mt-3 space-y-2">
            {S_TEMPLATES.map((t, i) => <CopyRow key={i} label={`S${i + 1}`} text={t} />)}
          </div>
        </div>

        <div>
          <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#666]">Long templates — L1–L5 (copyable)</h3>
          <div className="mt-3 space-y-2">
            {L_TEMPLATES.map((t, i) => <CopyRow key={i} label={`L${i + 1}`} text={t} />)}
          </div>
        </div>

        <div>
          <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#666]">Difficulty</h3>
          <div className="mt-3 overflow-hidden rounded-lg border border-[#262626]">
            <table className="w-full text-left">
              <thead className="bg-[#0a0a0a] font-mono text-[10px] uppercase tracking-wider text-[#666]">
                <tr><th className="px-3 py-2">Level</th><th className="px-3 py-2">When</th></tr>
              </thead>
              <tbody className="divide-y divide-[#262626] text-sm">
                <tr><td className="px-3 py-2 font-mono text-xs text-white">easy</td><td className="px-3 py-2 text-[#a1a1a1]">S1–S5 on a single line or single station</td></tr>
                <tr><td className="px-3 py-2 font-mono text-xs text-white">medium</td><td className="px-3 py-2 text-[#a1a1a1]">L1–L2 on short paths (≤ 4 hops) or any counting with transfers</td></tr>
                <tr><td className="px-3 py-2 font-mono text-xs text-white">hard</td><td className="px-3 py-2 text-[#a1a1a1]">L3–L5 or paths with ≥ 2 transfers / ≥ 7 hops / branching degree ≥ 3 on path (auto-suggest; human-overridable)</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#666]">Marking</h3>
          <p className="mt-2 text-sm leading-6 text-[#a1a1a1]"><code className="rounded bg-[#141414] px-1 py-0.5 font-mono text-xs text-[#ededed]">⦻ do-not-work</code> with a reason for duplicates or maps slated for removal. Marks are per-file and surface on gallery&apos;s marked tab and the contribute counter (<code className="font-mono text-xs">N marked →</code>).</p>
        </div>

        <div>
          <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#666]">QA checklist</h3>
          <ul className="mt-2 space-y-1.5 text-sm text-[#a1a1a1]">
            <li className="flex gap-2"><span className="text-accent">☐</span>Question verbatim from S/L or a paraphrase preserving the reasoning</li>
            <li className="flex gap-2"><span className="text-accent">☐</span>Answer is the BFS/Dijkstra output, not a VLM guess</li>
            <li className="flex gap-2"><span className="text-accent">☐</span>Tags include branch/country/city (+ hops/transfer/path when applicable)</li>
            <li className="flex gap-2"><span className="text-accent">☐</span>Duplicate check passed (no near-identical question for this map)</li>
            <li className="flex gap-2"><span className="text-accent">☐</span>For PDFs the graph assist was not used (MarkLayer disabled on kind o)</li>
          </ul>
        </div>
      </section>

      {/* API & provenance */}
      <section id="api-provenance" className="mt-10 scroll-mt-6 space-y-4">
        <h2 className="font-medium tracking-tight text-white">API &amp; provenance</h2>
        <p className="text-sm leading-6 text-[#a1a1a1]">
          <code className="rounded bg-[#141414] px-1 py-0.5 font-mono text-[11px] text-[#ededed]">questions</code> rows carry <code className="font-mono text-[11px]">source</code> (<code className="font-mono text-[11px]">human</code>|<code className="font-mono text-[11px]">graph</code>, default <code className="font-mono text-[11px]">human</code>), <code className="font-mono text-[11px]">graph_file_id</code>, <code className="font-mono text-[11px]">graph_path</code> and <code className="font-mono text-[11px]">idx_q_source</code>. <code className="font-mono text-[11px]">GET /api/questions?source=</code> filters; old rows without columns remain readable (<code className="font-mono text-[11px]">source?</code> optional on <code className="font-mono text-[11px]">QRow</code>). <code className="font-mono text-[11px]">DELETE /api/questions</code> GCs <code className="font-mono text-[11px]">tags</code> with <code className="font-mono text-[11px]">DELETE FROM tags WHERE count &lt;= 0</code>; <code className="font-mono text-[11px]">GET /api/questions/tags</code> returns only <code className="font-mono text-[11px]">count &gt; 0</code>.
        </p>
        <p className="text-sm leading-6 text-[#a1a1a1]">D1 <code className="font-mono text-[11px]">metro-eval-questions</code> — fresh DBs include columns from <code className="font-mono text-[11px]">apps/metro-relay/schema.sql</code>; already-provisioned DBs run the three <code className="font-mono text-[11px]">ALTER TABLE</code> + index commands commented there.</p>
      </section>

      {/* Links */}
      <section id="links" className="mt-10 scroll-mt-6 space-y-3">
        <h2 className="font-medium tracking-tight text-white">Links</h2>
        <ul className="space-y-2 text-sm">
          <li><a href="https://drive.google.com/drive/folders/1FJCnmtmeSsWfznhL0PHjYWn_btoOTRq2" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">source folder in Drive ↗</a></li>
          <li><Link to="/catalog" search={{ branch: "ours", country: "" }} className="text-accent hover:underline">catalog</Link><span className="text-[#666]"> · </span><Link to="/contribute" className="text-accent hover:underline">contribute</Link><span className="text-[#666]"> · </span><Link to="/gallery" className="text-accent hover:underline">gallery</Link></li>
        </ul>
      </section>

      <p className="mt-10 border-t border-[#262626]/60 pt-4 font-mono text-[10px] leading-5 text-[#666]">
        part of agi-eval-data · dataset phase ends ~Sep 15 · experiments by Oct 15 · graph oracle sidecar · graph assist on by default
      </p>
    </div>
  );
}

function CopyRow({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[#262626] bg-[#0a0a0a] px-3 py-2">
      <span className="font-mono text-xs font-semibold text-accent">{label}</span>
      <span className="min-w-0 flex-1 font-mono text-xs text-[#ededed]">{text}</span>
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        aria-label={`Copy ${label}`}
        className="shrink-0 rounded border border-[#262626] p-1.5 text-[#a1a1a1] transition-colors hover:border-accent hover:text-white"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black p-3 sm:p-4">
      <p className="font-mono text-base tabular-nums sm:text-lg text-white">{value}</p>
      <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-[#666]">{label}</p>
    </div>
  );
}
