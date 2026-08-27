import { useState, type CSSProperties } from "react";

const FILM_SVG = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#404040" strokeWidth="1.5">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 8h18M3 16h18M8 3v18M16 3v18" opacity="0.5" />
  </svg>
);

interface Props {
  fileId: string;
  w?: 400 | 1600;
  alt: string;
  eager?: boolean;
  className?: string;
  style?: CSSProperties;
  /** "o" = PDF: Google renders the first page via its thumbnail endpoint */
  kind?: "i" | "o";
}

/** Google-CDN hotlinked thumbnail with shimmer → fade → placeholder lifecycle.
 *  PDFs (kind "o") use Google's thumbnail endpoint — verified to render the
 *  PDF's first page as a PNG. */
export function ThumbImage({ fileId, w = 400, alt, eager = false, className = "", style, kind = "i" }: Props) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const src = kind === "o"
    ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w${w}`
    : `https://lh3.googleusercontent.com/d/${fileId}=w${w}`;

  if (failed) {
    return (
      <div style={style} className={`flex items-center justify-center border border-[#262626] bg-[#0a0a0a] ${className}`}>
        {FILM_SVG}
      </div>
    );
  }
  return (
    <div style={style} className={`relative overflow-hidden bg-[#0a0a0a] ${className}`}>
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
        className={`h-full w-full object-cover transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}
