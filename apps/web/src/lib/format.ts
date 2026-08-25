export function fmtN(n: number): string {
  return n.toLocaleString("en-US");
}

export function fmtB(bytes: number): string {
  let b = bytes;
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) {
    b /= 1024;
    i++;
  }
  return `${b.toFixed(1)} ${u[i]}`;
}

export function timeAgo(iso: string): string {
  const then = Date.parse(iso.endsWith("Z") ? iso : `${iso}Z`);
  if (Number.isNaN(then)) return "—";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `${h}h ${m}m ago` : `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Next run time for cron strings of shape "0 * * * *" or "0 H,H,H * * *". */
/** Next cron slot strictly after `after`, honouring hourly or fixed-hour lists. */
export function nextSlotAfter(cron: string, after: Date): Date {
  const parts = cron.trim().split(/\s+/);
  const minutes = Number(parts[0]) || 0;
  const hours = parts[1] === "*" ? null : parts[1].split(",").map(Number).filter((n) => !Number.isNaN(n));
  if (!hours || hours.length === 0) {
    const d = new Date(after);
    d.setHours(d.getHours() + 1, minutes, 0, 0);
    return d;
  }
  for (let i = 0; i < 48; i++) {
    const cand = new Date(after.getTime() + i * 3600_000);
    cand.setMinutes(minutes, 0, 0);
    if (hours.includes(cand.getHours()) && cand > after) return cand;
  }
  return new Date(after.getTime() + 3600_000);
}

export function tzShort(): string {
  try {
    const offMin = -new Date().getTimezoneOffset();
    const sign = offMin >= 0 ? "+" : "-";
    const abs = Math.abs(offMin);
    return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  } catch {
    return "UTC";
  }
}
