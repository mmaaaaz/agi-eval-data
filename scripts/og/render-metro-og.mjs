#!/usr/bin/env node
/**
 * Render the metro OG card set with Takumi (no headless browser).
 * Mirror of render-og.mjs, scoped to data/metro.json + metro-eval branding.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Renderer } from "@takumi-rs/core";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const data = JSON.parse(readFileSync(join(root, "data", "metro.json"), "utf-8"));
const c = data.meta.counts;
const DOMAIN = "metro-eval.pages.dev";

/* ---------- fonts (committed — CI never touches the network for type) ---------- */
const renderer = new Renderer();
const font = (file, weight) => ({ name: "Geist", data: readFileSync(join(here, "fonts", file)), weight });
await renderer.registerFont(font("Geist-Regular.ttf", 400));
await renderer.registerFont(font("Geist-SemiBold.ttf", 600));
await renderer.registerFont(font("Geist-Bold.ttf", 700));

/* ---------- design tokens (mirror the site: green accent) ---------- */
const T = {
  bg: "#000000",
  panel: "#0a0a0a",
  line: "#262626",
  fg: "#ededed",
  dim: "#a1a1a1",
  faint: "#666666",
  accent: "#10b981",
  accentDim: "#0e8a5f",
};
const TRIANGLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="64" viewBox="0 0 72 64"><path d="M4 22 L16 6 L28 22 Z" fill="none" stroke="#ededed" stroke-width="4"/><circle cx="16" cy="19" r="6" fill="#10b981"/></svg>`;
const images = [{ src: "triangle", data: new TextEncoder().encode(TRIANGLE_SVG) }];

/* ---------- node builders ---------- */
const box = (style, children = []) => ({ type: "container", style, children });
const abs = (pos, style, children = []) => box({ position: "absolute", ...pos, ...style }, children);
const txt = (text, style) => ({ type: "text", text, style });

const fontStack = `Geist, ui-sans-serif, system-ui, sans-serif`;
const mono = `ui-monospace, SFMono-Regular, Menlo, monospace`;

function chrome({ eyebrow, accent = T.accent }) {
  return [
    box({ position: "absolute", left: 56, top: 52, width: 28, height: 28 }, [{
      type: "image", src: "triangle", width: 28, height: 28,
    }]),
    txt(eyebrow, {
      position: "absolute", left: 96, top: 56,
      fontSize: 15, fontWeight: 600, fontFamily: mono,
      letterSpacing: 4, color: T.faint, textTransform: "uppercase",
    }),
    box({ position: "absolute", left: 56, right: 56, top: 96, height: 1, backgroundColor: T.line }),
  ];
}

function titleBlock(title, sub, top = 200) {
  return [
    txt(title, {
      position: "absolute", left: 56, right: 56, top,
      fontSize: 64, fontWeight: 700, fontFamily: fontStack,
      color: T.fg, lineHeight: 1.05,
    }),
    txt(sub, {
      position: "absolute", left: 56, right: 56, top: top + 92,
      fontSize: 26, fontWeight: 400, fontFamily: fontStack, color: T.dim, lineHeight: 1.3,
    }),
  ];
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

function chipsRow(chips, bottom = 112) {
  return abs(
    { left: 56, bottom },
    { display: "flex", flexDirection: "row", gap: 20 },
    chips.map(([value, label]) => chip(value, label)),
  );
}

function cardShell(children) {
  return box({
    width: 1200, height: 630, position: "relative", backgroundColor: T.bg, fontFamily: "Geist",
  }, children);
}

/* ---------- card specs ---------- */
const fmt = (n) => n.toLocaleString("en-US");
const specs = [];

specs.push({
  name: "overview",
  build: () => cardShell([
    ...chrome({ eyebrow: "metro / transit" }),
    ...titleBlock(
      `${fmt(c.images)} metro maps`,
      `${fmt(c.countries)} countries · ${fmt(c.cities)} cities · ${fmt(c.pdfs)} official PDFs — curated for VLM failure modes.`,
      150,
    ),
    chipsRow([
      [fmt(c.images), "network maps"],
      [fmt(c.countries), "countries"],
      [fmt(c.cities), "cities"],
    ]),
  ]),
});

specs.push({
  name: "catalog",
  build: () => cardShell([
    ...chrome({ eyebrow: "metro / transit · catalog" }),
    ...titleBlock(
      "Browse by country",
      `Two branches: ours (curated maps) and reason_map (existing dataset) — every map and PDF opens in-app.`,
      150,
    ),
    chipsRow([
      ["ours", "branch"],
      ["existing", "branch"],
      ["PDFs", "in-app preview"],
    ]),
  ]),
});

specs.push({
  name: "gallery",
  build: () => cardShell([
    ...chrome({ eyebrow: "metro / transit · gallery" }),
    ...titleBlock(
      `${fmt(c.images)} network maps`,
      `Images, official plans (PDFs), contributors and a duplicate check — all in one grid.`,
      150,
    ),
    chipsRow([
      [fmt(c.images), "maps"],
      [fmt(c.pdfs), "pdfs"],
      [fmt(c.bytes / 1024 / 1024), "MB"],
    ]),
  ]),
});

specs.push({
  name: "project",
  build: () => cardShell([
    ...chrome({ eyebrow: "metro / transit · project" }),
    ...titleBlock(
      "AGI benchmark · transit",
      `One of three sub-projects targeting visual & geometric reasoning failures of frontier vision-language models.`,
      150,
    ),
    chipsRow([
      ["CVPR", "submission"],
      ["5+", "questions / map"],
      ["hourly", "drive sync"],
    ]),
  ]),
});

/* ---------- render ---------- */
mkdirSync(join(root, "og", "metro"), { recursive: true });

for (const spec of specs) {
  const png = await renderer.render(spec.build());
  const out = join(root, "og", "metro", `${spec.name}.png`);
  writeFileSync(out, png);
  console.log(`  og/metro/${spec.name}.png`);
}

console.log("metro OG cards rendered");
