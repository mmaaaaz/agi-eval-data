/** Shared building blocks for the open-models pages (dark, instrument-panel look). */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Eyebrow } from "@site/section";

export { Eyebrow };

/* ------------------------------------------------------------------ layout --- */

export function Section({
  eyebrow,
  title,
  hint,
  right,
  children,
  id,
}: {
  eyebrow?: string;
  title?: string;
  hint?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="pt-10 first:pt-0 sm:pt-14">
      {(eyebrow || title || right) && (
        <header className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div>
            {eyebrow && <Eyebrow n={eyebrow.split(" ")[0]}>{eyebrow.replace(/^\S+\s*/, "")}</Eyebrow>}
            {title && <h2 className="text-lg font-medium tracking-tight text-white sm:text-xl">{title}</h2>}
            {hint && <p className="mt-1.5 max-w-[92ch] text-[13px] leading-relaxed text-[#a1a1a1]">{hint}</p>}
          </div>
          {right && <div className="flex items-center gap-2">{right}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Panel({ children, className = "", tag }: { children: ReactNode; className?: string; tag?: string }) {
  return (
    <div className={"relative overflow-hidden rounded-lg border border-[#262626] bg-[#0a0a0a] " + className}>
      {tag && (
        <span className="absolute right-3 top-3 z-10 font-mono text-[9px] uppercase tracking-widest text-[#666]">{tag}</span>
      )}
      {children}
    </div>
  );
}

/** A grid of hairline-separated tiles - the site's stat strip. */
export function TileGrid({ children, cols = 4 }: { children: ReactNode; cols?: 2 | 3 | 4 | 5 | 6 }) {
  const cls =
    cols === 2 ? "sm:grid-cols-2" : cols === 3 ? "sm:grid-cols-3" : cols === 5 ? "sm:grid-cols-3 lg:grid-cols-5" : cols === 6 ? "sm:grid-cols-3 lg:grid-cols-6" : "sm:grid-cols-2 lg:grid-cols-4";
  return (
    <div className={"grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#262626] bg-[#262626] " + cls}>
      {children}
    </div>
  );
}

export function Tile({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: string }) {
  return (
    <div className="bg-black p-3.5 sm:p-4">
      <p className="font-mono text-[9px] uppercase tracking-widest text-[#666]">{label}</p>
      <p className="t-num mt-1.5 text-xl font-semibold tabular-nums tracking-tight sm:text-2xl" style={{ color: accent ?? "#fff" }}>
        {value}
      </p>
      {sub && <p className="mt-1 font-mono text-[10px] leading-relaxed text-[#666]">{sub}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ atoms --- */

export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <span className="inline-block flex-none rounded-full" style={{ background: color, width: size, height: size }} />;
}

export function Chip({
  children,
  active,
  onClick,
  title,
  tone = "neutral",
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  title?: string;
  tone?: "neutral" | "warn" | "ok";
}) {
  const toneCls =
    tone === "warn"
      ? "border-[#4a2b2b] text-[#f0a5a5]"
      : tone === "ok"
        ? "border-[#25402f] text-[#9fd8b4]"
        : "border-[#262626] text-[#a1a1a1]";
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      aria-pressed={active}
      className={
        "rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors " +
        (active ? "border-accent bg-accent/15 text-white" : toneCls + " hover:border-[#404040] hover:text-white")
      }
    >
      {children}
    </button>
  );
}

export function Seg<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {label && <span className="font-mono text-[9px] uppercase tracking-widest text-[#666]">{label}</span>}
      <div className="inline-flex rounded-md border border-[#262626] bg-[#0a0a0a] p-0.5">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            title={o.hint}
            onClick={() => onChange(o.id)}
            aria-pressed={value === o.id}
            className={
              "rounded px-2.5 py-1 font-mono text-[10px] transition-colors " +
              (value === o.id ? "bg-[#1c1c1c] text-white" : "text-[#666] hover:text-[#a1a1a1]")
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className="w-44 rounded-md border border-[#262626] bg-[#0a0a0a] px-2.5 py-1.5 font-mono text-[11px] text-white outline-none transition-colors placeholder:text-[#555] focus:border-[#404040] sm:w-56"
    />
  );
}

/* --------------------------------------------------------------- data bits --- */

/** Accuracy figure with its 95% Wilson interval as a hairline whisker. */
export function AccValue({
  value,
  ci,
  color,
  size = "md",
  width = 74,
  digits = 2,
}: {
  value: number | null;
  ci?: [number, number];
  color?: string;
  size?: "sm" | "md" | "lg" | "xl";
  width?: number;
  digits?: number;
}) {
  const cls =
    size === "xl"
      ? "text-4xl sm:text-5xl"
      : size === "lg"
        ? "text-2xl sm:text-3xl"
        : size === "md"
          ? "text-base"
          : "text-xs";
  const lo = ci ? Math.max(0, ci[0] - 0.02) : 0;
  const hi = ci ? Math.min(1, ci[1] + 0.02) : 1;
  return (
    <div className="flex items-baseline gap-2">
      <span className={"t-num font-mono font-semibold tabular-nums tracking-tight " + cls} style={color ? { color } : undefined}>
        {value == null ? "—" : (value * 100).toFixed(digits)}
        <span className={"font-normal text-[#666] " + (size === "xl" ? "text-lg" : "text-[10px]")}>%</span>
      </span>
      {ci && (
        <svg width={width} height={10} viewBox={"0 0 " + width + " 10"} className="flex-none opacity-70" aria-hidden>
          <line x1={2} x2={width - 2} y1="5" y2="5" stroke="#404040" strokeWidth="1" />
          <line x1={2 + lo * (width - 4)} x2={2 + hi * (width - 4)} y1="5" y2="5" stroke={color ?? "#8b5cf6"} strokeWidth="2.5" />
          <line x1={2 + value! * (width - 4)} x2={2 + value! * (width - 4)} y1="1.5" y2="8.5" stroke={color ?? "#8b5cf6"} strokeWidth="1.5" />
        </svg>
      )}
    </div>
  );
}

/** Horizontal bar with an optional oracle tick - the table's workhorse. */
export function Bar({
  value,
  oracle,
  color,
  max = 1,
  height = 6,
  showOracle = true,
}: {
  value: number | null;
  oracle?: number | null;
  color: string;
  max?: number;
  height?: number;
  showOracle?: boolean;
}) {
  const w = value == null ? 0 : Math.max(0, Math.min(1, value / max)) * 100;
  const o = oracle == null ? null : Math.max(0, Math.min(1, oracle / max)) * 100;
  return (
    <div className="relative w-full overflow-hidden rounded-sm bg-[#141414]" style={{ height }}>
      <div className="h-full rounded-sm transition-[width] duration-300" style={{ width: w + "%", background: color }} />
      {showOracle && o != null && (
        <span className="absolute top-0 h-full w-px bg-[#8a8a8a]" style={{ left: o + "%" }} aria-hidden />
      )}
    </div>
  );
}

/** Score composition: correct / partial-only / wrong, as one stacked line. */
export function Composition({
  correct,
  partial,
  n,
  color,
}: {
  correct: number;
  partial: number;
  n: number;
  color: string;
}) {
  if (!n) return null;
  const c = (correct / n) * 100;
  const p = (Math.max(partial, correct) / n) * 100;
  return (
    <div className="relative h-[5px] w-full overflow-hidden rounded-sm bg-[#141414]">
      <span className="absolute inset-y-0 left-0 rounded-sm opacity-35" style={{ width: p + "%", background: color }} />
      <span className="absolute inset-y-0 left-0 rounded-sm" style={{ width: c + "%", background: color }} />
    </div>
  );
}

export function Legend({ items }: { items: { color: string; label: string; dash?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5 font-mono text-[10px] text-[#a1a1a1]">
          <span
            className="inline-block h-[3px] w-4 rounded-full"
            style={{ background: i.dash ? "repeating-linear-gradient(90deg,#666 0 3px,transparent 3px 6px)" : i.color }}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-10 text-center font-mono text-xs text-[#666]">{children}</p>;
}

export function DomainLink({ slug, label, color }: { slug: string; label: string; color?: string }) {
  return (
    <Link
      to="/open-models/domains/$slug"
      params={{ slug }}
      className="group inline-flex items-center gap-1.5 text-[#ededed] transition-colors hover:text-accent"
    >
      <span className="underline decoration-[#333] underline-offset-2 group-hover:decoration-accent">{label}</span>
      {color && <span className="opacity-0 transition-opacity group-hover:opacity-100" style={{ color }}>→</span>}
    </Link>
  );
}
