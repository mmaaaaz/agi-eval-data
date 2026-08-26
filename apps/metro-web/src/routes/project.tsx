import { createFileRoute } from "@tanstack/react-router";
import { useData } from "../lib/dataContext";
import { countriesOf } from "../lib/data";
import { fmtN } from "../lib/format";
import { Eyebrow } from "../components/Section";

export const Route = createFileRoute("/project")({ component: Project });

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

      <section className="mt-6 space-y-4">
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
      </section>

      {c && (
        <section className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#262626] bg-[#262626] sm:grid-cols-4">
          <Tile label="maps" value={fmtN(c.images)} />
          <Tile label="countries" value={fmtN(c.countries)} />
          <Tile label="cities" value={fmtN(c.cities)} />
          <Tile label="PDFs" value={fmtN(c.pdfs)} />
        </section>
      )}

      <section className="mt-6 space-y-4">
        <h2 className="font-medium tracking-tight text-white">Dataset structure</h2>
        <p className="text-sm leading-6 text-[#a1a1a1]">
          The Drive folder <code className="rounded bg-[#141414] px-1.5 py-0.5 font-mono text-[11px] text-[#ededed]">metro/transit_dataset</code>{" "}
          has two branches:
        </p>
        <ul className="space-y-2 text-sm text-[#a1a1a1]">
          <li className="flex gap-3">
            <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
            <span><span className="text-[#ededed]">ours</span> — {ours} countries, curated network maps by city</span>
          </li>
          <li className="flex gap-3">
            <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[#666]" />
            <span><span className="text-[#ededed]">reason_map(exisiting_dataset)</span> — {reason} countries from an existing dataset, kept as a separate reference branch</span>
          </li>
        </ul>
        <p className="text-sm leading-6 text-[#a1a1a1]">
          Images sync daily from Google Drive (metadata only — no bytes stored here). The
          30 official network-plan PDFs are included for reference and download.
        </p>
      </section>

      <section className="mt-6">
        <a
          href="https://drive.google.com/drive/folders/1FJCnmtmeSsWfznhL0PHjYWn_btoOTRq2"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block rounded-lg border border-[#262626] bg-[#0a0a0a] px-5 py-3 font-mono text-xs text-[#ededed] transition-colors hover:border-[#404040]"
        >
          open the source folder in Drive ↗
        </a>
      </section>

      <p className="mt-10 border-t border-[#262626]/60 pt-4 font-mono text-[10px] leading-5 text-[#666]">
        part of agi-eval-data · dataset phase ends ~Sep 15 · experiments by Oct 15
      </p>
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
