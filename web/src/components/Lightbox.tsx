import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { Latest, Row } from "../lib/types";
import { exifOf, megapixels, orientationOf, ownerName } from "../lib/data";
import { fmtB } from "../lib/format";

interface Props {
  row: Row;
  latest: Latest;
  pos: number;
  total: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}

const EXIT_MS = 300; // --dur-standard
const ZOOM = 2.25;

type Phase = "entering" | "open" | "closing";

/**
 * Full-screen viewer.
 * Layout adapts to ITS OWN width via container query (@container/lb), not the viewport,
 * so it works embedded or resized. Gestures: swipe ←/→ nav, swipe-↓ dismiss,
 * double-tap/double-click zoom with pan. Keyboard: ← → Esc.
 */
export function Lightbox({ row, latest, pos, total, onClose, onPrev, onNext }: Props) {
  const [id, name, ext, size, day, who, md5, kind] = row;
  const [phase, setPhase] = useState<Phase>("entering");
  const stageRef = useRef<HTMLDivElement>(null);

  // enter → open (rAF so the transition actually runs), close plays exit then reports
  useEffect(() => {
    const raf = requestAnimationFrame(() => setPhase("open"));
    return () => cancelAnimationFrame(raf);
  }, []);
  const requestClose = useCallback(() => {
    setPhase((p) => {
      if (p === "closing") return p;
      setTimeout(onClose, EXIT_MS);
      return "closing";
    });
  }, [onClose]);

  // body scroll lock
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // reset transient gesture/zoom state when navigating between images
  useEffect(() => {
    drag.current = null;
    setZoom(null);
    setPan({ x: 0, y: 0 });
  }, [id]);

  /* ---------------- gestures (pointer events: touch + mouse) ---------------- */

  type Drag = {
    startX: number; startY: number; dx: number; dy: number;
    mode: "undecided" | "swipe-x" | "dismiss" | "pan" | null;
    pointerId: number;
  };
  const drag = useRef<Drag | null>(null);
  const [dragStyle, setDragStyle] = useState<{ tx: number; ty: number; dragging: boolean }>({ tx: 0, ty: 0, dragging: false });
  const [zoom, setZoom] = useState<{ s: number; ox: number; oy: number } | null>(null);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const panLast = useRef<{ x: number; y: number } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    // never hijack clicks meant for controls living inside the stage
    if ((e.target as HTMLElement).closest("button, a, [data-no-gesture]")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag.current = { startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, mode: "undecided", pointerId: e.pointerId };
    if (zoom) panLast.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    d.dx = e.clientX - d.startX;
    d.dy = e.clientY - d.startY;

    if (d.mode === "undecided") {
      const adx = Math.abs(d.dx), ady = Math.abs(d.dy);
      if (Math.max(adx, ady) < 8) return;
      // zoomed: any real drag becomes a pan; otherwise classify the swipe
      d.mode = zoom ? "pan" : adx > ady ? "swipe-x" : d.dy > 0 && ady > adx * 1.3 ? "dismiss" : null;
    }
    if (d.mode === "swipe-x") setDragStyle({ tx: d.dx * 0.55, ty: 0, dragging: true });
    else if (d.mode === "dismiss") setDragStyle({ tx: 0, ty: Math.max(0, d.dy) * 0.6, dragging: true });
    else if (d.mode === "pan") {
      // clamp so the image can't be dragged past its own edges
      if (!panLast.current) return;
      const rect = stageRef.current?.getBoundingClientRect();
      const maxX = rect ? (rect.width * (ZOOM - 1)) / 2 : 200;
      const maxY = rect ? (rect.height * (ZOOM - 1)) / 2 : 200;
      setPan({
        x: Math.max(-maxX, Math.min(maxX, pan.x + (e.clientX - panLast.current.x))),
        y: Math.max(-maxY, Math.min(maxY, pan.y + (e.clientY - panLast.current.y))),
      });
      panLast.current = { x: e.clientX, y: e.clientY };
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.pointerId !== e.pointerId) return;

    if (d.mode === "swipe-x") {
      const w = stageRef.current?.clientWidth ?? 1;
      const velocityOk = Math.abs(d.dx) > w * 0.22 || Math.abs(d.dx) > 90;
      setDragStyle({ tx: 0, ty: 0, dragging: false });
      if (velocityOk) {
        d.dx < 0 ? onNext() : onPrev();
        return;
      }
    } else if (d.mode === "dismiss") {
      setDragStyle({ tx: 0, ty: 0, dragging: false });
      if (d.dy > 110) {
        requestClose();
        return;
      }
    } else if (d.mode === "undecided") {
      // tap candidate → double-tap zoom
      panLast.current = null;
      const now = Date.now();
      const lt = lastTap.current;
      if (lt && now - lt.t < 320 && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < 28) {
        lastTap.current = null;
        const rect = stageRef.current?.getBoundingClientRect();
        if (rect) {
          if (zoom) {
            // already zoomed → this double-tap un-zooms
            setZoom(null);
            setPan({ x: 0, y: 0 });
          } else {
            setZoom({
              s: ZOOM,
              ox: Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)),
              oy: Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100)),
            });
          }
        }
        return;
      }
      lastTap.current = { t: now, x: e.clientX, y: e.clientY };
    }
    setDragStyle((s) => ({ ...s, dragging: false }));
  };

  /* ---------------- keyboard ---------------- */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
      if (phase === "closing") return;
      if (e.key === "ArrowLeft" && !zoom) onPrev();
      if (e.key === "ArrowRight" && !zoom) onNext();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, onPrev, onNext, phase, zoom, requestClose]);

  const exif = exifOf(latest, id);

  const closed = phase === "closing";

  return (
    <div
      className={`fixed inset-0 z-50 bg-black/95 backdrop-blur-sm transition-opacity ${closed ? "" : ""}`}
      style={{
        opacity: phase === "entering" ? 0 : undefined,
        transition: `opacity var(--dur-standard) var(--ease-${closed ? "exit" : "signature"})`,
        pointerEvents: closed ? "none" : undefined,
      }}
      onClick={requestClose}
      role="dialog"
      aria-modal="true"
      aria-label={name}
    >
      {/* @container/lb: layout responds to overlay width, not viewport */}
      <div
        className="@container/lb flex h-full flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <header className="flex items-center justify-between gap-4 border-b border-[#262626] px-4 py-2.5 sm:px-5">
          <div className="min-w-0">
            <p className="truncate font-mono text-xs text-[#ededed]">{name}</p>
            <p className="font-mono text-[10px] text-[#666]">
              {pos + 1} / {total} · .{ext} · {fmtB(size)}
            </p>
          </div>
          <button
            onClick={requestClose}
            aria-label="Close viewer"
            className="shrink-0 rounded border border-[#262626] px-2.5 py-1 font-mono text-xs text-[#a1a1a1] transition-colors hover:border-[#404040] hover:text-white"
          >
            ESC ✕
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col @2xl/lb:flex-row">
          {/* stage — owns gestures */}
          <div
            ref={stageRef}
            className="relative flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden p-3 sm:p-6"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => (drag.current = null)}
          >
            <div
              className="flex max-h-full max-w-full items-center justify-center"
              style={{
                transform: `translate(${dragStyle.tx}px, ${dragStyle.ty}px)`,
                transition: dragStyle.dragging ? "none" : `transform var(--dur-quick) var(--ease-signature)`,
                opacity: Math.max(0.35, 1 - (Math.abs(dragStyle.tx) + Math.abs(dragStyle.ty)) / 420),
                cursor: zoom ? "grab" : "default",
              }}
            >
              {kind === "v" ? (
                <p className="px-6 text-center font-mono text-sm text-[#666]">video — excluded from dataset counts</p>
              ) : (
                <img
                  key={id}
                  src={`https://lh3.googleusercontent.com/d/${id}=w1600`}
                  alt={name}
                  draggable={false}
                  onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0.15")}
                  className="max-h-[62vh] select-none rounded-lg border border-[#262626] bg-[#0a0a0a] object-contain @2xl/lb:max-h-full"
                  style={
                    zoom
                      ? {
                          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom.s})`,
                          transformOrigin: `${zoom.ox}% ${zoom.oy}%`,
                          transition: dragStyle.dragging ? "none" : `transform var(--dur-standard) var(--ease-signature)`,
                        }
                      : undefined
                  }
                />
              )}
            </div>

            {/* nav arrows (desktop affordance; swipe is primary on touch) */}
            <NavArrow side="left" disabled={pos <= 0} onClick={onPrev} />
            <NavArrow side="right" disabled={pos >= total - 1} onClick={onNext} />

            {/* gesture hint */}
            <p className="pointer-events-none absolute bottom-2 left-1/2 hidden -translate-x-1/2 font-mono text-[9px] tracking-wider text-[#404040] sm:block">
              swipe ‹ › · double-tap zoom · ↓ dismiss
            </p>
          </div>

          {/* metadata panel — beside image when the overlay itself is wide */}
          <aside
            className={`max-h-[42vh] overflow-y-auto border-t border-[#262626] bg-[#0a0a0a]/60 p-4 @2xl/lb:max-h-none @2xl/lb:w-[19rem] @2xl/lb:border-l @2xl/lb:border-t-0 sm:p-5 ${
              closed ? "opacity-0 translate-y-1" : "opacity-100 translate-y-0"
            }`}
            style={{ transition: `opacity var(--dur-standard) var(--ease-${closed ? "exit" : "enter"}), transform var(--dur-standard) var(--ease-${closed ? "exit" : "enter"})` }}
          >
            <MetaBlock label="file">
              <p className="break-all font-mono text-xs leading-5 text-white">{name}</p>
            </MetaBlock>

            {exif && (
              <>
                <MetaBlock label="dimensions">
                  <p className="font-mono text-xs tabular-nums text-[#ededed]">
                    {exif.w.toLocaleString()} × {exif.h.toLocaleString()}
                    <span className="ml-2 text-[#666]">{megapixels(exif.w, exif.h).toFixed(1)} MP</span>
                  </p>
                  <Chip>{orientationOf(exif.w, exif.h)}</Chip>
                </MetaBlock>
                <MetaBlock label="camera">
                  <p className={`text-xs ${exif.camera ? "text-[#ededed]" : "text-[#666]"}`}>
                    {exif.camera ?? "unknown"}
                  </p>
                </MetaBlock>
              </>
            )}

            <MetaBlock label="uploaded">
              <p className="font-mono text-xs tabular-nums text-[#ededed]">{day}</p>
            </MetaBlock>

            <MetaBlock label="uploader">
              <Link
                to="/contributors/$email"
                params={{ email: encodeURIComponent(who) }}
                className="text-xs text-accent hover:underline"
              >
                {ownerName(latest, who)} →
              </Link>
            </MetaBlock>

            <MetaBlock label="checksum">
              <div className="flex items-start justify-between gap-2">
                <p className="break-all font-mono text-[10px] leading-4 text-[#666]" title={md5}>
                  {md5 || "—"}
                </p>
                {md5 && <CopyBtn value={md5} label="copy md5" />}
              </div>
            </MetaBlock>

            <MetaBlock label="links">
              <div className="flex gap-2">
                <ExtLink href={`https://drive.google.com/file/d/${id}/view`}>Drive ↗</ExtLink>
                <ExtLink href={`https://drive.google.com/uc?export=download&id=${id}`}>download ⬇</ExtLink>
              </div>
            </MetaBlock>

            {md5 && (
              <Link
                to="/gallery"
                search={{ md5 }}
                className="mt-1 inline-block rounded border border-accent/40 px-2.5 py-1 font-mono text-[10px] text-accent transition-colors hover:bg-accent hover:text-white"
              >
                find duplicates of this file →
              </Link>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

/* ---------------- pieces ---------------- */

function MetaBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <dt className="mb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[#666]">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-0 mt-1 inline-block rounded border border-[#262626] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[#a1a1a1]">
      {children}
    </span>
  );
}

function CopyBtn({ value, label }: { value: string; label: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      aria-label={label}
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => {
            setOk(true);
            setTimeout(() => setOk(false), 1200);
          },
          () => {},
        );
      }}
      className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] transition-colors ${
        ok ? "border-[#0cce6b] text-[#0cce6b]" : "border-[#262626] text-[#666] hover:border-[#404040] hover:text-[#a1a1a1]"
      }`}
    >
      {ok ? "✓ copied" : "copy"}
    </button>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded border border-[#262626] px-2 py-1 font-mono text-[10px] text-[#a1a1a1] transition-colors hover:border-[#404040] hover:text-white"
    >
      {children}
    </a>
  );
}

function NavArrow({
  side,
  onClick,
  disabled,
}: {
  side: "left" | "right";
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      aria-label={side === "left" ? "Previous image" : "Next image"}
      onClick={onClick}
      disabled={disabled}
      className={`absolute top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-[#262626] bg-black/60 font-mono text-base text-[#ededed] backdrop-blur transition-all enabled:hover:border-[#404040] enabled:hover:bg-black/80 disabled:opacity-25 sm:flex ${
        side === "left" ? "left-3" : "right-3"
      }`}
    >
      {side === "left" ? "‹" : "›"}
    </button>
  );
}
