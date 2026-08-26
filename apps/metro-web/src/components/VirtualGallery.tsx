import { useEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Row } from "@metro/shared/types";
import { ThumbImage } from "./ThumbImage";

interface Props {
  rows: Row[];
  dupSet: Set<string>;
  onOpen: (index: number) => void;
  /** optional per-image badge (e.g. question count) rendered beside the caption */
  badge?: (row: Row) => ReactNode;
}

const MIN_COL = 168;
const GAP = 8;
const CAPTION = 30;

/** Windowed responsive thumbnail grid — handles 20k+ rows smoothly. */
export function VirtualGallery({ rows, dupSet, onOpen, badge }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const cols = Math.max(2, Math.floor((width - GAP) / (MIN_COL + GAP)) || 2);
  const colW = width ? Math.floor((width - GAP * (cols - 1)) / cols) : MIN_COL;
  const imgH = Math.round(colW * 0.72);
  const rowH = imgH + CAPTION + GAP;
  const rowCount = Math.ceil(rows.length / cols);

  const virt = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowH,
    overscan: 4,
    getItemKey: (i) => rows[i * cols]?.[0] ?? `r${i}`,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto px-1" style={{ contain: "strict" }}>
        <div style={{ height: virt.getTotalSize(), position: "relative" }}>
          {virt.getVirtualItems().map((vi) => (
            <div
              key={vi.key}
              className="absolute left-0 w-full"
              style={{
                height: rowH,
                transform: `translateY(${vi.start}px)`,
                display: "flex",
                gap: GAP,
              }}
            >
              {Array.from({ length: cols }, (_, c) => {
                const idx = vi.index * cols + c;
                const r = rows[idx];
                if (!r) return null;
                const isDup = r[6] !== "" && dupSet.has(r[6]);
                return (
                  <button
                    key={r[0]}
                    onClick={() => onOpen(idx)}
                    className="group cursor-pointer text-left"
                    style={{ width: colW }}
                  >
                    <ThumbImage
                      fileId={r[0]}
                      alt={r[1]}
                      style={{ height: imgH }}
                      className={`w-full rounded-md border transition-colors ${isDup ? "border-danger/50" : "border-[#262626] group-hover:border-[#404040]"}`}
                    />
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[#666] group-hover:text-[#a1a1a1]" title={r[1]}>
                        {isDup && <span className="mr-1 inline-block h-[5px] w-[5px] rounded-full bg-danger align-middle" />}
                        {r[1]}
                      </span>
                      {badge?.(r) && <span className="shrink-0">{badge(r)}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {rows.length === 0 && (
          <p className="p-10 text-center font-mono text-xs text-[#666]">
            nothing matches — loosen the filters
          </p>
        )}
      </div>
    </div>
  );
}
