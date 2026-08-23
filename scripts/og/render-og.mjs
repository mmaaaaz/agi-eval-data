#!/usr/bin/env node
/**
 * Render the full OG card set with Takumi (no headless browser):
 *   og/overview.png  og/gallery.png  og/composition.png  og/contributors.png
 *   og/duplicates.png  og/project.png  og/contributors/{email}.png
 *
 * Run in the hourly sync workflow after data/latest.json is written, so every
 * card repaints exactly when stats change. Served via raw.githubusercontent.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Renderer } from "@takumi-rs/core";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const data = JSON.parse(readFileSync(join(root, "data", "latest.json"), "utf-8"));
const c = data.meta.counts;
const DOMAIN = "agi-eval-data.pages.dev";

/* ---------- fonts (committed — CI never touches the network for type) ---------- */
const renderer = new Renderer();
const font = (file, weight) => ({ name: "Geist", data: readFileSync(join(here, "fonts", file)), weight });
await renderer.registerFont(font("Geist-Regular.ttf", 400));
await renderer.registerFont(font("Geist-SemiBold.ttf", 600));
await renderer.registerFont(font("Geist-Bold.ttf", 700));

/* ---------- design tokens (mirror the site) ---------- */
const T = {
  bg: "#050505", grid: "#0d0d0d", line: "#262626", panel: "#0a0a0a",
  ink: "#ededed", sub: "#a1a1a1", dim: "#666666", faint: "#404040",
  accent: "#0070f3", accentSoft: "#66aaff", danger: "#ee0000",
};
const TRIANGLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="64" viewBox="0 0 72 64"><path d="M36 3 L69 61 L3 61 Z" fill="none" stroke="#ededed" stroke-width="4"/><circle cx="36" cy="49" r="6" fill="#0070f3"/></svg>`;
const images = [{ src: "triangle", data: new TextEncoder().encode(TRIANGLE_SVG) }];

/* ---------- node builders ---------- */
const box = (style, children = []) => ({ type: "container", style, children });
const abs = (pos, style, children = []) => box({ position: "absolute", ...pos, ...style }, children);
const txt = (text, style) => ({ type: "text", text, style });

function gridLines() {
  const g = [];
  for (let x = 60; x < 1200; x += 60) g.push(abs({ left: x, top: 0 }, { width: 1, height: 630, backgroundColor: T.grid }));
  for (let y = 60; y < 630; y += 60) g.push(abs({ top: y, left: 0 }, { height: 1, width: 1200, backgroundColor: T.grid }));
  return g;
}

function chip(value, label, accent = T.accent) {
  return box(
    {
      display: "flex", flexDirection: "row", alignItems: "center", gap: 14,
      padding: "13px 20px", borderRadius: 10,
      borderWidth: 2, borderColor: T.line, backgroundColor: T.panel,
    },
    [txt(value, { color: accent, fontSize: 25, fontWeight: 700 }), txt(label, { color: T.dim, fontSize: 19 })],
  );
}

function chrome({ eyebrow, accent = T.accent }) {
  return [
    // header: mark + wordmark
    abs({ left: 90, top: 56 }, { display: "flex", flexDirection: "row", alignItems: "center", gap: 18 }, [
      { type: "image", src: "triangle", style: { width: 44, height: 39 } },
      txt("agi-eval-data", { color: T.dim, fontSize: 22 }),
    ]),
    // eyebrow + safelight
    txt(eyebrow, { position: "absolute", right: 130, top: 62, color: accent, fontSize: 20, letterSpacing: 6 }),
    abs({ right: 86, top: 62 }, { width: 22, height: 22, borderRadius: 11, backgroundColor: T.danger }),
    // bottom bar
    abs({ left: 0, bottom: 0 }, { width: 1200, height: 4, backgroundColor: accent }),
    abs({ left: 90, bottom: 34 }, { display: "flex", flexDirection: "row", gap: 24, alignItems: "center" }, [
      txt(DOMAIN, { color: T.faint, fontSize: 19 }),
      txt(`synced ${data.meta.scannedAt} · hourly`, { color: T.faint, fontSize: 19 }),
    ]),
  ];
}

function titleBlock(title, sub, top = 208) {
  return abs(
    { left: 90, top, right: 90 },
    { display: "flex", flexDirection: "column", gap: 18 },
    [
      txt(title, { color: T.ink, fontSize: title.length > 26 ? 58 : 68, fontWeight: 700, letterSpacing: -1.5 }),
      ...(sub ? [txt(sub, { color: T.sub, fontSize: 30 })] : []),
    ],
  );
}

function chipsRow(chips, bottom = 120) {
  return abs(
    { left: 90, bottom },
    { display: "flex", flexDirection: "row", gap: 20 },
    chips,
  );
}

function cardShell(children) {
  return box(
    { width: 1200, height: 630, position: "relative", backgroundColor: T.bg, fontFamily: "Geist" },
    [...gridLines(), ...children],
  );
}

/* ---------- per-owner stats ---------- */
const owners = Object.keys(data.owners).map((email) => {
  const theirs = data.files.filter((r) => r[5] === email && r[7] === "i");
  const uniq = new Set(theirs.map((r) => r[6]).filter(Boolean));
  let lastDay = "", lastId = "";
  for (const r of theirs) if (r[4] > lastDay) { lastDay = r[4]; lastId = r[0]; }
  return {
    email, name: data.owners[email] ?? email,
    raw: theirs.length, unique: uniq.size,
    lastId,
  };
});
const topOwner = [...owners].sort((a, b) => b.raw - a.raw)[0];

/* ---------- card specs ---------- */
const fmt = (n) => n.toLocaleString("en-US");
const specs = [];

specs.push({
  file: "overview.png", eyebrow: "DATASET LEDGER",
  title: "The dataset, live.",
  sub: "Real-world images where vision models fail — counted honestly.",
  chips: [chip(fmt(c.imagesUnique), "unique images"), chip(fmt(owners.length), "contributors"), chip("hourly", "sync")],
});
specs.push({
  file: "gallery.png", eyebrow: "GALLERY",
  title: "Every frame, one grid.",
  sub: `${fmt(c.imagesRaw)} raw files · swipe, filter, zoom.`,
  chips: [chip(fmt(c.imagesUnique), "unique"), chip(fmt(c.dupCopies), "duplicates"), chip(fmt(c.videos), "videos out")],
});
specs.push({
  file: "composition.png", eyebrow: "COMPOSITION",
  title: "What the set is made of.",
  sub: "Orientation, resolution, aspect ratios, cameras.",
  chips: [chip(`${camStats().coverage}%`, "with exif"), chip(`${camStats().medianMp} MP`, "median"), chip(fmt(camStats().cameras), "cameras")],
});
specs.push({
  file: "contributors.png", eyebrow: "CONTRIBUTORS",
  title: `${owners.length} people, one dataset.`,
  sub: `Top collector: ${topOwner.name} — ${fmt(topOwner.raw)} pictures.`,
  chips: [chip(fmt(topOwner.raw), "most pics"), chip(fmt(c.imagesUnique), "unique total")],
});
specs.push({
  file: "duplicates.png", eyebrow: "DUPLICATES", accent: T.danger,
  title: "Copies we can delete.",
  sub: "Byte-identical files, grouped by checksum.",
  chips: [chip(fmt(c.dupCopies), "duplicate copies"), chip(fmt(data.dupGroups.length), "groups")],
});
specs.push({
  file: "project.png", eyebrow: "PROJECT",
  title: "Built to break models.",
  sub: "An AGI benchmark for visual & geometric reasoning.",
  chips: [chip(fmt(c.imagesUnique), "test images"), chip("v" + data.version, "schema")],
});

function camStats() {
  let known = 0; const cams = new Map(); const mps = [];
  for (const r of data.files) {
    if (r[7] !== "i") continue;
    const e = data.exif?.[r[0]];
    if (!e) continue;
    known++; mps.push((e[0] * e[1]) / 1e6);
    if (e[2] != null && e[2] >= 0) cams.set(e[2], (cams.get(e[2]) ?? 0) + 1);
  }
  mps.sort((a, b) => a - b);
  return {
    coverage: Math.round((known / Math.max(imgCount(), 1)) * 100),
    medianMp: known ? mps[Math.floor(known / 2)].toFixed(1) : "0.0",
    cameras: cams.size,
  };
}
function imgCount() { return data.files.filter((f) => f[7] === "i").length; }

/* ---------- contributor cards (with avatar photo) ---------- */
const avatarBytes = new Map(); // email -> Uint8Array
for (const o of owners) {
  if (!o.lastId) continue;
  try {
    const res = await fetch(`https://lh3.googleusercontent.com/d/${o.lastId}=w400`);
    if (res.ok) avatarBytes.set(o.email, new Uint8Array(await res.arrayBuffer()));
  } catch {
    /* offline-safe: card renders without photo */
  }
}
for (const o of owners) {
  specs.push({
    file: `contributors/${o.email}.png`, eyebrow: "CONTRIBUTOR", avatar: avatarBytes.get(o.email),
    title: o.name,
    sub: `${o.email}`,
    chips: [chip(fmt(o.raw), "pictures"), chip(fmt(o.unique), "unique"), chip(fmt(Math.max(0, o.raw - o.unique)), "dupes")],
  });
  if (avatarBytes.has(o.email)) {
    images.push({ src: `avatar-${o.email}`, data: avatarBytes.get(o.email) });
  }
}

/* ---------- render ---------- */
mkdirSync(join(root, "og", "contributors"), { recursive: true });

for (const spec of specs) {
  const accent = spec.accent ?? T.accent;
  const children = [
    ...gridLines(),
    ...chrome({ eyebrow: spec.eyebrow, accent }),
    titleBlock(spec.title, spec.sub),
    chipsRow(spec.chips),
  ];

  // contributor avatar, right side
  if (spec.avatar) {
    const email = spec.file.replace("contributors/", "").replace(".png", "");
    const src = `avatar-${email}`;
    if (images.some((i) => i.src === src)) {
      children.push(
        abs({ right: 90, top: 185 }, {
          width: 260, height: 260, borderRadius: 130, overflow: "hidden",
          borderWidth: 3, borderColor: T.line,
        }, [{ type: "image", src, style: { width: 260, height: 260 } }]),
      );
    }
  }

  const png = await renderer.render(cardShell(children), {
    width: 1200, height: 630,
    images: images.filter((i) => i.data != null).map(({ src, data: d }) => ({ src, data: d })),
  });
  const out = join(root, "og", ...spec.file.split("/"));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png);
  console.log(`  ✓ og/${spec.file} (${Math.round(png.length / 1024)} KB)`);
}

console.log("all cards rendered");
