// Full logical backup of the database: every table (including the photos,
// signatures and PDFs, which live in the StoredFile table) written to one
// compressed file you can keep anywhere. Reads only; changes nothing.
//
//   npm run backup -w backend
//
// Paste the database's *External* connection string when asked (Render ->
// pestapp-db -> Connections). Restore with `npm run restore -w backend`.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { once } from "node:events";
import { client, connectionString, hostOf, ident } from "./dbConnect";

const FORMAT = "pestapp-backup-v1";
const SKIP = new Set(["_prisma_migrations"]);

async function main() {
  const url = await connectionString("BACKUP_DATABASE_URL", "Database connection string (hidden)");
  const db = client(url);
  const outDir = process.env.BACKUP_DIR || path.join(os.homedir(), "pestapp-backups");
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const outFile = path.join(outDir, `pestapp-${stamp}.jsonl.gz`);

  console.log(`Backing up ${hostOf(url)} ...`);
  const counts: Record<string, number> = {};
  const gzip = zlib.createGzip({ level: 6 });
  const out = fs.createWriteStream(outFile, { mode: 0o600 });
  gzip.pipe(out);
  const hash = crypto.createHash("sha256");
  const write = async (obj: unknown) => {
    if (!gzip.write(JSON.stringify(obj) + "\n")) await once(gzip, "drain");
  };

  try {
    // One snapshot for the whole backup, so related tables agree with each
    // other even if people are using the app while it runs.
    await db.$transaction(
      async (tx) => {
        const tables = (
          await tx.$queryRawUnsafe<{ table_name: string }[]>(
            `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`
          )
        )
          .map((r) => r.table_name)
          .filter((t) => !SKIP.has(t));
        if (tables.length === 0) throw new Error("No tables found - is this the right database?");

        const tableCounts: Record<string, number> = {};
        for (const t of tables) {
          const [{ n }] = await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${ident(t)}`);
          tableCounts[t] = Number(n);
        }
        await write({ format: FORMAT, createdAt: new Date().toISOString(), source: hostOf(url), tables: tableCounts });

        for (const t of tables) {
          const pk = await tx.$queryRawUnsafe<{ column_name: string }[]>(
            `SELECT kcu.column_name FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
             WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
             ORDER BY kcu.ordinal_position`,
            t
          );
          const order = pk.length ? pk.map((c) => ident(c.column_name)).join(", ") : "ctid";
          // Photos are big rows, so fetch fewer at a time.
          const page = t === "StoredFile" ? 5 : 500;
          let offset = 0;
          counts[t] = 0;
          for (;;) {
            const rows = await tx.$queryRawUnsafe<{ r: unknown }[]>(
              `SELECT row_to_json(x) AS r FROM (SELECT * FROM ${ident(t)} ORDER BY ${order} LIMIT ${page} OFFSET ${offset}) x`
            );
            if (rows.length === 0) break;
            for (const row of rows) {
              await write({ t, r: row.r });
              counts[t]++;
            }
            offset += rows.length;
            if (rows.length < page) break;
          }
          if (counts[t] !== tableCounts[t]) throw new Error(`${t}: expected ${tableCounts[t]} rows but read ${counts[t]}`);
          console.log(`  ${t.padEnd(26)} ${String(counts[t]).padStart(7)} rows`);
        }
      },
      { isolationLevel: "RepeatableRead", maxWait: 30_000, timeout: 60 * 60 * 1000 }
    );
    gzip.end();
    await once(out, "finish");
  } catch (err) {
    gzip.destroy();
    out.destroy();
    fs.rmSync(outFile, { force: true });
    throw err;
  } finally {
    await db.$disconnect();
  }

  // Read the finished file back to prove it is complete and uncorrupted.
  const verify: Record<string, number> = {};
  let header: { tables: Record<string, number> } | null = null;
  const { createReadStream } = fs;
  const rl = (await import("node:readline")).createInterface({ input: createReadStream(outFile).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) {
    const o = JSON.parse(line);
    if (o.format) header = o;
    else verify[o.t] = (verify[o.t] ?? 0) + 1;
  }
  if (!header) throw new Error("Backup verification failed: header missing.");
  for (const [t, n] of Object.entries(header.tables)) {
    if ((verify[t] ?? 0) !== n) throw new Error(`Backup verification failed for ${t}: file has ${verify[t] ?? 0}, database had ${n}.`);
  }
  hash.update(fs.readFileSync(outFile));
  const total = Object.values(verify).reduce((a, b) => a + b, 0);
  const mb = (fs.statSync(outFile).size / 1048576).toFixed(1);
  console.log(`\nDone. ${total} rows in ${Object.keys(verify).length} tables, ${mb} MB, verified by reading it back.`);
  console.log(`File:   ${outFile}`);
  console.log(`SHA256: ${hash.digest("hex")}`);
  console.log("This file contains customer data and photos - keep it somewhere private (encrypted disk / private cloud folder).");
}

main().catch((err) => {
  console.error(`\nBackup failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
