import { useCallback, useEffect, useState } from "react";
import type { Row } from "@metro/shared/types";
import { cityName, countryOf } from "../lib/data";
import { fmtB } from "../lib/format";

interface Props {
  row: Row;
  pos: number;
  total: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}

const EXIT_MS = 300;

type Phase = "entering" | "open" | "closing";

/**
 * Full-screen viewer for EVERY file type in the metro dataset:
 *  - images (kind "i")  → Google CDN full-size (`lh3 ... =w1600`)
 *  - PDFs (kind "o")    → Google Drive preview iframe + download link
 *  - any other file     → Drive preview iframe (falls back gracefully)
 * Keyboard: ← → navigate, Esc close. Click backdrop to close.
 */
export function Lightbox({ row, pos, total, onClose, onPrev, onNext }: Props) {
  const [id, name, , size] = row;
  const [phase, setPhase] = useState<Phase>("entering");

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

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

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
              {pos + 1} / {total} · {cityName(row) || countryOf(row) || "—"} · {fmtB(size)}
              {isPdf ? " · pdf" : isImage ? ` · .${row[2]}` : ""}
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
              <img
                key={id}
                src={previewUrl}
                alt={name}
                draggable={false}
                onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0.15")}
                className="max-h-[70vh] select-none rounded-lg border border-[#262626] bg-[#0a0a0a] object-contain @2xl/lb:max-h-full"
              />
            ) : (
              <iframe
                key={id}
                src={previewUrl}
                title={name}
                className="h-[70vh] w-full max-w-[1100px] rounded-lg border border-[#262626] bg-white @2xl/lb:h-[85vh]"
              />
            )}
          </div>
        </div>

        {/* footer nav hint */}
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
