/**
 * DuckDB-WASM singleton — in-memory, read-only analytics over the artifact.
 * Lives in its own worker; the UI never blocks during queries.
 */
import * as duckdb from "@duckdb/duckdb-wasm";
import duckdb_mvp_wasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import duckdb_mvp_worker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import duckdb_eh_wasm from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import duckdb_eh_worker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import type { Latest } from "./types";

const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: duckdb_mvp_wasm, mainWorker: duckdb_mvp_worker },
  eh: { mainModule: duckdb_eh_wasm, mainWorker: duckdb_eh_worker },
};

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
      const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
      const worker = new Worker(bundle.mainWorker!);
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
      await conn.query("SET threads TO 2");
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

  const images = latest.files.map((r) => ({
    id: r[0], name: r[1], ext: r[2], size: Number(r[3] ?? 0), day: r[4],
    owner: r[5], md5: r[6] || null, kind: r[7],
  }));
  const ownerRows = Object.entries(latest.owners).map(([email, name]) => ({ email, name }));
  const dupRows = latest.dupGroups.map((g) => ({ md5: g.md5, copies: g.count, bytes: g.size }));

  await conn.query("DROP TABLE IF EXISTS images");
  await conn.query("DROP TABLE IF EXISTS owners");
  await conn.query("DROP TABLE IF EXISTS dup_groups");

  await db!.registerFileText("images.json", JSON.stringify(images));
  await db!.registerFileText("owners.json", JSON.stringify(ownerRows));
  await db!.registerFileText("dup_groups.json", JSON.stringify(dupRows));

  await conn.query("CREATE TABLE images AS SELECT * FROM read_json_auto('images.json')");
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
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
