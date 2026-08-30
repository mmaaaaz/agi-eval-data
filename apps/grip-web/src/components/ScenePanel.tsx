import { useState } from "react";
import type { Sample } from "../lib/gripTypes";

/** Render a scene value compactly: nulls → —, short scalars inline, long
 *  structures collapsed behind an expandable <pre>. */
function SceneValue({ value }: { value: unknown }) {
  const [open, setOpen] = useState(false);
  if (value === null || value === undefined) {
    return <span className="font-mono text-xs text-[#555]">—</span>;
  }
  if (typeof value !== "object") {
    const str = typeof value === "number" ? String(Math.round(value * 10000) / 10000) : String(value);
    return <span className="break-all font-mono text-xs text-[#ededed]">{str}</span>;
  }
  const json = JSON.stringify(value);
  if (json.length <= 60) {
    return <span className="break-all font-mono text-xs text-[#a1a1a1]">{json}</span>;
  }
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="font-mono text-xs text-accent hover:underline"
      >
        {open ? "▾ hide" : "▸ expand"} ({Array.isArray(value) ? `${value.length} items` : `${json.length} chars`})
      </button>
      {open && (
        <pre className="mt-1 max-h-72 overflow-auto rounded border border-[#262626] bg-[#050505] p-2 font-mono text-[10px] leading-4 text-[#a1a1a1]">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}

/** Key/value renderer for the sample's full scene metadata (already stripped of
 *  id/image_path/questions/seed by the scanner). Null = not applicable. */
export function ScenePanel({ sample }: { sample: Sample }) {
  const keys = Object.keys(sample.scene).sort();
  if (keys.length === 0) return null;
  return (
    <div className="rounded-lg border border-[#262626] bg-[#0a0a0a]">
      <p className="border-b border-[#262626] px-3.5 py-2 font-mono text-[9px] uppercase tracking-[0.2em] text-[#666]">
        scene metadata
      </p>
      <dl className="divide-y divide-[#141414]">
        {keys.map((k) => (
          <div key={k} className="grid grid-cols-[minmax(120px,180px)_1fr] gap-2 px-3.5 py-1.5">
            <dt className="truncate font-mono text-[10px] text-[#666]" title={k}>{k}</dt>
            <dd className="min-w-0"><SceneValue value={sample.scene[k]} /></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
