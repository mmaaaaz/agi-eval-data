#!/usr/bin/env node
/**
 * Render og/og.png (1200x630 social card) with Takumi — no headless browser.
 * Runs in the hourly sync workflow right after data/latest.json is written,
 * so the card is regenerated exactly when (and only when) stats change.
 *
 * Served via raw.githubusercontent.com — free, CDN-cached, never stale past ~5min.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Renderer } from "@takumi-rs/core";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

const data = JSON.parse(readFileSync(join(root, "data", "latest.json"), "utf-8"));
const c = data.meta.counts;
const contributors = Object.keys(data.owners).length;

// fonts — committed next to this script so CI never touches the network
const font = (file, weight) => ({ name: "Geist", data: readFileSync(join(here, "fonts", file)), weight });

const renderer = new Renderer();
await renderer.registerFont(font("Geist-Regular.ttf", 400));
await renderer.registerFont(font("Geist-SemiBold.ttf", 600));
await renderer.registerFont(font("Geist-Bold.ttf", 700));

// triangle logo mark as an inline SVG rasterized by the renderer
const TRIANGLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="132" viewBox="0 0 150 132"><path d="M75 4 L146 128 L4 128 Z" fill="none" stroke="#ededed" stroke-width="7"/><circle cx="75" cy="102" r="12" fill="#0070f3"/></svg>`;

const px = (n) => ({ type: "text", text: n, style: { color: "#0070f3", fontSize: 26, fontWeight: 700, fontFamily: "Geist" } });
const pl = (n) => ({ type: "text", text: n, style: { color: "#666666", fontSize: 20, fontFamily: "Geist" } });

const chip = (value, label) => ({
  type: "container",
  style: {
    display: "flex", flexDirection: "row", alignItems: "center", gap: 14,
    padding: "14px 22px", borderRadius: 10,
    borderWidth: 2, borderColor: "#262626", backgroundColor: "#0a0a0a",
  },
  children: [px(value.toLocaleString("en-US")), pl(label)],
});

const gridLine = (vertical, pos) => ({
  type: "container",
  style: {
    position: "absolute",
    ...(vertical ? { left: pos, top: 0, bottom: 0, width: 1 } : { top: pos, left: 0, right: 0, height: 1 }),
    backgroundColor: "#0d0d0d",
  },
});

const grid = [];
for (let x = 60; x < 1200; x += 60) grid.push(gridLine(true, x));
for (let y = 60; y < 630; y += 60) grid.push(gridLine(false, y));

const tree = {
  type: "container",
  style: { width: 1200, height: 630, position: "relative", backgroundColor: "#050505", fontFamily: "Geist" },
  children: [
    ...grid,
    // safelight dot
    { type: "container", style: { position: "absolute", right: 86, top: 80, width: 24, height: 24, borderRadius: 12, backgroundColor: "#ee0000" } },

    // logo mark: triangle + dot (SVG-free: three rotated bars are fiddly; use border trick via image? -> simplest: nested containers)
    {
      type: "container",
      style: { position: "absolute", left: 90, top: 130, width: 150, height: 132 },
      children: [
        // triangle drawn as an SVG image node
        {
          type: "image",
          src: "triangle",
          style: { width: 150, height: 132 },
        },
      ],
    },

    {
      type: "container",
      style: { position: "absolute", left: 90, top: 300, display: "flex", flexDirection: "column", gap: 14 },
      children: [
        { type: "text", text: "agi-eval-data", style: { color: "#ededed", fontSize: 84, fontWeight: 700, letterSpacing: -2 } },
        { type: "text", text: "real-world images where vision models fail", style: { color: "#a1a1a1", fontSize: 32 } },
        { type: "text", text: "+ complex geometric reasoning problems", style: { color: "#a1a1a1", fontSize: 32 } },
      ],
    },

    {
      type: "container",
      style: { position: "absolute", left: 90, bottom: 44, display: "flex", flexDirection: "row", gap: 20 },
      children: [
        chip(c.imagesUnique.toLocaleString("en-US"), "unique images"),
        chip(String(contributors), "contributors"),
        chip("hourly", "live sync"),
      ],
    },
  ],
};

const png = await renderer.render(tree, {
  width: 1200,
  height: 630,
  images: [{ src: "triangle", data: new TextEncoder().encode(TRIANGLE_SVG) }],
});

const out = join(root, "og", "og.png");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`og.png rendered with takumi: ${out} (${Math.round(png.length / 1024)} KB)`);
