/**
 * Per-site OG route config — single source of truth for both OG stampers.
 * Each site: dist dir, artifact path, RAW/SITE/BASE, routes (dir/title/desc/image/url),
 * and optional contributor-card expansion.
 */
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const fmt = (n) => n.toLocaleString("en-US");

export function siteConfig(name) {
  if (name === "web") {
    const data = JSON.parse(readFileSync(join(root, "data", "latest.json"), "utf-8"));
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
        title: `Overview · agi-eval-data — dataset ledger`,
        desc: `${fmt(c.imagesUnique)} unique real-world images where vision models fail — ${owners.length} contributors, ${fmt(c.dupCopies)} duplicates pruned, syncing daily.`,
        image: "overview.png",
        url: "/",
      },
      {
        dir: "gallery",
        title: `Gallery · agi-eval-data — dataset ledger`,
        desc: `Browse all ${fmt(c.imagesRaw)} images — filter by contributor, resolution, orientation; swipe and zoom fullscreen.`,
        image: "gallery.png",
        url: "/gallery",
      },
      {
        dir: "ask",
        title: `Ask AI · agi-eval-data — dataset ledger`,
        desc: `Chat with the dataset in natural language — real SQL over ${fmt(c.imagesUnique)} unique images, answered in your browser.`,
        image: "overview.png",
        url: "/ask",
      },
      {
        dir: "gallery/insights",
        title: `Composition · agi-eval-data — dataset ledger`,
        desc: `What the dataset is made of: orientation split, resolution histogram, aspect ratios, ${fmt(Object.keys(data.exif ?? {}).length)} images of camera EXIF.`,
        image: "composition.png",
        url: "/gallery/insights",
      },
      {
        dir: "gallery/contributors",
        title: `Contributors · agi-eval-data — dataset ledger`,
        desc: `${owners.length} people building the benchmark — top collector: ${top.name} with ${fmt(top.raw)} pictures.`,
        image: "contributors.png",
        url: "/gallery/contributors",
      },
      {
        dir: "gallery/duplicates",
        title: `Duplicates · agi-eval-data — dataset ledger`,
        desc: `${fmt(data.dupGroups.length)} byte-identical duplicate groups · ${fmt(c.dupCopies)} copies flagged by checksum.`,
        image: "duplicates.png",
        url: "/gallery/duplicates",
      },
      {
        dir: "project",
        title: `Project · agi-eval-data — dataset ledger`,
        desc: "An AGI benchmark targeting visual & geometric reasoning failures of frontier vision-language models.",
        image: "project.png",
        url: "/project",
      },
    ];
    // one page per contributor — shared links get their personal card
    for (const o of owners) {
      routes.push({
        dir: `gallery/contributors/${o.email}`,
        title: `${o.name} · Contributors · agi-eval-data — dataset ledger`,
        desc: `${fmt(o.raw)} pictures · ${fmt(o.unique)} unique · contributor on the agi-eval-data benchmark dataset.`,
        image: `contributors/${o.email}.png`,
        url: `/gallery/contributors/${encodeURIComponent(o.email)}`,
      });
    }
    return {
      dist: join(root, "apps", "web", "dist"),
      RAW: "https://raw.githubusercontent.com/mmaaaaz/agi-eval-data/main/og",
      SITE: "https://agi-eval-data.pages.dev",
      routes,
    };
  }

  if (name === "metro") {
    const data = JSON.parse(readFileSync(join(root, "data", "metro.json"), "utf-8"));
    const c = data.meta.counts;
    const routes = [
      {
        dir: "",
        title: `Overview · metro-eval — transit dataset ledger`,
        desc: `${fmt(c.images)} metro network maps from ${fmt(c.countries)} countries — curated for VLM failure modes, ${fmt(c.pdfs)} official PDFs.`,
        image: "overview.png",
        url: "/",
      },
      {
        dir: "catalog",
        title: `Catalog · metro-eval — transit dataset ledger`,
        desc: `Browse by country — ours (curated) and reason_map (existing dataset) branches; every map and PDF opens in-app.`,
        image: "catalog.png",
        url: "/catalog",
      },
      {
        dir: "gallery",
        title: `Gallery · metro-eval — transit dataset ledger`,
        desc: `All ${fmt(c.images)} network maps + ${fmt(c.pdfs)} PDFs — images, plans, contributors and a duplicate check in one grid.`,
        image: "gallery.png",
        url: "/gallery",
      },
      {
        dir: "project",
        title: `Project · metro-eval — transit dataset ledger`,
        desc: "An AGI benchmark targeting visual & geometric reasoning failures of frontier vision-language models — transit dataset.",
        image: "project.png",
        url: "/project",
      },
    ];
    return {
      dist: join(root, "apps", "metro-web", "dist"),
      RAW: "https://raw.githubusercontent.com/mmaaaaz/agi-eval-data/main/og/metro",
      SITE: "https://metro-eval.pages.dev",
      routes,
    };
  }

  if (name === "grip") {
    const data = JSON.parse(readFileSync(join(root, "data", "grip", "tree.json"), "utf-8"));
    const c = data.counts;
    const routes = [
      {
        dir: "",
        title: `Overview · grip-eval — geometric reasoning ledger`,
        desc: `${fmt(c.questionsMain)} ground-truthed questions over ${fmt(c.imagesMain)} synthetic geometry images — 34 independently validated sub-benchmarks, 5 difficulty levels.`,
        image: "overview.png",
        url: "/",
      },
      {
        dir: "categories",
        title: `Categories · grip-eval — geometric reasoning ledger`,
        desc: `All ${fmt(c.categories)} GRIP sub-benchmarks — route puzzles, nested polygons, cube structures, physics diagrams and more, with full scene metadata.`,
        image: "overview.png",
        url: "/categories",
      },
      {
        dir: "browse",
        title: `Browse · grip-eval — geometric reasoning ledger`,
        desc: `Filter ${fmt(c.imagesMain)} samples by category, difficulty and question level — every question ships its independently validated ground truth.`,
        image: "overview.png",
        url: "/browse",
      },
      {
        dir: "project",
        title: `Project · grip-eval — geometric reasoning ledger`,
        desc: "Programmatically generated, independently validated geometry & physical-reasoning suite — the third pillar of the VLM failure-modes benchmark.",
        image: "overview.png",
        url: "/project",
      },
    ];
    return {
      dist: join(root, "apps", "grip-web", "dist"),
      RAW: "https://raw.githubusercontent.com/mmaaaaz/agi-eval-data/main/og/grip",
      SITE: "https://grip-eval.pages.dev",
      routes,
    };
  }

  throw new Error(`unknown site: ${name} (expected web|metro|grip)`);
}
