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
export function nextSync(cron: string, now = new Date()): Date {
  const parts = cron.trim().split(/\s+/);
  const hours = parts[3]?.split(",").map(Number).filter((n) => !Number.isNaN(n)) ?? [];
  const next = new Date(now);
  next.setSeconds(0, 0);
  if (parts[1] === "*" || hours.length === 0) {
    next.setHours(next.getHours() + 1, 0, 0, 0);
    return next;
  }
  for (let i = 1; i <= 24; i++) {
    const cand = new Date(now.getTime() + i * 3600_000);
    cand.setMinutes(Number(parts[0]) || 0, 0, 0);
    if (hours.includes(cand.getHours())) return cand;
  }
  return new Date(now.getTime() + 3600_000);
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
