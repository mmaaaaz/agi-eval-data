#!/usr/bin/env node
/**
 * Emit per-route index.html copies into metro-web/dist so every path carries its
 * OWN OG tags (social crawlers don't run JS). og:image URLs point at the
 * takumi-rendered cards on raw.githubusercontent.
 *
 * Run AFTER `vite build`, BEFORE `wrangler pages deploy`.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const dist = join(root, "apps", "metro-web", "dist");
const data = JSON.parse(readFileSync(join(root, "data", "metro.json"), "utf-8"));

const RAW = "https://raw.githubusercontent.com/mmaaaaz/agi-eval-data/main/og/metro";
const SITE = "https://metro-eval.pages.dev";
const BASE = "metro-eval — transit dataset ledger";
const fmt = (n) => n.toLocaleString("en-US");
const c = data.meta.counts;

const routes = [
  {
    dir: "",
    title: `Overview · ${BASE}`,
    desc: `${fmt(c.images)} metro network maps from ${fmt(c.countries)} countries — curated for VLM failure modes, ${fmt(c.pdfs)} official PDFs.`,
    image: "overview.png",
    url: "/",
  },
  {
    dir: "catalog",
    title: `Catalog · ${BASE}`,
    desc: `Browse by country — ours (curated) and reason_map (existing dataset) branches; every map and PDF opens in-app.`,
    image: "catalog.png",
    url: "/catalog",
  },
  {
    dir: "gallery",
    title: `Gallery · ${BASE}`,
    desc: `All ${fmt(c.images)} network maps + ${fmt(c.pdfs)} PDFs — images, plans, contributors and a duplicate check in one grid.`,
    image: "gallery.png",
    url: "/gallery",
  },
  {
    dir: "project",
    title: `Project · ${BASE}`,
    desc: "An AGI benchmark targeting visual & geometric reasoning failures of frontier vision-language models — transit dataset.",
    image: "project.png",
    url: "/project",
  },
];

const template = readFileSync(join(dist, "index.html"), "utf-8");

function withMeta(html, r) {
  const url = `${SITE}${r.url}`;
  const img = `${RAW}/${r.image}`;
  const safe = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${safe(r.title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${safe(r.desc)}" />`)
    .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${safe(r.title)}" />`)
    .replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${safe(r.desc)}" />`)
    .replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${url}" />`)
    .replace(/<meta property="og:image"[^>]*>/, `<meta property="og:image" content="${img}" />`);
}

let n = 0;
for (const r of routes) {
  const dir = join(dist, r.dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), withMeta(template, r));
  n++;
}
// root index.html also gets the overview card
writeFileSync(join(dist, "index.html"), withMeta(template, routes[0]));
console.log(`per-route HTML written: ${n + 1} pages (incl. root)`);
