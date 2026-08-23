import { useEffect, useState } from "react";
import type { Latest, Row } from "../lib/types";
import { ownerName } from "../lib/data";
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

export function Lightbox({ row, latest, pos, total, onClose, onPrev, onNext }: Props) {
  const [id, name, ext, size, day, who, md5, kind] = row;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onPrev();
      if (e.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, onPrev, onNext]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={name}
    >
      <header
        className="flex items-center justify-between gap-4 border-b border-[#262626] px-5 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-[#ededed]">{name}</p>
          <p className="font-mono text-[10px] text-[#666]">
            {ownerName(latest, who)} · {day} · .{ext} · {fmtB(size)}
            {md5 && (
              <span className="ml-2 text-[#404040]" title={md5}>
                md5 {md5.slice(0, 8)}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded border border-[#262626] px-2.5 py-1 font-mono text-xs text-[#a1a1a1] transition-colors hover:border-[#404040] hover:text-white"
        >
          ESC ✕
        </button>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-6" onClick={(e) => e.stopPropagation()}>
        {kind === "v" ? (
          <p className="font-mono text-sm text-[#666]">video — excluded from dataset counts</p>
        ) : (
          <FullView key={id} fileId={id} alt={name} />
        )}
      </div>

      <footer
        className="flex items-center justify-center gap-4 border-t border-[#262626] px-5 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        <NavBtn label="Previous (←)" onClick={onPrev} disabled={pos <= 0}>
          ‹
        </NavBtn>
        <span className="font-mono text-[11px] tabular-nums text-[#666]">
          {pos + 1} / {total}
        </span>
        <NavBtn label="Next (→)" onClick={onNext} disabled={pos >= total - 1}>
          ›
        </NavBtn>
      </footer>
    </div>
  );
}

/** Full view — object-contain so the WHOLE frame fits, never cropped. */
function FullView({ fileId, alt }: { fileId: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex h-64 w-64 items-center justify-center rounded-lg border border-[#262626] bg-[#0a0a0a] font-mono text-xs text-[#666]">
        preview unavailable
      </div>
    );
  }
  return (
    <img
      src={`https://lh3.googleusercontent.com/d/${fileId}=w1600`}
      alt={alt}
      onError={() => setFailed(true)}
      className="max-h-[72vh] max-w-full rounded-lg border border-[#262626] bg-[#0a0a0a] object-contain"
    />
  );
}

function NavBtn({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="h-8 w-8 rounded border border-[#262626] font-mono text-sm text-[#a1a1a1] transition-colors enabled:hover:border-[#404040] enabled:hover:text-white disabled:opacity-30"
    >
      {children}
    </button>
  );
}
