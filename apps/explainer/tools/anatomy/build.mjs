import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "./iso-kit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// The reference's scripts/inline-kit.mjs points at ../../kit, which is not in this
// bundle. The same trick, against the local copy of the kit.
const kitScript = () => readFileSync(join(HERE, "iso-kit.mjs"), "utf8").replace(/^export /gm, "");

// ---------------------------------------------------------------------------
// The one set of numbers. Geometry and the live model both read these.
// ---------------------------------------------------------------------------
const PLATES = 24;           // plates in one reviewed series, and stations on the rail
const QUESTIONS = 5;         // question cards dealt per plate
const CURATED = 5000;        // hand-curated plates in the corpus
const OPEN = 45000;          // open-shelf plates in the corpus
const CORPUS = 50000;        // the whole corpus
const CURATED_PER_SERIES = Math.max(1, Math.round((PLATES * CURATED) / CORPUS)); // 2
const OPEN_PER_SERIES = Math.round((PLATES * OPEN) / CORPUS); // 22
const CURATED_AT = Array.from({ length: CURATED_PER_SERIES }, (_, j) =>
  Math.round(((j + 0.5) * PLATES) / CURATED_PER_SERIES),
); // [6, 18] — the two curated steps in every series
const START_STEP = Math.round(PLATES / 3); // 8 — the machine is shown mid-series
const START_CURATED = CURATED_AT.filter((step) => step <= START_STEP).length;
const START_OPEN = START_STEP - START_CURATED;

const WIDTH = 640;
const HEIGHT = 400;

const BED = { x: -226, y: -80, w: 436, d: 160, r: 10 };
const BED_H = 14;

const RACK = { x: -159, y: -16, w: 230, d: 32, r: 2.4 };
const RACK_START = -150;
const PITCH = 9.4;
const RACK_Z = 1.2;
const PLATE_W = 6.8;
const PLATE_D = 24;
const PLATE_H = 2.8;
const RIB_TOP = 3.2;
const LIFT = 3.0;

const MAG = { x: -194, y: -14, w: 30, d: 28, r: 2 };
const MAG_STATION = -2;
const MAG_X = RACK_START + MAG_STATION * PITCH;
const MAG_Z = 4.2;

const TABLE = { x: 71, y: -13, w: 18, d: 26, r: 1.6 };
const TABLE_Z = 1.6;
const TABLE_CENTER = [80, 0];

const DIAL = [14, 54];
const DIAL_R = 19.5;
const DIAL_Z = 5;
const DIAL_H = 7;
const DIAL_TOP = DIAL_Z + DIAL_H;

const LAMP = { x: RACK_START + 3 * PITCH, y: -44 };
const LAMP_TOP = 52;
const LAMP_PIVOT_Z = 48;
const LAMP_HEAD_Z = 26;

const STAMP = { x: RACK_START + 14 * PITCH, y: -46 };
const STAMP_TOP = 66;
const RAM_TOP = 38;
const RAM_STROKE = 18.5;

const SHELF = { x: 108, y: -64, w: 66, d: 36, r: 2 };
const SHELF_SLOTS = 8;
const SHELF_FILLED = Math.min(SHELF_SLOTS, OPEN_PER_SERIES);

const DRAWER = { x: 108, y: 26, w: 58, d: 38, r: 2 };
const DRAWER_TOP = 21;
const DRAWER_LID = 3.6;

const HEAD = { x: -196, y: 28, w: 12, d: 16, r: 1.5 };
const TRAY = { x: -172, y: 26, w: 48, d: 20, r: 1.5 };
const CARD_STEP = 9.2;
const CARD_Z = 1.8;

const CRANK = { x: -222, y: 32, w: 20, d: 18, r: 2 };

const stationX = (station) => RACK_START + station * PITCH;

const FIT = [
  ...k.boxCorners(BED, -BED_H - 7, 0),
  [LAMP.x, LAMP.y, LAMP_TOP + 2],
  [LAMP.x, 2, LAMP_HEAD_Z],
  [STAMP.x, STAMP.y, STAMP_TOP + 2],
  [STAMP.x, 0, RAM_TOP],
  [SHELF.x + SHELF.w, SHELF.y, 20],
  [DRAWER.x + DRAWER.w, DRAWER.y + DRAWER.d, DRAWER_TOP + DRAWER_LID + 3],
  [DIAL[0] + DIAL_R, DIAL[1] + DIAL_R, DIAL_TOP],
  [HEAD.x, HEAD.y, 10],
  [CRANK.x + CRANK.w / 2 + 19.4, CRANK.y + CRANK.d, 36],
];

const P = k.fitProjection(FIT, WIDTH, HEIGHT, { pad: 24, azimuth: 34, elevation: 29 });

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) =>
  [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));

// ---------------------------------------------------------------------------
// Small shared parts
// ---------------------------------------------------------------------------
function screw(x, y, z, r = 2.1) {
  return (
    L(k.ring(x, y, r, z, P, 16), { tone: "lo" }) +
    `<circle class="iso-dots" data-tone="mid" cx="${at([x, y, z])[0].toFixed(1)}" cy="${at([x, y, z])[1].toFixed(1)}" r="0.45" fill-opacity="0.55"/>`
  );
}

function labelPlate(plan, z, rules = [], opts = {}) {
  const out = [S(k.slabOf(plan, z, 0.8, P, 4, 0.25), { tone: "mid", crease: "lo" })];
  out.push(L(k.planOutline(k.insetPlan(plan, 1.2), z + 0.8, P, 4), { tone: "faint" }));
  for (const [x0, x1, y] of rules) {
    out.push(L(k.lineOnTop([x0, y], [x1, y], z + 0.8, P), { tone: "lo", free: true }));
  }
  if (opts.screws !== false) {
    out.push(D([at([plan.x + 3, plan.y + plan.d / 2, z + 0.8]), at([plan.x + plan.w - 3, plan.y + plan.d / 2, z + 0.8])], { size: 0.45, tone: "mid" }));
  }
  return out.join("");
}

function plateMarkup() {
  const plan = { x: -PLATE_W / 2, y: -PLATE_D / 2, w: PLATE_W, d: PLATE_D, r: 0.9 };
  const out = [S(k.slabOf(plan, 0, PLATE_H, P, 4, 0.4), { tone: "hi", crease: "lo" })];
  out.push(L(k.planOutline(k.insetPlan(plan, 1.2), PLATE_H, P, 4), { tone: "faint" }));
  out.push(L(k.lineOnTop([-PLATE_W / 2 + 1.9, -PLATE_D / 2 + 5], [-PLATE_W / 2 + 1.9, PLATE_D / 2 - 5], PLATE_H, P), { tone: "lo", free: true }));
  out.push(S(k.slabOf({ x: -1.3, y: -PLATE_D / 2 + 1.6, w: 2.6, d: 2.6, r: 0.5 }, PLATE_H, 0.55, P, 3, 0.2), { tone: "mid", crease: "lo" }));
  out.push(D([at([-1.3, -PLATE_D / 2 + 2.9, PLATE_H + 0.55]), at([PLATE_W / 2 - 1.9, PLATE_D / 2 - 2.9, PLATE_H])], { size: 0.35, tone: "lo" }));
  return out.join("");
}

function cardMarkup() {
  const plan = { x: -4, y: -8, w: 8, d: 16, r: 0.7 };
  const out = [S(k.slabOf(plan, 0, 0.7, P, 4, 0.22), { tone: "hi", crease: "lo" })];
  out.push(L(k.planOutline(k.insetPlan(plan, 1.1), 0.7, P, 4), { tone: "faint" }));
  out.push(L(k.lineOnTop([-2.4, -5.4], [-2.4, 5.4], 0.7, P), { tone: "lo", free: true }));
  out.push(L(k.lineOnTop([-2.4, 2.2], [2.4, 2.2], 0.7, P), { tone: "lo", free: true }));
  return out.join("");
}

// ---------------------------------------------------------------------------
// Base plate, feet, rules and conduits
// ---------------------------------------------------------------------------
function basePlate() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BED, -BED_H - 8, 8, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(BED, 20))) {
    out.push(S(k.cylinder(x, y, 7, -BED_H - 7, 1.6, P, 24), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.2, -BED_H - 5.4, 5.4, P, 24), { tone: "mid" }));
  }
  out.push(S(k.slabOf(BED, -BED_H, BED_H, P, 8, 1.4), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(BED, 5), 0, P), { tone: "faint" }));

  const screws = k.corners(BED, 11);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5, tone: "mid" }));

  // Ruler along the front edge.
  const strip = { x: -212, y: BED.y + BED.d - 9, w: 404, d: 7, r: 1 };
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 4, 5, strip.y + 0.9, 0.6, [2, 3.6], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(D([at([strip.x + 3, strip.y + 3.6, 0.6]), at([strip.x + strip.w - 3, strip.y + 3.6, 0.6])], { size: 0.45, tone: "lo" }));

  out.push(labelPlate({ x: -214, y: -74, w: 54, d: 10, r: 1 }, 0, [
    [-210, -200, -71.6],
    [-210, -184, -69.4],
    [-210, -192, -67.2],
  ]));
  out.push(labelPlate({ x: 42, y: 56, w: 38, d: 9, r: 1 }, 0, [
    [46, 58, 59.4],
    [46, 70, 61.8],
  ]));

  // Bolted cover plate on the open front-left bed.
  const cover = { x: -118, y: 50, w: 46, d: 16, r: 2 };
  out.push(S(k.slabOf(cover, 0, 0.6, P, 4, 0.25), { tone: "mid", crease: "lo" }));
  out.push(L(k.planOutline(k.insetPlan(cover, 2.2), 0.6, P, 4), { tone: "faint" }));
  for (const [x, y] of k.corners(cover, 4)) out.push(D([at([x, y, 0.6])], { size: 0.45, tone: "mid" }));
  out.push(L(k.lineOnTop([-112, 54], [-84, 54], 0.6, P), { tone: "lo", free: true }));
  out.push(L(k.lineOnTop([-112, 57.5], [-92, 57.5], 0.6, P), { tone: "lo", free: true }));

  // Vent panel between the drawer and the bed's right edge.
  const vent = { x: 174, y: 22, w: 20, d: 28, r: 1.5 };
  out.push(S(k.slabOf(vent, 0, 0.5, P, 4, 0.2), { tone: "lo" }));
  out.push(L(k.planOutline(k.insetPlan(vent, 2), 0.5, P, 4), { tone: "lo" }));
  out.push(D(k.dotGrid(178, 26, 3, 5, 5.4, 0.5, P), { size: 0.55, tone: "lo" }));
  for (const [x, y] of k.corners(vent, 4.4)) out.push(screw(x, y, 0.5, 1.2));
  out.push(labelPlate({ x: 174, y: 54, w: 24, d: 7, r: 1 }, 0, [[177, 188, 56.6]], { screws: false }));

  // Back-edge hold-downs.
  for (const x of [-186, -104, -22, 60, 140, 196]) out.push(screw(x, -75.5, 0, 2.1));

  // Surface conduits.
  out.push(
    k.wireSvg(at([-20.4, -40, 0.6]), at([150, -60, 0.6]), {
      via: [at([-20.4, -70, 0.6]), at([80, -70, 0.6]), at([150, -70, 0.6])],
      tone: "faint",
      size: 0.9,
    }),
  );
  for (const x of [-4, 62, 124]) {
    out.push(S(k.slabOf({ x, y: -72, w: 4, d: 5, r: 1 }, 0, 1.4, P, 3, 0.3), { tone: "mid" }));
    out.push(D([at([x + 2, -69.5, 1.4])], { size: 0.35, tone: "mid" }));
  }
  out.push(
    k.wireSvg(at([-190, 44, 0.6]), at([-204, 58, 0.6]), {
      via: [at([-198, 58, 0.6])],
      tone: "faint",
      size: 0.9,
    }),
  );
  return out.join("");
}

// ---------------------------------------------------------------------------
// The index rack: channel, magazine, end stops
// ---------------------------------------------------------------------------
function rackBack() {
  const out = [];
  out.push(S(k.slabOf(RACK, 0, 1.2, P, 4, 0.4), { tone: "mid" }));
  const grooves = [];
  for (let i = 0; i <= PLATES; i++) {
    const x = RACK_START - PITCH / 2 + i * PITCH;
    if (x > RACK.x + 3 && x < RACK.x + RACK.w - 3) {
      grooves.push(k.lineOnTop([x, RACK.y + 3], [x, RACK.y + RACK.d - 3], 1.2, P));
    }
  }
  out.push(L(grooves.join(""), { tone: "faint" }));

  // Back lip.
  out.push(S(k.slabOf({ x: RACK.x, y: RACK.y, w: RACK.w, d: 4, r: 1 }, 0, 3.6, P, 4, 0.4), { tone: "mid" }));
  out.push(L(k.sideArc(-120, -11, 0, 3.6, P, 4), { tone: "faint" }));

  // End stops.
  for (const [x, screws] of [[RACK.x - 1, true], [RACK.x + RACK.w - 4, true]]) {
    out.push(S(k.slabOf({ x, y: RACK.y - 1, w: 5, d: RACK.d + 2, r: 1.1 }, 0, 5.2, P, 4, 0.5), { tone: "mid" }));
    if (screws) out.push(D([at([x + 2.5, RACK.y + 3, 5.2]), at([x + 2.5, RACK.y + RACK.d - 3, 5.2])], { size: 0.4, tone: "mid" }));
  }

  out.push(S(k.slabOf({ x: 67, y: -14, w: 8, d: 28, r: 1.2 }, 0, 1.2, P, 3, 0.3), { tone: "mid" }));
  out.push(D([at([70, -10, 1.2]), at([70, 10, 1.2])], { size: 0.4, tone: "mid" }));
  // Magazine: spring-loaded stack at the feed end.
  out.push(S(k.slabOf(MAG, 0, 1.2, P, 4, 0.4), { tone: "mid" }));
  const walls = [
    { x: MAG.x, y: MAG.y, w: MAG.w, d: 3 },
    { x: MAG.x, y: MAG.y + MAG.d - 3, w: MAG.w, d: 3 },
    { x: MAG.x, y: MAG.y, w: 3, d: MAG.d },
  ];
  for (const wall of walls) out.push(S(k.slabOf({ ...wall, r: 0.8 }, 0, 3.6, P, 3, 0.35), { tone: "mid" }));
  out.push(S(k.slabOf({ x: MAG.x + MAG.w - 3, y: -13, w: 10, d: 26, r: 1.2 }, 0, 1.2, P, 3, 0.3), { tone: "mid" }));
  out.push(D([at([MAG.x + MAG.w + 4, -9, 1.2]), at([MAG.x + MAG.w + 4, 9, 1.2])], { size: 0.4, tone: "mid" }));
  // Stack of plates waiting under the top one.
  for (let i = 0; i < 4; i++) {
    out.push(S(k.slabOf({ x: -181, y: -12, w: PLATE_W, d: PLATE_D, r: 0.9 }, 1.2 + i * 0.8, PLATE_H * 0.45, P, 3, 0.25), { tone: "hi", crease: "lo" }));
  }
  const spring = k.coil(-192, -183, [0, 2.5], 3.6, 5, "x", P);
  out.push(L(spring.back, { tone: "lo" }));
  out.push(S(k.slabOf({ x: -183, y: -11, w: 2.2, d: 22, r: 0.8 }, 1.2, 3.4, P, 3, 0.3), { tone: "mid" }));
  out.push(L(spring.front, { tone: "mid" }));
  out.push(D([at([MAG.x + 4, MAG.y + 2, 3.6]), at([MAG.x + MAG.w - 4, MAG.y + 2, 3.6])], { size: 0.4, tone: "mid" }));
  return out.join("");
}

function driveBar() {
  const out = [];
  const a = [-202, 41], b = [-161, 17.5];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) || 1;
  const nx = (-dy / length) * 1.9, ny = (dx / length) * 1.9;
  const ring = [
    [a[0] + nx, a[1] + ny],
    [b[0] + nx, b[1] + ny],
    [b[0] - nx, b[1] - ny],
    [a[0] - nx, a[1] - ny],
  ];
  out.push(S(k.extrude(ring, 5.2, 1.6, P, { bevel: 0.3 }), { tone: "mid" }));
  for (const [px, py] of [a, b]) {
    out.push(S(k.cylinder(px, py, 3.2, 4.8, 2.4, P, 20), { tone: "mid" }));
    out.push(D([at([px, py, 7.2])], { size: 0.55, tone: "hi" }));
  }
  out.push(L(k.segment([a[0] + 2, a[1], 6.8], [b[0] - 2, b[1], 6.8], P), { tone: "faint" }));
  return out.join("");
}

function barRing(a, b, half) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) || 1;
  const nx = (-dy / length) * half, ny = (dx / length) * half;
  return [
    [a[0] + nx, a[1] + ny],
    [b[0] + nx, b[1] + ny],
    [b[0] - nx, b[1] - ny],
    [a[0] - nx, a[1] - ny],
  ];
}

function sortChutes() {
  const out = [];
  out.push(S(k.slabOf({ x: 84, y: -9, w: 12, d: 18, r: 2.5 }, 0, 2.3, P, 4, 0.5), { tone: "mid" }));
  for (const [x, y] of k.corners({ x: 84, y: -9, w: 12, d: 18 }, 3)) out.push(screw(x, y, 2.3, 1.2));
  for (const sign of [-1, 1]) {
    const a = [92, sign * 7], b = [106, sign * 25];
    out.push(S(k.extrude(barRing(a, b, 7), 0, 1.1, P, { bevel: 0.25 }), { tone: "mid" }));
    for (const side of [-1, 1]) {
      const off = [-(b[1] - a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1]) * 7 * side + 0, (b[0] - a[0]) / Math.hypot(b[0] - a[0], b[1] - a[1]) * 7 * side];
      const a2 = [a[0] + off[0], a[1] + off[1]];
      const b2 = [b[0] + off[0], b[1] + off[1]];
      out.push(S(k.extrude(barRing(a2, b2, 0.9), 1.1, 2.4, P, { bevel: 0.2 }), { tone: "mid", crease: "lo" }));
    }
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    const nx = (-dy / length) * 6, ny = (dx / length) * 6;
    for (const t of [0.2, 0.4, 0.6, 0.8]) {
      const px = a[0] + dx * t, py = a[1] + dy * t;
      out.push(L(k.lineOnTop([px + nx, py + ny], [px - nx, py - ny], 1.1, P), { tone: "faint" }));
    }
  }
  out.push(S(k.cylinder(90, 0, 2.6, 2.3, 6.5, P, 16), { tone: "mid" }));
  out.push(D([at([90, 0, 8.8])], { size: 0.5, tone: "mid" }));
  return out.join("");
}

function vane() {
  const out = [];
  out.push(S(k.slabOf({ x: 89.2, y: -1.2, w: 1.6, d: 11, r: 0.4 }, 4.8, 4.8, P, 2, 0.25), { tone: "hi", crease: "lo" }));
  out.push(S(k.slabOf({ x: 88.6, y: -2, w: 2.8, d: 2.2, r: 0.5 }, 9.6, 1.3, P, 3, 0.2), { tone: "mid" }));
  out.push(L(k.lineOnTop([89.9, 0], [89.9, 4.2], 9.6, P), { tone: "lo" }));
  out.push(D([at([89.9, -1, 9.6])], { size: 0.4, tone: "lo" }));
  return out.join("");
}

function rackSlots() {
  const out = [];
  for (let i = 0; i <= PLATES; i++) {
    const x = RACK_START - PITCH / 2 + i * PITCH;
    if (x < RACK.x + 2 || x > RACK.x + RACK.w - 2) continue;
    out.push(S(k.slabOf({ x: x - 0.6, y: -13, w: 1.2, d: 26, r: 0.35 }, RACK_Z, RIB_TOP - RACK_Z, P, 2, 0.25), { tone: "mid", crease: "lo" }));
    if (i % 6 === 0) {
      out.push(S(k.slabOf({ x: x - 4, y: 11.5, w: 8, d: 9, r: 1 }, 4.3, 0.9, P, 3, 0.25), { tone: "mid" }));
      out.push(S(k.cylinder(x, 19.4, 1.5, 0, 4.8, P, 12), { tone: "mid" }));
      out.push(D([at([x, 19.4, 5.4])], { size: 0.55, tone: "mid" }));
    }
  }
  return out.join("");
}

function rackFront() {
  const out = [];
  out.push(S(k.slabOf({ x: RACK.x, y: RACK.y + RACK.d - 4, w: RACK.w, d: 4, r: 1 }, 0, 4.4, P, 4, 0.5), { tone: "mid" }));
  // Station ruler on the lip face.
  const ticks = k.sideTicks(RACK_START - 4, RACK_START + (PLATES - 1) * PITCH + 4, 4.7, 5, 18, 4.4, [1.4, 2.9], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  // Shaft and bearings below the lip.
  out.push(L(k.segment([-203, 19.5, 2.2], [64, 19.5, 2.2], P), { tone: "lo" }));
  for (const x of [-120, -28, 56]) {
    out.push(S(k.slabOf({ x: x - 3.5, y: 17.4, w: 7, d: 5, r: 1 }, 0, 3.2, P, 3, 0.4), { tone: "mid" }));
    out.push(D([at([x, 20.4, 3.2])], { size: 0.4, tone: "mid" }));
    out.push(S(k.slabOf({ x: x - 1.1, y: 17.9, w: 2.2, d: 3.4, r: 0.5 }, 0, 3.4, P, 3), { tone: "lo" }));
  }
  return out.join("");
}

// ---------------------------------------------------------------------------
// Lamp reader
// ---------------------------------------------------------------------------
function lampPost() {
  const out = [];
  const [x, y] = [LAMP.x, LAMP.y];
  out.push(S(k.cylinder(x, y, 8, 0, 2.2, P, 28), { tone: "lo" }));
  out.push(S(k.cylinder(x, y, 6.2, 2.2, 3, P, 28), { tone: "mid" }));
  for (const dx of [-4.6, 4.6]) {
    out.push(S(k.slabOf({ x: x + dx - 1.1, y: y - 1.4, w: 2.2, d: 5.6, r: 0.6 }, 2.2, 7, P, 3, 0.25), { tone: "mid" }));
  }
  out.push(S(k.cylinder(x, y, 4.6, 5.2, LAMP_TOP - 5.2, P, 28), { tone: "mid", crease: "none" }));
  out.push(L([12, 24, 36].map((z) => k.sideArc(x, y, 4.6, z, P, 20)).join(""), { tone: "faint" }));
  out.push(S(k.cylinder(x, y, 6, 39, 3.4, P, 28), { tone: "mid" }));
  out.push(S(k.slabOf({ x: x - 6.5, y: y - 6.5, w: 13, d: 13, r: 2 }, LAMP_PIVOT_Z - 3.4, 8, P, 4, 0.6), { tone: "mid" }));
  out.push(S(k.cylinder(x, y, 4.8, LAMP_TOP - 2, 2.6, P, 24), { tone: "mid" }));
  out.push(D([at([x - 4.4, y - 4.4, 52.4]), at([x + 4.4, y - 4.4, 52.4]), at([x - 4.4, y + 4.4, 52.4]), at([x + 4.4, y + 4.4, 52.4])], { size: 0.45, tone: "mid" }));
  out.push(D([at([x, y - 6.5, 52.4])], { size: 0.8, tone: "hi" }));
  out.push(screw(x + 8.2, y - 3.4, 3.6, 1.4));
  out.push(screw(x + 8.2, y + 3.4, 3.6, 1.4));
  return out.join("");
}

function lampArm() {
  const out = [];
  const [x, y] = [LAMP.x, LAMP.y];
  const arm = { x: x - 4, y: y - 4, w: 8, d: 50, r: 2 };
  const armZ = LAMP_PIVOT_Z - 2.4;
  out.push(S(k.slabOf(arm, armZ, 4.4, P, 4, 0.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(arm, 1.4), armZ + 4.4, P, 4), { tone: "faint" }));
  out.push(L(k.lineOnTop([x, y + 4], [x, y + 38], armZ + 4.4, P), { tone: "faint" }));
  out.push(S(k.slabOf({ x: x - 3, y: y + 44, w: 6, d: 8, r: 1.5 }, armZ - 0.6, 5.6, P, 3, 0.4), { tone: "mid" }));
  // Counterweight behind the pivot.
  out.push(S(k.slabOf({ x: x - 4.5, y: y - 6, w: 9, d: 6, r: 1.2 }, armZ - 0.4, 5.2, P, 3, 0.4), { tone: "mid" }));
  out.push(D([at([x - 2, y - 3, armZ + 4.8]), at([x + 2, y - 3, armZ + 4.8])], { size: 0.4, tone: "mid" }));
  // Hanging stem and shade.
  out.push(S(k.cylinder(x, y + 47, 2.2, LAMP_HEAD_Z + 10, armZ - LAMP_HEAD_Z - 10, P, 16), { tone: "mid" }));
  out.push(S(k.cylinder(x, y + 47, 8, LAMP_HEAD_Z + 4, 6.2, P, 32, 0.8), { tone: "hi", crease: "lo", lit: true }));
  out.push(S(k.cylinder(x, y + 47, 8.8, LAMP_HEAD_Z + 7.2, 1.6, P, 32, 0.3), { tone: "mid" }));
  out.push(L(k.knurl(x, y + 47, 8.8, LAMP_HEAD_Z + 7.2, LAMP_HEAD_Z + 8.8, 36, P), { tone: "lo" }));
  out.push(S(k.cylinder(x, y + 47, 6.4, LAMP_HEAD_Z, 4, P, 28), { tone: "mid", crease: "lo" }));
  out.push(L(k.ring(x, y + 47, 4.4, LAMP_HEAD_Z, P, 20), { tone: "lo" }));
  out.push(D([at([x, y + 47, LAMP_HEAD_Z])], { size: 1.1, tone: "hi" }));
  out.push(L(k.sideArc(x, y + 47, 6.4, LAMP_HEAD_Z + 0.6, P, 24), { tone: "faint" }));
  return out.join("");
}

// ---------------------------------------------------------------------------
// Inspector press
// ---------------------------------------------------------------------------
function stampStatic() {
  const out = [];
  const [x, y] = [STAMP.x, STAMP.y];
  out.push(S(k.slabOf({ x: x - 14, y: y - 14, w: 28, d: 28, r: 3 }, 0, 1.8, P, 4, 0.5), { tone: "mid" }));
  out.push(S(k.slabOf({ x: x - 11, y: y - 11, w: 22, d: 22, r: 2.4 }, 1.8, 4.4, P, 4, 0.7), { tone: "mid" }));
  for (const [dx, dy] of [[7.2, 7.2], [-7.2, 7.2], [7.2, -7.2], [-7.2, -7.2]]) out.push(screw(x + dx, y + dy, 6.2, 1.6));
  for (const [dx, dy] of [[10.4, 0], [-10.4, 0], [0, 10.4], [0, -10.4]]) {
    out.push(S(k.slabOf({ x: x + dx - 2, y: y + dy - 2, w: 4, d: 4, r: 0.8 }, 1.8, 9, P, 3, 0.25), { tone: "mid" }));
  }
  out.push(S(k.slabOf({ x: x - 6.5, y: y - 6.5, w: 13, d: 13, r: 1.6 }, 6.2, STAMP_TOP - 6.2, P, 4, 0.8), { tone: "mid" }));
  out.push(L(k.sideSeam({ x: x - 6.5, y: y - 6.5, w: 13, d: 13, r: 1.6 }, 18, P, 4), { tone: "faint" }));
  out.push(L(k.sideSeam({ x: x - 6.5, y: y - 6.5, w: 13, d: 13, r: 1.6 }, 44, P, 4), { tone: "faint" }));
  out.push(S(k.slabOf({ x: x - 8.5, y: y - 8.5, w: 17, d: 17, r: 2 }, 50, 5, P, 4, 0.5), { tone: "mid" }));
  out.push(D([at([x - 6, y - 6, 55]), at([x + 6, y - 6, 55]), at([x - 6, y + 6, 55]), at([x + 6, y + 6, 55])], { size: 0.45, tone: "mid" }));
  const ticks = k.sideTicks(y - 6.5, y + 6.5, 5, 4, x + 6.5, 50, [1.2, 2.5], P, "y");
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(S(k.slabOf({ x: x - 8, y: y - 8, w: 16, d: 16, r: 1.6 }, STAMP_TOP - 4, 4, P, 4, 0.6), { tone: "mid" }));
  out.push(S(k.slabOf({ x: x - 5.5, y: y - 5.5, w: 11, d: 11, r: 1.4 }, STAMP_TOP, 2.2, P, 4, 0.4), { tone: "mid" }));
  // Cantilever arm and its gusset.
  const arm = { x: x - 5.5, y: y - 6, w: 11, d: 54, r: 1.8 };
  out.push(S(k.slabOf({ x: x - 5.5, y: y - 6, w: 11, d: 54, r: 1.8 }, 58, 5, P, 4, 0.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(arm, 1.4), 63, P, 4), { tone: "faint" }));
  out.push(S(k.slabOf({ x: x - 5, y: y - 4, w: 10, d: 12, r: 1.5 }, 48, 10, P, 4, 0.5), { tone: "mid" }));
  out.push(D([at([x - 3.4, y + 3, 63]), at([x + 3.4, y + 3, 63]), at([x, y + 40, 63])], { size: 0.4, tone: "mid" }));
  return out.join("");
}

function stampSleeve() {
  const out = [];
  const x = STAMP.x;
  out.push(S(k.cylinder(x, 0, 6.2, 41, 15, P, 32, 0.7), { tone: "mid", crease: "lo" }));
  out.push(L(k.knurl(x, 0, 6.2, 43, 55, 32, P), { tone: "lo" }));
  out.push(S(k.cylinder(x, 0, 7.2, 41, 2.4, P, 32, 0.4), { tone: "mid" }));
  out.push(S(k.cylinder(x, 0, 5, 56, 3.2, P, 24), { tone: "mid" }));
  out.push(S(k.slabOf({ x: x - 6, y: -7, w: 12, d: 14, r: 1.5 }, 58, 6, P, 4, 0.5), { tone: "mid" }));
  return out.join("");
}

function stampRam() {
  const out = [];
  const [x] = [STAMP.x];
  out.push(S(k.cylinder(x, 0, 2.6, RAM_TOP, 27, P, 16), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf({ x: x - 6.5, y: -9.5, w: 13, d: 19, r: 1.6 }, RAM_TOP - 12, 12, P, 4, 0.8), { tone: "hi", crease: "lo" }));
  out.push(L(k.planOutline(k.insetPlan({ x: x - 6.5, y: -9.5, w: 13, d: 19, r: 1.6 }, 1.5), RAM_TOP, P, 4), { tone: "faint" }));
  out.push(S(k.cylinder(x, 0, 4.6, RAM_TOP - 13.4, 1.4, P, 24), { tone: "mid" }));
  out.push(S(k.slabOf({ x: x - 5.6, y: -8, w: 11.2, d: 16, r: 1.2 }, RAM_TOP - 14, 1.6, P, 3, 0.35), { tone: "mid", crease: "lo" }));
  out.push(S(k.slabOf({ x: x - 3.1, y: -7, w: 6.2, d: 14, r: 0.9 }, RAM_TOP - 15.4, 1.4, P, 3, 0.3), { tone: "hi", crease: "lo" }));
  out.push(L(k.planOutline(k.insetPlan({ x: x - 3.1, y: -7, w: 6.2, d: 14, r: 0.9 }, 0.9), RAM_TOP - 15.4, P, 3), { tone: "faint" }));
  out.push(D([at([x - 5, 6.4, RAM_TOP - 0.1]), at([x + 5, 6.4, RAM_TOP - 0.1])], { size: 0.4, tone: "lo" }));
  return out.join("");
}

// ---------------------------------------------------------------------------
// Transfer table, drawer, shelf
// ---------------------------------------------------------------------------
function tableStatic() {
  const out = [];
  out.push(S(k.slabOf({ x: TABLE.x, y: TABLE.y, w: TABLE.w, d: TABLE.d, r: TABLE.r }, 0, 1.6, P, 4, 0.35), { tone: "mid" }));
  for (const [x, y] of k.corners(TABLE, 3)) out.push(screw(x, y, 1.6, 1.2));
  for (const x of [TABLE.x, TABLE.x + TABLE.w - 2]) {
    out.push(S(k.slabOf({ x, y: -4, w: 2, d: 8, r: 0.6 }, 1.4, 3.2, P, 3, 0.3), { tone: "mid" }));
    out.push(D([at([x + 1, 0, 4.6])], { size: 0.4, tone: "mid" }));
  }
  out.push(S(k.slabOf({ x: TABLE.x + 2, y: TABLE.y + 2, w: TABLE.w - 4, d: 3, r: 0.8 }, 1.6, 1.2, P, 3), { tone: "mid" }));
  out.push(D([at([TABLE.x + 4, TABLE.y + 3, 1.6]), at([TABLE.x + TABLE.w - 4, TABLE.y + 3, 1.6])], { size: 0.35, tone: "lo" }));
  return out.join("");
}

function tableTray() {
  const out = [];
  const plan = { x: TABLE.x + 1.5, y: TABLE.y + 3.5, w: TABLE.w - 3, d: TABLE.d - 7, r: 1.3 };
  out.push(S(k.slabOf(plan, TABLE_Z, 0.9, P, 4, 0.3), { tone: "hi", crease: "lo" }));
  out.push(L(k.planOutline(k.insetPlan(plan, 1), TABLE_Z + 0.9, P, 4), { tone: "faint" }));
  for (const y of [plan.y, plan.y + plan.d - 1.4]) {
    out.push(S(k.slabOf({ x: plan.x, y, w: plan.w, d: 1.4, r: 0.5 }, TABLE_Z + 0.9, 1.5, P, 3, 0.25), { tone: "mid" }));
  }
  return out.join("");
}

function drawerStatic() {
  const out = [];
  const { x, y, w, d } = DRAWER;
  out.push(S(k.slabOf({ x, y, w, d, r: 2 }, 0, 2, P, 4, 0.35), { tone: "mid" }));
  out.push(S(k.slabOf({ x, y, w, d: 3, r: 1 }, 2, 19, P, 4, 0.4), { tone: "mid" }));
  out.push(S(k.slabOf({ x, y: y + d - 3, w, d: 3, r: 1 }, 2, 19, P, 4, 0.4), { tone: "mid" }));
  out.push(S(k.slabOf({ x, y, w: 3, d, r: 1 }, 2, 19, P, 4, 0.4), { tone: "mid" }));
  out.push(S(k.slabOf({ x: x + w - 3, y, w: 3, d, r: 1 }, 2, 19, P, 4, 0.4), { tone: "mid" }));
  // The two curated plates waiting inside.
  for (let i = 0; i < CURATED_PER_SERIES; i++) {
    out.push(S(k.slabOf({ x: x + 22 - PLATE_W / 2, y: 42 - PLATE_D / 2, w: PLATE_W, d: PLATE_D, r: 0.9 }, 2.2 + i * 2.7, PLATE_H, P, 3, 0.3), { tone: "hi", crease: "lo" }));
    out.push(L(k.lineOnTop([x + 19.5, 34], [x + 19.5, 50], 2.2 + i * 2.7 + PLATE_H, P), { tone: "lo", free: true }));
  }
  // Drawer front, pull, label.
  out.push(S(k.slabOf({ x: x + 3, y: y + d - 0.8, w: w - 6, d: 2.6, r: 1 }, 4, 13, P, 4, 0.45), { tone: "mid" }));
  out.push(L(k.sideSeam({ x: x + 3, y: y + d - 0.8, w: w - 6, d: 2.6, r: 1 }, 10, P, 4), { tone: "faint" }));
  out.push(S(k.slabOf({ x: x + 13, y: y + d + 0.6, w: 24, d: 1.4, r: 0.6 }, 7, 7, P, 3, 0.25), { tone: "hi", crease: "lo" }));
  out.push(L(k.segment([x + 16, y + d + 2.05, 12.4], [x + 30, y + d + 2.05, 12.4], P), { tone: "lo", free: true }));
  out.push(L(k.segment([x + 16, y + d + 2.05, 10.4], [x + 26, y + d + 2.05, 10.4], P), { tone: "lo", free: true }));
  out.push(D([at([x + 15, y + d + 2.05, 13.6]), at([x + 35, y + d + 2.05, 13.6])], { size: 0.35, tone: "mid" }));
  for (const px of [x + 20, x + 38]) {
    out.push(S(k.slabOf({ x: px, y: y + d - 0.8, w: 2.4, d: 4.4, r: 0.7 }, 9, 5.6, P, 3, 0.2), { tone: "mid" }));
  }
  out.push(S(k.slabOf({ x: x + 17, y: y + d + 2.8, w: 26, d: 2.6, r: 1 }, 14, 2.2, P, 3, 0.3), { tone: "mid" }));
  // Turn latch and face screws.
  out.push(S(k.slabOf({ x: x + 48, y: y + d + 1.4, w: 5, d: 2, r: 0.7 }, 9, 4, P, 3, 0.25), { tone: "mid" }));
  out.push(D([at([x + 50.5, y + d + 3.4, 13])], { size: 0.8, tone: "hi" }));
  for (const [fx, fz] of [[x + 6, 6], [x + w - 6, 6], [x + 6, 15], [x + w - 6, 15]]) {
    out.push(L(k.sideRing([fx, y + d + 2.1, fz], 1.5, "y", P, 16), { tone: "lo" }));
    out.push(D([at([fx, y + d + 2.1, fz])], { size: 0.35, tone: "mid" }));
  }
  // Corner straps.
  for (const [sx, sy] of [[x + 2, y + 2], [x + w - 8, y + 2], [x + 2, y + d - 8], [x + w - 8, y + d - 8]]) {
    out.push(S(k.slabOf({ x: sx, y: sy, w: 6, d: 6, r: 1 }, 21, 0.8, P, 3), { tone: "lo" }));
  }
  return out.join("");
}

function drawerLid() {
  const out = [];
  const lid = { x: DRAWER.x - 2, y: DRAWER.y - 2, w: DRAWER.w + 4, d: DRAWER.d + 4, r: 2.5 };
  out.push(S(k.slabOf(lid, DRAWER_TOP, DRAWER_LID, P, 4, 0.8), { tone: "mid", crease: "lo" }));
  out.push(L(k.planOutline(k.insetPlan(lid, 3), DRAWER_TOP + DRAWER_LID, P, 4), { tone: "faint" }));
  out.push(L(k.lineOnTop([lid.x + 5, lid.y + lid.d / 2], [lid.x + lid.w - 5, lid.y + lid.d / 2], DRAWER_TOP + DRAWER_LID, P), { tone: "faint" }));
  // Hinge rod along the back edge.
  out.push(L(k.segment([lid.x + 8, lid.y + 1, DRAWER_TOP + 1.8], [lid.x + lid.w - 8, lid.y + 1, DRAWER_TOP + 1.8], P), { tone: "lo" }));
  // Two steel straps across the lid.
  for (const sx of [lid.x + 9, lid.x + lid.w - 13]) {
    out.push(S(k.slabOf({ x: sx, y: lid.y + 3, w: 4, d: lid.d - 6, r: 0.8 }, DRAWER_TOP + DRAWER_LID, 0.7, P, 3, 0.2), { tone: "mid", crease: "lo" }));
    out.push(D([at([sx + 2, lid.y + 6, DRAWER_TOP + DRAWER_LID + 0.7]), at([sx + 2, lid.y + lid.d - 6, DRAWER_TOP + DRAWER_LID + 0.7])], { size: 0.4, tone: "mid" }));
  }
  out.push(S(k.slabOf({ x: DRAWER.x + 21, y: lid.y + lid.d - 2, w: 16, d: 3, r: 0.8 }, DRAWER_TOP + DRAWER_LID, 2.2, P, 3, 0.25), { tone: "mid" }));
  for (const hx of [DRAWER.x + 10, DRAWER.x + 46]) {
    out.push(S(k.slabOf({ x: hx, y: lid.y - 1.4, w: 4, d: 3.4, r: 0.7 }, DRAWER_TOP - 0.6, 3.4, P, 3, 0.3), { tone: "mid" }));
    out.push(D([at([hx + 2, lid.y - 0.2, DRAWER_TOP + 2.8])], { size: 0.35, tone: "mid" }));
  }
  return out.join("");
}

function shelfStatic() {
  const out = [];
  const { x, y, w, d } = SHELF;
  out.push(S(k.slabOf({ x, y, w, d, r: 2 }, 0, 2.4, P, 4, 0.5), { tone: "mid" }));
  out.push(S(k.slabOf({ x, y, w, d: 2.4, r: 0.8 }, 2.4, 6.2, P, 4, 0.3), { tone: "mid" }));
  out.push(L(k.sideSeam({ x, y, w, d: 2.4, r: 0.8 }, 5, P, 4), { tone: "faint" }));
  out.push(S(k.slabOf({ x, y, w: 2.4, d, r: 0.8 }, 2.4, 4.6, P, 4, 0.3), { tone: "mid" }));
  out.push(S(k.slabOf({ x: x + w - 2.4, y, w: 2.4, d, r: 0.8 }, 2.4, 4.6, P, 4, 0.3), { tone: "mid" }));
  // Front lip with its label.
  out.push(S(k.slabOf({ x, y: y + d - 3, w, d: 3, r: 1 }, 2.4, 2.2, P, 3, 0.35), { tone: "mid" }));
  out.push(S(k.slabOf({ x: x + 8, y: y + d - 1.2, w: 26, d: 1.2, r: 0.5 }, 4.6, 3.6, P, 3, 0.25), { tone: "hi", crease: "lo" }));
  out.push(L(k.segment([x + 11, y + d + 0.05, 7.4], [x + 27, y + d + 0.05, 7.4], P), { tone: "lo", free: true }));
  out.push(L(k.segment([x + 11, y + d + 0.05, 6.1], [x + 22, y + d + 0.05, 6.1], P), { tone: "lo", free: true }));
  // A board of eight vertical dividers; one flat plate in each slot.
  for (let i = 0; i < SHELF_SLOTS; i++) {
    const dx = x + 4 + i * 7.2;
    out.push(S(k.slabOf({ x: dx, y: y + 4, w: 0.9, d: 28, r: 0.3 }, 2.4, 5.6, P, 2, 0.2), { tone: "mid", crease: "lo" }));
    const px = dx + 3.5;
    if (i < SHELF_FILLED) {
      out.push(S(k.slabOf({ x: px - PLATE_W / 2, y: y + 6, w: PLATE_W, d: PLATE_D, r: 0.9 }, 2.4, PLATE_H, P, 3, 0.3), { tone: "hi", crease: "lo" }));
      out.push(L(k.lineOnTop([px - PLATE_W / 2 + 1.7, y + 10], [px - PLATE_W / 2 + 1.7, y + 24], 2.4 + PLATE_H, P), { tone: "lo", free: true }));
      out.push(D([at([px, y + 27, 2.4 + PLATE_H])], { size: 0.35, tone: "lo" }));
    }
  }
  for (const sx of [x + 3, x + w - 3]) out.push(D([at([sx, y + d - 3, 2.4])], { size: 0.4, tone: "mid" }));
  for (const sx of [x + 7, x + w - 7]) out.push(D([at([sx, y + d - 1.2, 4.6])], { size: 0.45, tone: "mid" }));
  return out.join("");
}

// ---------------------------------------------------------------------------
// Dial, crank, card feed
// ---------------------------------------------------------------------------
function dialStatic() {
  const out = [];
  const [x, y] = DIAL;
  out.push(S(k.cylinder(x, y, 21, 0, 2.2, P, 40), { tone: "lo" }));
  out.push(S(k.cylinder(x, y, 19, 2.2, 2.8, P, 40), { tone: "mid" }));
  out.push(D([at([x - 17, y + 8, 2.2]), at([x + 17, y + 8, 2.2])], { size: 0.45, tone: "mid" }));
  out.push(S(k.cylinder(x, y, DIAL_R, DIAL_Z, DIAL_H, P, 64, 0.8), { tone: "hi", crease: "lo" }));
  out.push(L(k.knurl(x, y, DIAL_R, DIAL_TOP - 2.6, DIAL_TOP, 72, P, 0.3), { tone: "lo" }));
  out.push(L(k.sideArc(x, y, DIAL_R, DIAL_TOP - 2.6, P, 36), { tone: "faint" }));
  out.push(L(k.ring(x, y, DIAL_R - 2.2, DIAL_TOP, P, 64), { tone: "lo" }));
  const ticks = k.radialTicks(x, y, DIAL_R - 3.2, PLATES * 2, 2, DIAL_TOP, [1.3, 2.8], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(L(k.ring(x, y, 2.3, DIAL_TOP, P, 20), { tone: "mid" }));
  out.push(D([at([x, y - (DIAL_R - 1.2), DIAL_TOP])], { size: 0.7, tone: "hi" }));
  return out.join("");
}

function crankStatic() {
  const out = [];
  const { x, y, w, d } = CRANK;
  out.push(S(k.slabOf({ x, y, w, d, r: 2 }, 0, 9, P, 4, 0.6), { tone: "mid" }));
  out.push(L(k.sideSeam({ x, y, w, d, r: 2 }, 4.4, P, 4), { tone: "faint" }));
  out.push(L(k.lineOnTop([x + 4, y + 8], [x + 15, y + 8], 9, P), { tone: "lo", free: true }));
  out.push(L(k.lineOnTop([x + 12, y + 6], [x + 15, y + 8], 9, P), { tone: "lo", free: true }));
  out.push(L(k.lineOnTop([x + 12, y + 10], [x + 15, y + 8], 9, P), { tone: "lo", free: true }));
  for (const [dx, dy] of [[4, 4], [w - 4, 4], [4, d - 4], [w - 4, d - 4]]) out.push(screw(x + dx, y + dy, 9, 1.3));
  out.push(S(k.cylinder(x + w / 2, y + d / 2, 5.2, 9, 3.2, P, 28), { tone: "mid" }));
  out.push(S(k.cylinder(x + w / 2, y + d / 2, 2.4, 12.2, 5.4, P, 16), { tone: "mid" }));
  for (let i = 0; i < 3; i++) out.push(S(k.cylinder(x + w / 2, y + d / 2, 5.4, 12.2 + i * 1.5, 0.8, P, 24), { tone: "lo" }));
  return out.join("");
}

function crankKnob() {
  const out = [];
  const [x, y] = [CRANK.x + CRANK.w / 2, CRANK.y + CRANK.d / 2];
  const armZ = 21.4, armT = 2.6;
  const tipX = x + 15;
  // Shaft collar, hub, arm and grip: a hand crank the reader can press.
  out.push(S(k.cylinder(x, y, 2.4, 17.4, 2.2, P, 16), { tone: "mid" }));
  out.push(S(k.cylinder(x, y, 5.8, armZ - 4, 4, P, 32, 0.5), { tone: "hi", crease: "lo" }));
  out.push(S(k.extrude(barRing([x, y], [tipX, y], 2.6), armZ, armT, P, { bevel: 0.35 }), { tone: "hi", crease: "lo" }));
  out.push(S(k.cylinder(tipX, y, 3.8, armZ, armT, P, 24, 0.4), { tone: "mid" }));
  out.push(S(k.cylinder(tipX, y, 1.8, armZ + armT, 3.4, P, 16), { tone: "mid" }));
  out.push(S(k.cylinder(tipX, y, 4.2, armZ + armT + 3.4, 6.6, P, 32, 0.7), { tone: "hi", crease: "lo" }));
  out.push(L(k.knurl(tipX, y, 4.2, armZ + armT + 3.4, armZ + armT + 10, 36, P), { tone: "lo" }));
  out.push(L(k.ring(tipX, y, 3.2, armZ + armT + 10, P, 32), { tone: "lo" }));
  out.push(S(k.cylinder(tipX, y, 3.2, armZ + armT + 10, 1.2, P, 32, 0.3), { tone: "mid" }));
  out.push(D([at([tipX, y, armZ + armT + 11.4])], { size: 1.1, tone: "hi" }));
  out.push(`<circle cx="${at([x + 6, y, 20])[0]}" cy="${at([x + 6, y, 20])[1]}" r="34" fill="transparent" style="cursor:pointer" data-crank-hit=""/>`);
  return out.join("");
}

function cardStatics() {
  const out = [];
  // Open-topped card dispenser: floor, back, left and a slotted right wall.
  out.push(S(k.slabOf(HEAD, 0, 1.2, P, 4, 0.3), { tone: "mid" }));
  out.push(S(k.slabOf({ x: HEAD.x, y: HEAD.y, w: HEAD.w, d: 2.4, r: 0.7 }, 1.2, 8, P, 3, 0.3), { tone: "mid" }));
  out.push(S(k.slabOf({ x: HEAD.x, y: HEAD.y + HEAD.d - 2.4, w: HEAD.w, d: 2.4, r: 0.7 }, 1.2, 2.2, P, 3, 0.3), { tone: "mid" }));
  out.push(S(k.slabOf({ x: HEAD.x, y: HEAD.y, w: 2.4, d: HEAD.d, r: 0.7 }, 1.2, 8, P, 3, 0.3), { tone: "mid" }));
  out.push(S(k.slabOf({ x: HEAD.x + HEAD.w - 2.4, y: HEAD.y, w: 2.4, d: HEAD.d, r: 0.7 }, 1.2, 1.2, P, 3, 0.25), { tone: "mid" }));
  out.push(S(k.slabOf({ x: HEAD.x + HEAD.w - 2.4, y: HEAD.y, w: 2.4, d: HEAD.d, r: 0.7 }, 2.8, 4.4, P, 3, 0.25), { tone: "mid" }));
  out.push(L(k.sideSeam(HEAD, 4.8, P, 4), { tone: "faint" }));
  // Stack of question cards waiting inside.
  for (let i = 0; i < QUESTIONS; i++) {
    out.push(S(k.slabOf({ x: HEAD.x + 3.2, y: HEAD.y + 3.4, w: 6.2, d: 9, r: 0.5 }, 1.4 + i * 0.66, 0.55, P, 3, 0.18), { tone: "hi", crease: "lo" }));
    out.push(L(k.lineOnTop([HEAD.x + 3.8, HEAD.y + 5], [HEAD.x + 8.6, HEAD.y + 5], 1.95 + i * 0.66, P), { tone: "lo", free: true }));
  }
  // Chute and tray.
  out.push(S(k.slabOf({ x: -186, y: 28, w: 14, d: 16, r: 1.2 }, 0, 1.2, P, 3, 0.3), { tone: "mid" }));
  out.push(S(k.slabOf(TRAY, 0, 1.2, P, 4, 0.4), { tone: "mid" }));
  for (const wall of [
    { x: TRAY.x, y: TRAY.y, w: TRAY.w, d: 2.4 },
    { x: TRAY.x, y: TRAY.y + TRAY.d - 2.4, w: TRAY.w, d: 2.4 },
    { x: TRAY.x + TRAY.w - 2.4, y: TRAY.y, w: 2.4, d: TRAY.d },
  ]) {
    out.push(S(k.slabOf({ ...wall, r: 0.7 }, 0, 2.2, P, 3, 0.25), { tone: "mid" }));
    out.push(D([at([wall.x + 2, wall.y + wall.d / 2, 2.2])], { size: 0.3, tone: "lo" }));
  }
  for (let i = 1; i < QUESTIONS; i++) {
    const x = TRAY.x + 5.5 + i * CARD_STEP - CARD_STEP / 2 + 0.4;
    out.push(S(k.slabOf({ x, y: TRAY.y + 3, w: 0.6, d: TRAY.d - 6, r: 0.2 }, 1.2, 2, P, 2), { tone: "lo" }));
  }
  // Return mouth at the right of the tray.
  out.push(S(k.slabOf({ x: TRAY.x + TRAY.w - 8, y: TRAY.y + 2, w: 7, d: TRAY.d - 4, r: 1 }, 1.2, 3.4, P, 3, 0.3), { tone: "mid" }));
  out.push(L(k.lineOnTop([TRAY.x + TRAY.w - 7.6, TRAY.y + 4], [TRAY.x + TRAY.w - 7.6, TRAY.y + TRAY.d - 4], 4.6, P), { tone: "lo" }));
  out.push(D([at([TRAY.x + 4, TRAY.y + 3, 2.2]), at([TRAY.x + 4, TRAY.y + TRAY.d - 3, 2.2])], { size: 0.35, tone: "mid" }));
  return out.join("");
}

// ---------------------------------------------------------------------------
// Assemble
// ---------------------------------------------------------------------------
const plateBody = plateMarkup();
const cardBody = cardMarkup();

const plates = Array.from({ length: PLATES + 1 }, (_, index) => {
  const station = index === 0 ? MAG_STATION : index - 1;
  const z = station === MAG_STATION ? MAG_Z : RACK_Z;
  return `<g data-plate="${index}" transform="${k.translateAlong(P, [stationX(station), 0, z])}">${plateBody}</g>`;
}).join("");

const cards = Array.from({ length: QUESTIONS + 1 }, (_, index) => {
  const pos = index;
  const x = pos === 0 ? -181 : TRAY.x + 5.5 + (pos - 1) * CARD_STEP;
  const y = pos === 0 ? 35 : TRAY.y + 7;
  const z = pos === 0 ? 2.4 : CARD_Z + (pos - 1) * 0.08;
  return `<g data-card="${index}" transform="${k.translateAlong(P, [x, y, z])}">${cardBody}</g>`;
}).join("");

const needleAt = (value) => {
  const angle = value * Math.PI * 2;
  return k.lineOnTop(
    [DIAL[0] - Math.sin(angle) * 3.2, DIAL[1] + Math.cos(angle) * 3.2],
    [DIAL[0] + Math.sin(angle) * (DIAL_R - 4), DIAL[1] - Math.cos(angle) * (DIAL_R - 4)],
    DIAL_TOP + 0.15,
    P,
  );
};

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    "The review gate: a long bedplate carries a rack of twenty-four plates, one per station. A reader lamp on a post dips over the plate at its station, a drafting head feeds question cards into a tray, and a press stamps each plate as it passes the inspector column. At the end a tilting table sends each plate either into a closed lidded drawer or onto an open shelf with eight dividers. A dial counts the twenty-four-plate series.",
  body: [
    basePlate(),
    driveBar(),
    shelfStatic(),
    lampPost(),
    stampStatic(),
    rackBack(),
    plates,
    rackSlots(),
    rackFront(),
    tableStatic(),
    sortChutes(),
    cardStatics(),
    `<g data-part="ram">${stampRam()}</g>`,
    `<g data-part="sleeve">${stampSleeve()}</g>`,
    `<g data-part="lamp">${lampArm()}</g>`,
    drawerStatic(),
    `<g data-part="sort" style="display:none">${plateBody}</g>`,
    `<g data-part="lid">${drawerLid()}</g>`,
    `<g data-part="table">${tableTray()}</g>`,
    `<g data-part="vane">${vane()}</g>`,
    dialStatic(),
    `<path data-part="needle" class="iso-line" data-tone="hi" d="${needleAt(START_STEP / PLATES)}" style="stroke-width:1.2"/>`,
    crankStatic(),
    `<g data-part="crank">${crankKnob()}</g>`,
    cards,
  ].join(""),
});

// ---------------------------------------------------------------------------
// Live model
// ---------------------------------------------------------------------------
const live = `
const P = ${JSON.stringify(P)};
const PLATES = ${PLATES}, QUESTIONS = ${QUESTIONS}, CURATED = ${CURATED}, OPEN = ${OPEN}, CORPUS = ${CORPUS};
const CURATED_AT = ${JSON.stringify(CURATED_AT)};
const START_STEP = ${START_STEP};
const RACK_START = ${RACK_START}, PITCH = ${PITCH}, RACK_Z = ${RACK_Z};
const MAG_STATION = ${MAG_STATION}, MAG_Z = ${MAG_Z};
const TABLE_Z = ${TABLE_Z};
const TABLE = ${JSON.stringify(TABLE)};
const DIAL = ${JSON.stringify(DIAL)}, DIAL_R = ${DIAL_R}, DIAL_TOP = ${DIAL_TOP};
const LAMP_PIVOT = ${JSON.stringify(at([LAMP.x, LAMP.y, LAMP_PIVOT_Z]))};
const RAM_STROKE = ${RAM_STROKE};
const DRAWER_DEST = ${JSON.stringify([DRAWER.x + 26, 46, 4.4])};
const SHELF_DEST = ${JSON.stringify([SHELF.x + 32, -48, 3.2])};
const LID_HINGE = ${JSON.stringify(at([DRAWER.x + DRAWER.w / 2, DRAWER.y - 2, DRAWER_TOP + DRAWER_LID]))};
const TABLE_PIVOT = ${JSON.stringify(at([TABLE_CENTER[0], TABLE_CENTER[1], TABLE_Z]))};
const VANE_PIVOT = ${JSON.stringify(at([90, 0, 7.4]))};
const CARD_STEP = ${CARD_STEP}, CARD_Z = ${CARD_Z};
const TRAY = ${JSON.stringify(TRAY)};
const DURATION = 2.18;

const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const plateEls = [...svg.querySelectorAll("[data-plate]")];
const cardEls = [...svg.querySelectorAll("[data-card]")];
const lampEl = svg.querySelector('[data-part="lamp"]');
const ramEl = svg.querySelector('[data-part="ram"]');
const lidEl = svg.querySelector('[data-part="lid"]');
const tableEl = svg.querySelector('[data-part="table"]');
const vaneEl = svg.querySelector('[data-part="vane"]');
const crankEl = svg.querySelector('[data-part="crank"]');
const sortEl = svg.querySelector('[data-part="sort"]');
const needle = svg.querySelector('[data-part="needle"]');
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const stationX = (s) => RACK_START + s * PITCH;

const plates = plateEls.map((el, index) => ({
  el,
  station: index === 0 ? MAG_STATION : index - 1,
}));
const cards = cardEls.map((el, index) => ({ el, pos: index }));

let reviewed = ${START_STEP};
let openCount = ${START_OPEN};
let curatedCount = ${START_CURATED};
let busy = false;
let visible = false;
let touring = false;
let idleTimer = 0;
let tourTimer = 0;
let resetTimer = 0;

function cardPos(pos) {
  if (pos === 0) return [-181, 35, 2.4];
  return [TRAY.x + 5.5 + (pos - 1) * CARD_STEP, TRAY.y + 7, CARD_Z + (pos - 1) * 0.08];
}

function drawNeedle(value) {
  const angle = value * Math.PI * 2;
  const x = DIAL[0], y = DIAL[1];
  const tail = [x - Math.sin(angle) * 3.2, y + Math.cos(angle) * 3.2];
  const tip = [x + Math.sin(angle) * (DIAL_R - 4), y - Math.cos(angle) * (DIAL_R - 4)];
  needle.setAttribute("d", lineOnTop(tail, tip, DIAL_TOP + 0.15, P));
}

function drawReadout() {
  const text = reviewed + "/" + PLATES + " · drawer " + curatedCount + " · shelf " + openCount;
  if (readout.textContent !== text) readout.textContent = text;
  stage.setAttribute("aria-valuenow", String(reviewed));
  stage.setAttribute("aria-valuetext", reviewed + " of " + PLATES + " plates reviewed; " + curatedCount + " in the drawer, " + openCount + " on the shelf");
}

function scheduleTour() {
  clearTimeout(tourTimer);
  if (!touring || busy) return;
  tourTimer = setTimeout(() => { if (touring && !busy) advance(); }, 2400);
}

function frameAt(t, outgoing, toDrawer) {
  const e = smooth(0.02, 0.34, t);
  const lift = 3.0 * Math.sin(Math.PI * e);
  plates.forEach((plate) => {
    if (plate === outgoing && t >= 0.34) {
      plate.el.style.display = "none";
      return;
    }
    plate.el.style.display = "";
    let x, y = 0, z;
    if (plate.station === MAG_STATION) {
      const m = smooth(0.05, 0.34, t);
      x = stationX(MAG_STATION) + (stationX(0) - stationX(MAG_STATION)) * m;
      z = MAG_Z + (RACK_Z - MAG_Z) * smooth(0.62, 1, m) + Math.sin(Math.PI * m) * 1.0;
    } else if (plate === outgoing) {
      x = stationX(PLATES - 1) + PITCH * e;
      z = RACK_Z + (TABLE_Z - RACK_Z) * e + lift;
    } else {
      x = stationX(plate.station) + PITCH * e;
      z = RACK_Z + lift;
    }
    plate.el.setAttribute("transform", translateAlong(P, [x, y, z]));
  });

  const sortT = smooth(0.60, 0.94, t);
  if (t >= 0.34) {
    sortEl.style.display = "";
    let x = stationX(PLATES), y = 0, z = TABLE_Z;
    if (sortT > 0) {
      const u = sortT;
      const a = [stationX(PLATES), 0, TABLE_Z];
      const c = toDrawer ? [TABLE.x + 26, 8, 22] : [TABLE.x + 26, -6, 21];
      const b = toDrawer ? DRAWER_DEST : SHELF_DEST;
      x = (1 - u) * (1 - u) * a[0] + 2 * (1 - u) * u * c[0] + u * u * b[0];
      y = (1 - u) * (1 - u) * a[1] + 2 * (1 - u) * u * c[1] + u * u * b[1];
      z = (1 - u) * (1 - u) * a[2] + 2 * (1 - u) * u * c[2] + u * u * b[2];
    }
    sortEl.setAttribute("transform", translateAlong(P, [x, y, z]));
    if (t > 0.975) sortEl.style.display = "none";
  } else {
    sortEl.style.display = "none";
  }

  const lampPose = smooth(0.30, 0.46, t) * (1 - smooth(0.66, 0.82, t));
  lampEl.setAttribute("transform", "rotate(" + (-11 * lampPose).toFixed(2) + " " + LAMP_PIVOT[0].toFixed(1) + " " + LAMP_PIVOT[1].toFixed(1) + ")");

  const ramPose = smooth(0.34, 0.47, t) * (1 - smooth(0.60, 0.74, t));
  ramEl.setAttribute("transform", translateAlong(P, [0, 0, -RAM_STROKE * ramPose]));

  const cardT = smooth(0.16, 0.46, t);
  cards.forEach((card) => {
    const from = cardPos(card.pos);
    const to = cardPos((card.pos + 1) % (QUESTIONS + 1));
    let x = from[0] + (to[0] - from[0]) * cardT;
    let y = from[1] + (to[1] - from[1]) * cardT;
    let z = from[2] + (to[2] - from[2]) * cardT;
    if (card.pos === QUESTIONS) {
      const arc = Math.sin(Math.PI * cardT);
      x += 13 * arc;
      y += -8 * arc;
      z += 1.2 * arc;
    }
    card.el.setAttribute("transform", translateAlong(P, [x, y, z]));
  });

  const tablePose = smooth(0.52, 0.64, t) * (1 - smooth(0.90, 1, t));
  tableEl.setAttribute("transform", "rotate(" + ((toDrawer ? 9 : -9) * tablePose).toFixed(2) + " " + TABLE_PIVOT[0].toFixed(1) + " " + TABLE_PIVOT[1].toFixed(1) + ")");

  const vanePose = smooth(0.46, 0.58, t) * (1 - smooth(0.90, 1, t));
  vaneEl.setAttribute("transform", "rotate(" + ((toDrawer ? -38 : 38) * vanePose).toFixed(2) + " " + VANE_PIVOT[0].toFixed(1) + " " + VANE_PIVOT[1].toFixed(1) + ")");

  const lidPose = toDrawer ? smooth(0.50, 0.64, t) * (1 - smooth(0.86, 0.98, t)) : 0;
  lidEl.setAttribute("transform", "rotate(" + (58 * lidPose).toFixed(2) + " " + LID_HINGE[0].toFixed(1) + " " + LID_HINGE[1].toFixed(1) + ")");

  const crankPose = smooth(0.0, 0.10, t) * (1 - smooth(0.16, 0.34, t));
  crankEl.setAttribute("transform", "translate(0 " + (3.2 * crankPose).toFixed(2) + ")");

  drawNeedle(reviewed / PLATES + (1 / PLATES) * smooth(0.36, 0.70, t));
}

function finalize(outgoing, toDrawer, next) {
  sortEl.style.display = "none";
  outgoing.el.style.display = "";
  plates.forEach((plate) => {
    if (plate === outgoing) plate.station = MAG_STATION;
    else if (plate.station === MAG_STATION) plate.station = 0;
    else plate.station += 1;
    const z = plate.station === MAG_STATION ? MAG_Z : RACK_Z;
    plate.el.setAttribute("transform", translateAlong(P, [stationX(plate.station), 0, z]));
  });
  cards.forEach((card) => {
    card.pos = (card.pos + 1) % (QUESTIONS + 1);
    const p = cardPos(card.pos);
    card.el.setAttribute("transform", translateAlong(P, [p[0], p[1], p[2]]));
  });
  reviewed = next;
  if (toDrawer) curatedCount += 1; else openCount += 1;
  drawNeedle(reviewed / PLATES);
  drawReadout();
  busy = false;
  if (reviewed >= PLATES) {
    busy = true;
    resetTimer = setTimeout(() => {
      reviewed = 0;
      openCount = 0;
      curatedCount = 0;
      drawNeedle(0);
      drawReadout();
      busy = false;
      scheduleTour();
    }, 620);
  } else {
    scheduleTour();
  }
}

function advance() {
  if (busy || !visible) return;
  busy = true;
  clearTimeout(resetTimer);
  clearTimeout(tourTimer);
  const next = reviewed + 1;
  const toDrawer = CURATED_AT.includes(next);
  const outgoing = plates.find((plate) => plate.station === PLATES - 1);
  if (!outgoing) { busy = false; return; }

  if (still.matches) {
    finalize(outgoing, toDrawer, next);
    return;
  }

  const start = performance.now();
  function frame(now) {
    const t = clamp((now - start) / 1000 / DURATION, 0, 1);
    frameAt(t, outgoing, toDrawer);
    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      finalize(outgoing, toDrawer, next);
    }
  }
  requestAnimationFrame(frame);
}

function cancelIdle() {
  touring = false;
  clearTimeout(idleTimer);
  clearTimeout(tourTimer);
  idleTimer = setTimeout(() => {
    if (still.matches) return;
    touring = true;
    if (visible && !busy) advance();
  }, 6000);
}

stage.addEventListener("pointerdown", () => {
  cancelIdle();
  stage.focus({ preventScroll: true });
});
stage.addEventListener("pointermove", cancelIdle);
window.addEventListener("keydown", (event) => {
  if (["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", " ", "Enter"].includes(event.key)) {
    event.preventDefault();
    cancelIdle();
    stage.focus({ preventScroll: true });
    advance();
  } else if (event.key === "Home") {
    event.preventDefault();
    cancelIdle();
    reviewed = 0;
    openCount = 0;
    curatedCount = 0;
    drawNeedle(0);
    drawReadout();
  }
});
svg.querySelector('[data-part="crank"]').addEventListener("click", (event) => {
  event.stopPropagation();
  cancelIdle();
  advance();
});

new IntersectionObserver((entries) => {
  visible = entries[entries.length - 1].isIntersecting;
  if (visible && touring && !busy) advance();
}, { rootMargin: "120px 0px" }).observe(stage);

plates.forEach((plate) => {
  const z = plate.station === MAG_STATION ? MAG_Z : RACK_Z;
  plate.el.setAttribute("transform", translateAlong(P, [stationX(plate.station), 0, z]));
});
cards.forEach((card) => {
  const p = cardPos(card.pos);
  card.el.setAttribute("transform", translateAlong(P, [p[0], p[1], p[2]]));
});
drawNeedle(reviewed / PLATES);
drawReadout();
if (!still.matches) idleTimer = setTimeout(() => { touring = true; if (visible && !busy) advance(); }, 6000);
`;

const body = k.plateHtml({
  fig: "Fig 1",
  title: "The review gate",
  hint: "Press the crank, or ← →",
  readout: `${START_STEP}/${PLATES} · drawer ${START_CURATED} · shelf ${START_OPEN}`,
  keys: [
    { mark: "lit", label: "The reader lamp — the one lit part; it dips over each plate" },
    { mark: "raised", label: `A ${PLATES}-station series; ${QUESTIONS} question cards dealt per plate` },
  ],
  caption:
    `A ${PLATES}-plate series indexes one station at a time. The reader lamp dips over each plate, the drafting head deals one of ${QUESTIONS} question cards into its tray, and the press stamps the plate as it passes the inspector column. At the end the gate files it: about one plate in ${Math.round(CORPUS / CURATED)} into the closed curated drawer (${CURATED.toLocaleString()} of the ${CORPUS.toLocaleString()} corpus), the rest onto the open shelf (${OPEN.toLocaleString()}). The dial counts the series; at ${PLATES} it begins again.`,
  body: `<style>
.iso-svg{overflow:hidden}
.iso-page{overflow-x:clip}
/* Light theme tuned so every solid reads as a filled part: white tops, four
   visible side tones, and one black accent — the reader lamp head. */
.iso[data-theme="light"]{
  --anatomy-mid:#76767c;--anatomy-lo:#a4a4aa;
  --anatomy-shade-0:#bcb9ad;--anatomy-shade-1:#c9c6bb;--anatomy-shade-2:#d7d4ca;--anatomy-shade-3:#e4e2d9;
  --anatomy-face:#1a1a1e;--anatomy-lit-top:#2e2e33;--anatomy-lit-shade:#101013;
}
.iso-plate-corner[data-corner="readout"]{color:var(--anatomy-strong)}
.iso-plate-corner[data-corner="readout"]::before{content:"";display:inline-block;width:5px;height:5px;margin-right:6px;border-radius:50%;background:var(--anatomy-strong);vertical-align:1px}
@media (max-width:560px){
  .iso-plate{padding:52px 14px 84px}
  .iso-plate-corners{inset:14px}
  .iso-plate-corner{font-size:12.5px;letter-spacing:.04em}
  .iso-plate-corner[data-corner="hint"]{bottom:28px;letter-spacing:.03em}
  .iso-plate-corner[data-corner="readout"]{left:0;right:auto}
  .iso-legend{font-size:14px}
}
</style><div class="iso-stage" tabindex="0" role="slider" aria-label="The review gate: press the crank or the arrow keys to advance one plate" aria-valuemin="0" aria-valuemax="${PLATES}" aria-valuenow="${START_STEP}">${svg}</div>`,
});

writeFileSync(
  join(HERE, "the-review-gate.html"),
  k.pageHtml({ title: "The review gate", theme: "light", body, script: kitScript() + live, width: 720 }),
);
console.log("wrote the-review-gate.html");
