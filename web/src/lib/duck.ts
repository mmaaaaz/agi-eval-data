/**
 * DuckDB-WASM singleton — in-memory, read-only analytics over the artifact.
 * Lives in its own worker; the UI never blocks during queries.
 */
import * as duckdb from "@duckdb/duckdb-wasm";
import type { Latest } from "./types";

/* WASM + worker load from jsDelivr (version-pinned by the npm package) —
   Cloudflare Pages caps files at 25 MiB, so the 34–41 MB DuckDB binaries
   cannot ship in the deploy bundle. Lazy-loaded only when /ask opens. */

export interface SqlResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  sql: string;
}

let db: duckdb.AsyncDuckDB | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;
let loadedScannedAt: string | null = null;
let initing: Promise<void> | null = null;

async function ensureDb(): Promise<duckdb.AsyncDuckDBConnection> {
  if (conn) return conn;
  if (!initing) {
    initing = (async () => {
      const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
      // cross-origin worker script → wrap in a same-origin Blob
      const workerUrl = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }),
      );
      const worker = new Worker(workerUrl);
      const workerFailed = new Promise<never>((_, rej) => {
        worker.onerror = () => rej(new Error("DuckDB worker failed to load (check network tab)"));
      });
      const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
      db = new duckdb.AsyncDuckDB(logger, worker);
      const bootTimeout = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("DuckDB boot timed out after 20s")), 20_000),
      );
      await Promise.race([db.instantiate(bundle.mainModule, bundle.pthreadWorker ?? undefined), workerFailed, bootTimeout]);
      conn = await db.connect();
    })();
  }
  await initing;
  return conn!;
}

/** (Re)load artifact tables with a hard timeout. Cheap: 21k rows ≈ instant. Skipped when already current. */
export async function loadArtifact(latest: Latest): Promise<void> {
  const timeout = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error("DuckDB load timed out after 30s — check browser console (F12)")), 30_000),
  );
  await Promise.race([loadArtifactInner(latest), timeout]);
}

async function loadArtifactInner(latest: Latest): Promise<void> {
  const conn = await ensureDb();
  if (loadedScannedAt === latest.meta.scannedAt) return;

  const images = latest.files.map((r) => {
    const e = latest.exif?.[r[0]];
    const ratio = e ? e[0] / e[1] : 0;
    return {
      id: r[0], name: r[1], ext: r[2], size: Number(r[3] ?? 0), day: r[4],
      owner: r[5], md5: r[6] || null, kind: r[7],
      width: e?.[0] ?? null,
      height: e?.[1] ?? null,
      megapixels: e ? Number(((e[0] * e[1]) / 1e6).toFixed(2)) : null,
      camera: e && e[2] != null && e[2] >= 0 ? latest.cams?.[e[2]] ?? null : null,
      orientation: e ? (ratio > 1.05 ? "landscape" : ratio < 0.95 ? "portrait" : "square") : null,
    };
  });
  const ownerRows = Object.entries(latest.owners).map(([email, name]) => ({ email, name }));
  const dupRows = latest.dupGroups.map((g) => ({ md5: g.md5, copies: g.count, bytes: g.size }));

  await conn.query("DROP TABLE IF EXISTS images");
  await conn.query("DROP TABLE IF EXISTS owners");
  await conn.query("DROP TABLE IF EXISTS dup_groups");

  await db!.registerFileText("images.json", JSON.stringify(images));
  await db!.registerFileText("owners.json", JSON.stringify(ownerRows));
  await db!.registerFileText("dup_groups.json", JSON.stringify(dupRows));

  // day is forced to VARCHAR: DuckDB auto-types ISO strings as DATE, which
  // breaks LIKE / string comparisons the model tends to write
  await conn.query(
    "CREATE TABLE images AS SELECT id, name, ext, size, CAST(day AS VARCHAR) AS day, owner, md5, kind, width, height, megapixels, camera, orientation FROM read_json_auto('images.json')",
  );
  await conn.query("CREATE TABLE owners AS SELECT * FROM read_json_auto('owners.json')");
  await conn.query("CREATE TABLE dup_groups AS SELECT * FROM read_json_auto('dup_groups.json')");

  loadedScannedAt = latest.meta.scannedAt;
}

export function isLoaded(latest: Latest): boolean {
  return loadedScannedAt === latest.meta.scannedAt;
}

const FORBIDDEN = /\b(insert|update|delete|create|drop|alter|attach|detach|copy|export|import|install|load|call|pragma)\b/i;

/** Guarded, read-only SELECT execution with auto-LIMIT. Errors are returned, not thrown. */
export async function runSql(rawSql: string): Promise<SqlResult | { error: string }> {
  try {
    const sql = rawSql.trim().replace(/;+\s*$/, "");
    if (!/^select\s/i.test(sql) && !/^with\s/i.test(sql))
      return { error: "only SELECT / WITH queries are allowed" };
    if (/;/.test(sql.replace(/;+\s*$/, "")))
      return { error: "multiple statements are not allowed" };
    if (FORBIDDEN.test(sql))
      return { error: "write/DDL/extension statements are not allowed (read-only dataset)" };

    const guarded = /\blimit\s+\d+/i.test(sql) ? sql : `${sql} LIMIT 200`;
    const conn = await ensureDb();

    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("query timed out (15s)")), 15_000));
    const result = (await Promise.race([conn.query(guarded), timeout])) as import("apache-arrow").Table;

    const columns = result.schema.fields.map((f) => String(f.name));
    const raw: Record<string, unknown>[] = result.toArray();
    const rows = raw.slice(0, 200).map((row: Record<string, unknown>) => {
      const out: Record<string, unknown> = {};
      for (const col of columns) {
        const v = row[col];
        out[col] = typeof v === "bigint" ? Number(v) : v instanceof Uint8Array ? "<bytes>" : v;
      }
      return out;
    });
    return { columns, rows, rowCount: rows.length, sql: guarded };
  } catch (e) {
    let msg = e instanceof Error ? e.message : String(e);
    if (/binder error/i.test(msg) && /day/i.test(msg))
      msg += " (hint: day is VARCHAR 'YYYY-MM-DD' — filter with day >= '2026-08-01' or day LIKE '2026-08-%')";
    return { error: msg };
  }
}
