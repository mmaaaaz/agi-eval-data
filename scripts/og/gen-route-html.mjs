#!/usr/bin/env node
/**
 * Emit per-route index.html copies into web/dist so every path carries its OWN
 * OG tags (social crawlers don't run JS). og:image URLs point at the hourly
 * takumi-rendered cards on raw.githubusercontent — live data, no redeploys.
 *
 * Run AFTER `vite build`, BEFORE `wrangler pages deploy`.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const dist = join(root, "apps", "web", "dist");
const data = JSON.parse(readFileSync(join(root, "data", "latest.json"), "utf-8"));

const RAW = "https://raw.githubusercontent.com/mmaaaaz/agi-eval-data/main/og";
const SITE = "https://agi-eval-data.pages.dev";
const BASE = "agi-eval-data — dataset ledger";
const fmt = (n) => n.toLocaleString("en-US");
const c = data.meta.counts;

const owners = Object.keys(data.owners).map((email) => {
  const theirs = data.files.filter((r) => r[5] === email && r[7] === "i");
  const uniq = new Set(theirs.map((r) => r[6]).filter(Boolean));
  return { email, name: data.owners[email] ?? email, raw: theirs.length, unique: uniq.size };
});
const top = [...owners].sort((a, b) => b.raw - a.raw)[0];

const routes = [
  {
    dir: "",
    title: `Overview · ${BASE}`,
    desc: `${fmt(c.imagesUnique)} unique real-world images where vision models fail — ${owners.length} contributors, ${fmt(c.dupCopies)} duplicates pruned, syncing hourly.`,
    image: "overview.png",
    url: "/",
  },
  {
    dir: "gallery",
    title: `Gallery · ${BASE}`,
    desc: `Browse all ${fmt(c.imagesRaw)} images — filter by contributor, resolution, orientation; swipe and zoom fullscreen.`,
    image: "gallery.png",
    url: "/gallery",
  },
  {
    dir: "ask",
    title: `Ask AI · ${BASE}`,
    desc: `Chat with the dataset in natural language — real SQL over ${fmt(c.imagesUnique)} unique images, answered in your browser.`,
    image: "overview.png",
    url: "/ask",
  },
  {
    dir: "gallery/insights",
    title: `Composition · ${BASE}`,
    desc: `What the dataset is made of: orientation split, resolution histogram, aspect ratios, ${fmt(Object.keys(data.exif ?? {}).length)} images of camera EXIF.`,
    image: "composition.png",
    url: "/gallery/insights",
  },
  {
    dir: "gallery/contributors",
    title: `Contributors · ${BASE}`,
    desc: `${owners.length} people building the benchmark — top collector: ${top.name} with ${fmt(top.raw)} pictures.`,
    image: "contributors.png",
    url: "/gallery/contributors",
  },
  {
    dir: "gallery/duplicates",
    title: `Duplicates · ${BASE}`,
    desc: `${fmt(data.dupGroups.length)} byte-identical duplicate groups · ${fmt(c.dupCopies)} copies flagged by checksum.`,
    image: "duplicates.png",
    url: "/gallery/duplicates",
  },
  {
    dir: "project",
    title: `Project · ${BASE}`,
    desc: "An AGI benchmark targeting visual & geometric reasoning failures of frontier vision-language models.",
    image: "project.png",
    url: "/project",
  },
];

// one page per contributor — shared links get their personal card
for (const o of owners) {
  routes.push({
    dir: `gallery/contributors/${o.email}`,
    title: `${o.name} · Contributors · ${BASE}`,
    desc: `${fmt(o.raw)} pictures · ${fmt(o.unique)} unique · contributor on the agi-eval-data benchmark dataset.`,
    image: `contributors/${o.email}.png`,
    url: `/gallery/contributors/${encodeURIComponent(o.email)}`,
  });
}

const template = readFileSync(join(dist, "index.html"), "utf-8");

function withMeta(html, r) {
  const image = `${RAW}/${r.image}`;
  return html
    .replace(/<title>.*?<\/title>/s, `<title>${r.title}</title>`)
    .replace(/(<meta name="description" content=").*?(")/s, `$1${r.desc}$2`)
    .replace(/(<meta property="og:title" content=").*?(")/s, `$1${r.title}$2`)
    .replace(/(<meta property="og:description" content=").*?(")/s, `$1${r.desc}$2`)
    .replace(/(<meta property="og:url" content=").*?(")/s, `$1${SITE}${r.url}$2`)
    .replace(/(<meta property="og:image" content=").*?(")/s, `$1${image}$2`)
    .replace(/(<meta name="twitter:title" content=").*?(")/s, `$1${r.title}$2`)
    .replace(/(<meta name="twitter:description" content=").*?(")/s, `$1${r.desc}$2`)
    .replace(/(<meta name="twitter:image" content=").*?(")/s, `$1${image}$2`);
}

let n = 0;
for (const r of routes) {
  const out = join(dist, r.dir, "index.html");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, withMeta(template, r));
  n++;
}
// root index.html also gets the overview card
writeFileSync(join(dist, "index.html"), withMeta(template, routes[0]));
console.log(`per-route HTML written: ${n + 1} pages (incl. root)`);
