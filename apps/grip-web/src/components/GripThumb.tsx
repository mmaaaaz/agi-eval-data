import { useState } from "react";

const FILM_SVG = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#404040" strokeWidth="1.5">
    <path d="M6 26 L16 6 L26 26 Z" fill="none" stroke="#404040" strokeWidth="1.5" />
  </svg>
);

interface Props {
  /** full image URL (media host for grip) */
  src: string;
  alt: string;
  eager?: boolean;
  className?: string;
}

/** Upstream-hosted thumbnail with the same shimmer → fade → placeholder
 *  lifecycle as @site ThumbImage, but host-agnostic (src prop). */
export function GripThumb({ src, alt, eager = false, className = "" }: Props) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (!src || failed) {
    return (
      <div className={`flex items-center justify-center border border-[#262626] bg-[#0a0a0a] ${className}`}>
        {FILM_SVG}
      </div>
    );
  }
  return (
    <div className={`relative overflow-hidden bg-[#0a0a0a] ${className}`}>
      {!loaded && (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-[#0a0a0a] via-[#161616] to-[#0a0a0a]" />
      )}
      <img
        src={src}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={`h-full w-full object-contain transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}
