import { useCallback, useEffect, useState } from "react";
import type { Latest, Row } from "./data";
import { exifOf, megapixels, orientationOf, ownerName } from "./data";
import { fmtB } from "./format";

interface Props {
  row: Row;
  latest?: Latest;
  pos: number;
  total: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  overlay?: React.ReactNode;
}

const EXIT_MS = 300;

type Phase = "entering" | "open" | "closing";

/**
 * Full-screen viewer for EVERY file type in the dataset:
 *  - images (kind "i")  → Google CDN full-size (`lh3 ... =w1600`)
 *  - PDFs (kind "o")    → Google Drive preview iframe + download link
 *  - any other file     → Drive preview iframe (falls back gracefully)
 * Keyboard: ← → navigate, Esc close. Click backdrop to close.
 * Optional `latest` shows the exif metadata panel (web datasets).
 */
export function Lightbox({ row, latest, pos, total, onClose, onPrev, onNext, overlay }: Props) {
  const [id, name, , size] = row;
  const [phase, setPhase] = useState<Phase>("entering");

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

  // keyboard: ← → navigate, Esc close
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
      if (phase === "closing") return;
      if (e.key === "ArrowLeft") onPrev();
      if (e.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, onPrev, onNext, phase, requestClose]);

  const closed = phase === "closing";
  const isImage = row[7] === "i";
  const isPdf = row[7] === "o";
  const previewUrl = isImage
    ? `https://lh3.googleusercontent.com/d/${id}=w1600`
    : `https://drive.google.com/file/d/${id}/preview`;
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${id}`;
  const exif = latest ? exifOf(latest, id) : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm"
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
      <div className="flex h-full flex-col" onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <header className="flex items-center justify-between gap-4 border-b border-[#262626] px-4 py-2.5 sm:px-5">
          <div className="min-w-0">
            <p className="truncate font-mono text-xs text-[#ededed]">{name}</p>
            <p className="font-mono text-[10px] text-[#666]">
              {pos + 1} / {total} · .{row[2]} · {fmtB(size)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-[#262626] px-2.5 py-1 font-mono text-xs text-[#a1a1a1] transition-colors hover:border-[#404040] hover:text-white"
            >
              ⬇ download
            </a>
            <button
              onClick={requestClose}
              aria-label="Close viewer"
              className="rounded border border-[#262626] px-2.5 py-1 font-mono text-xs text-[#a1a1a1] transition-colors hover:border-[#404040] hover:text-white"
            >
              ESC ✕
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col @2xl/lb:flex-row">
          {/* stage */}
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3 sm:p-6">
            {isImage ? (
              <div className="relative">
                <img
                  key={id}
                  src={previewUrl}
                  alt={name}
                  draggable={false}
                  onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0.15")}
                  className="max-h-[70vh] select-none rounded-lg border border-[#262626] bg-[#0a0a0a] object-contain @2xl/lb:max-h-full"
                />
                {overlay && !isPdf && <div className="pointer-events-auto absolute inset-0 rounded-lg">{overlay}</div>}
              </div>
            ) : (
              <iframe
                key={id}
                src={previewUrl}
                title={name}
                className="h-[70vh] w-full max-w-[1100px] rounded-lg border border-[#262626] bg-white @2xl/lb:h-[85vh]"
              />
            )}
          </div>

          {/* metadata panel — only when the dataset supplies `latest` */}
          {exif && (
            <aside className="max-h-[42vh] overflow-y-auto border-t border-[#262626] bg-[#0a0a0a]/60 p-4 @2xl/lb:max-h-none @2xl/lb:w-[19rem] @2xl/lb:border-l @2xl/lb:border-t-0 sm:p-5">
              <MetaBlock label="dimensions">
                <p className="font-mono text-xs tabular-nums text-[#ededed]">
                  {exif.w.toLocaleString()} × {exif.h.toLocaleString()}
                  <span className="ml-2 text-[#666]">{megapixels(exif.w, exif.h).toFixed(1)} MP</span>
                </p>
                <Chip>{orientationOf(exif.w, exif.h)}</Chip>
              </MetaBlock>
              {exif.camera && (
                <MetaBlock label="camera">
                  <p className="text-xs text-[#ededed]">{exif.camera}</p>
                </MetaBlock>
              )}
              <MetaBlock label="uploader">
                <p className="text-xs text-accent">{ownerName(latest!, row[5])}</p>
              </MetaBlock>
              <MetaBlock label="checksum">
                <p className="break-all font-mono text-[10px] leading-4 text-[#666]" title={row[6]}>
                  {row[6] || "—"}
                </p>
              </MetaBlock>
            </aside>
          )}
        </div>

        {/* footer nav */}
        <footer className="flex items-center justify-between border-t border-[#262626] px-4 py-2 font-mono text-[10px] text-[#666]">
          <button onClick={onPrev} disabled={pos <= 0} className="disabled:opacity-30 hover:text-white">
            ← prev
          </button>
          <span>
            {isPdf ? "preview via Google Drive · download for the original" : "Google CDN full size"}
          </span>
          <button onClick={onNext} disabled={pos >= total - 1} className="disabled:opacity-30 hover:text-white">
            next →
          </button>
        </footer>
      </div>
    </div>
  );
}

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
