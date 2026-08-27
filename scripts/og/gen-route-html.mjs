#!/usr/bin/env node
/**
 * Emit per-route index.html copies into a site's dist so every path carries its
 * OWN OG tags (social crawlers don't run JS). og:image URLs point at the
 * takumi-rendered cards on raw.githubusercontent.
 *
 * Usage: node gen-route-html.mjs [web|metro]   (default: web)
 * Run AFTER `vite build`, BEFORE `wrangler pages deploy`.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { siteConfig } from "./og-config.mjs";

const site = process.argv[2] ?? "web";
const cfg = siteConfig(site);
const { dist, RAW, SITE, routes } = cfg;
const template = readFileSync(join(dist, "index.html"), "utf-8");

function withMeta(html, r) {
  const url = `${SITE}${r.url}`;
  const img = `${RAW}/${r.image}`;
  const safe = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  // matches `<meta` + any whitespace (incl. newlines) + the attribute + rest of tag
  const metaRe = (attr) => new RegExp(`<meta\\s+${attr}[\\s\\S]*?>`);
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${safe(r.title)}</title>`)
    .replace(metaRe(`name="description"`), `<meta name="description" content="${safe(r.desc)}" />`)
    .replace(metaRe(`property="og:title"`), `<meta property="og:title" content="${safe(r.title)}" />`)
    .replace(metaRe(`property="og:description"`), `<meta property="og:description" content="${safe(r.desc)}" />`)
    .replace(metaRe(`property="og:url"`), `<meta property="og:url" content="${url}" />`)
    .replace(metaRe(`property="og:image"`), `<meta property="og:image" content="${img}" />`)
    .replace(metaRe(`name="twitter:title"`), `<meta name="twitter:title" content="${safe(r.title)}" />`)
    .replace(metaRe(`name="twitter:description"`), `<meta name="twitter:description" content="${safe(r.desc)}" />`)
    .replace(metaRe(`name="twitter:image"`), `<meta name="twitter:image" content="${img}" />`);
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
console.log(`${site}: per-route HTML written: ${n + 1} pages (incl. root)`);
