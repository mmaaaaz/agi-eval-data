interface Props {
  n: string;
  children: string;
}

/** Numbered section eyebrow — the one true section header, site-wide. */
export function Eyebrow({ n, children }: Props) {
  return (
    <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-[#666]">
      <span className="text-accent">{n}</span> — {children}
    </p>
  );
}
