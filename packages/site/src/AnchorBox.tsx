import { useCallback, useRef, useState } from "react";

/**
 * Drag a box on the image to mark the ANCHOR — the single object a question is about.
 *
 * Why this exists rather than a coordinate field: a paired diagnostic is only
 * meaningful if both probes refer to the same thing, and "the yellow forklift" is
 * ambiguous to two annotators and to a reviewer. A box removes the ambiguity and
 * gives the release a grounding reference for free.
 *
 * Coordinates are stored in ORIGINAL-image pixels, scaled from the rendered size at
 * the moment of the drag. That is why the image is rendered at its natural aspect
 * with `w-full h-auto` and no object-fit: nothing is cropped or letterboxed, so the
 * mapping is a single linear scale and the box cannot shift when the layout changes.
 */

export type Box = [number, number, number, number];

export function parseBox(raw: string | null | undefined): Box | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === "number" && Number.isFinite(n))) {
      return [v[0], v[1], v[2], v[3]] as Box;
    }
  } catch { /* not a box */ }
  return null;
}

export function AnchorBox({
  fileId,
  value,
  onChange,
}: {
  fileId: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  const box = parseBox(value);

  /** Pointer position in the image's own pixel space. */
  const toNatural = useCallback((e: React.PointerEvent): { x: number; y: number } | null => {
    const img = imgRef.current;
    if (!img || !natural) return null;
    const r = img.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    const x = ((e.clientX - r.left) / r.width) * natural.w;
    const y = ((e.clientY - r.top) / r.height) * natural.h;
    return {
      x: Math.max(0, Math.min(natural.w, x)),
      y: Math.max(0, Math.min(natural.h, y)),
    };
  }, [natural]);

  const onDown = (e: React.PointerEvent) => {
    const p = toNatural(e);
    if (!p) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = toNatural(e);
    if (!p) return;
    setDrag({ ...drag, x1: p.x, y1: p.y });
  };

  const onUp = () => {
    if (!drag) return;
    const x1 = Math.round(Math.min(drag.x0, drag.x1));
    const y1 = Math.round(Math.min(drag.y0, drag.y1));
    const x2 = Math.round(Math.max(drag.x0, drag.x1));
    const y2 = Math.round(Math.max(drag.y0, drag.y1));
    setDrag(null);
    // A stray click is not a box. 12 px in the image's own space is the floor.
    if (x2 - x1 < 12 || y2 - y1 < 12) return;
    onChange(JSON.stringify([x1, y1, x2, y2]));
  };

  /** The live rect, in rendered coordinates, for drawing. */
  const shown = drag ?? (box ? { x0: box[0], y0: box[1], x1: box[2], y1: box[3] } : null);
  const rect = (() => {
    const img = imgRef.current;
    if (!shown || !img || !natural) return null;
    const r = img.getBoundingClientRect();
    const sx = r.width / natural.w;
    const sy = r.height / natural.h;
    return {
      left: Math.min(shown.x0, shown.x1) * sx,
      top: Math.min(shown.y0, shown.y1) * sy,
      width: Math.abs(shown.x1 - shown.x0) * sx,
      height: Math.abs(shown.y1 - shown.y0) * sy,
    };
  })();

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          anchor {box ? <span className="text-[#0cce6b]">set</span> : <span className="text-[#f59e0b]">not set</span>}
        </span>
        {box && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="font-mono text-[10px] text-muted-foreground transition-colors hover:text-danger"
          >
            clear
          </button>
        )}
      </div>
      <div className="relative overflow-hidden rounded-md border border-[#262626] bg-[#050505]">
        <img
          ref={imgRef}
          src={"https://lh3.googleusercontent.com/d/" + fileId + "=w1600"}
          alt="mark the object these questions are about"
          draggable={false}
          onLoad={(e) => {
            const el = e.currentTarget;
            setNatural({ w: el.naturalWidth, h: el.naturalHeight });
          }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          className="block h-auto w-full cursor-crosshair select-none"
          style={{ touchAction: "none" }}
        />
        {rect && (
          <div
            className="pointer-events-none absolute border-2 border-accent bg-accent/10"
            style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
          />
        )}
      </div>
      <span className="mt-1 block font-mono text-[10px] leading-4 text-[#666]">
        {box
          ? "[" + box.join(", ") + "] in original pixels — both probes of a pair must share it"
          : "drag a rectangle over the object the questions are about"}
      </span>
    </div>
  );
}
