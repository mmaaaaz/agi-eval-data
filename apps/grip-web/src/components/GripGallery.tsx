import { useEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { GripThumb } from "./GripThumb";
import { gripImageUrl } from "../lib/gripImage";
import type { Sample } from "../lib/gripTypes";

const MIN_COL = 168;
const GAP = 8;
const CAPTION = 44;

interface Props {
  samples: Sample[];
  onOpen: (sample: Sample) => void;
  /** optional right-side caption node (e.g. edited badge) */
  badge?: (sample: Sample) => ReactNode;
}

/** Windowed responsive sample grid — same math as @site VirtualGallery,
 *  typed against grip Sample rows instead of Drive 8-tuples.
 *  Handles 3,000 (per category) to 100,000 (global browse) rows smoothly.
 *
 *  Height strategy: virtualizers need a scroll viewport with a real height.
 *  Rather than depending on flex ancestors, the container measures itself and
 *  caps at the viewport, so it works wherever it's mounted. */
export function GripGallery({ samples, onOpen, badge }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const measure = () => {
      setWidth(el.clientWidth);
      const cap = Math.max(360, window.innerHeight - 260); // viewport minus chrome
      setHeight(Math.min(cap, Math.max(360, el.clientHeight)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const cols = Math.max(2, Math.floor((width - GAP) / (MIN_COL + GAP)) || 2);
  const colW = width ? Math.floor((width - GAP * (cols - 1)) / cols) : MIN_COL;
  const imgH = Math.round(colW * 0.9); // grip images are ~square
  const rowH = imgH + CAPTION + GAP;
  const rowCount = Math.ceil(samples.length / cols);

  const virt = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowH,
    overscan: 4,
    getItemKey: (i) => samples[i * cols]?.id ?? `r${i}`,
  });

  return (
    <div className="flex flex-col" style={{ height: height || 480 }}>
      <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto px-1">
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
                const s = samples[idx];
                if (!s) return null;
                return (
                  <button
                    key={s.id + s.sub}
                    onClick={() => onOpen(s)}
                    className="group cursor-pointer text-left"
                    style={{ width: colW }}
                  >
                    <GripThumb
                      src={gripImageUrl(s.img)}
                      alt={s.id}
                      className={`h-auto w-full rounded-md border transition-colors ${
                        s.legacy ? "border-[#3a2f14]" : "border-[#262626] group-hover:border-[#404040]"
                      }`}
                    />
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[#666] group-hover:text-[#a1a1a1]" title={s.id}>
                        {s.id}
                      </span>
                      {badge?.(s)}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
