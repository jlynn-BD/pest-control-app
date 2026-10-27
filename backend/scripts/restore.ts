// Loads a backup file (made by `npm run backup`) into an EMPTY database.
//
//   npm run restore -w backend -- <backup-file> --check    # only validate the file
//   npm run restore -w backend -- <backup-file>            # restore it
//
// The target must already have the app's tables (run `npm run
// prisma:migrate:deploy -w backend` against it first) and must hold no data;
// this never overwrites or deletes anything, so it can't make a bad day worse.
import fs from "node:fs";
import readline from "node:readline";
import zlib from "node:zlib";
import { client, connectionString, hostOf, ident } from "./dbConnect";

const BATCH_BYTES = 4 * 1024 * 1024;

type Header = { format: string; createdAt: string; source: string; tables: Record<string, number> };

function lines(file: string) {
  return readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
}

async function readHeader(file: string): Promise<Header> {
  for await (const line of lines(file)) {
    const o = JSON.parse(line);
    if (o.format !== "pestapp-backup-v1") throw new Error("This is not a PestApp backup file.");
    return o as Header;
  }
  throw new Error("The backup file is empty.");
}

async function check(file: string, header: Header) {
  const seen: Record<string, number> = {};
  for await (const line of lines(file)) {
    const o = JSON.parse(line);
    if (!o.format) seen[o.t] = (seen[o.t] ?? 0) + 1;
  }
  for (const [t, n] of Object.entries(header.tables)) {
    if ((seen[t] ?? 0) !== n) throw new Error(`${t}: header says ${n} rows, file has ${seen[t] ?? 0}.`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) throw new Error("Usage: npm run restore -w backend -- <backup-file> [--check]");
  const header = await readHeader(file);
  const total = Object.values(header.tables).reduce((a, b) => a + b, 0);
  console.log(`Backup from ${header.createdAt} (${header.source}): ${total} rows in ${Object.keys(header.tables).length} tables.`);
  await check(file, header);
  console.log("The file is complete and readable.");
  if (args.includes("--check")) return;

  const url = await connectionString("RESTORE_DATABASE_URL", "Connection string of the EMPTY database to restore into (hidden)");
  const db = client(url);
  try {
    const present = (
      await db.$queryRawUnsafe<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
      )
    ).map((r) => r.table_name);
    const missing = Object.keys(header.tables).filter((t) => !present.includes(t));
    if (missing.length) throw new Error(`The target database lacks tables: ${missing.join(", ")}. Run the migrations on it first.`);
    for (const t of Object.keys(header.tables)) {
      const [{ n }] = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${ident(t)}`);
      if (Number(n) > 0) throw new Error(`${t} already has data in ${hostOf(url)}. Restore only into an empty database.`);
    }

    // Parents before children, so every foreign key finds its row.
    const fks = await db.$queryRawUnsafe<{ child: string; parent: string }[]>(
      `SELECT c.relname AS child, p.relname AS parent FROM pg_constraint k
       JOIN pg_class c ON c.oid = k.conrelid JOIN pg_class p ON p.oid = k.confrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace WHERE k.contype = 'f' AND n.nspname = 'public' AND c.relname <> p.relname`
    );
    const remaining = new Set(Object.keys(header.tables));
    const order: string[] = [];
    while (remaining.size) {
      const ready = [...remaining].filter((t) => fks.every((f) => f.child !== t || !remaining.has(f.parent)));
      if (ready.length === 0) throw new Error("Tables reference each other in a loop; cannot order the restore.");
      for (const t of ready.sort()) {
        order.push(t);
        remaining.delete(t);
      }
    }

    // Rows grouped per table, then inserted in order, all or nothing.
    const byTable = new Map<string, string[]>(order.map((t) => [t, []]));
    for await (const line of lines(file)) {
      const o = JSON.parse(line);
      if (!o.format) byTable.get(o.t)!.push(JSON.stringify(o.r));
    }
    await db.$transaction(
      async (tx) => {
        for (const t of order) {
          const rows = byTable.get(t)!;
          let i = 0;
          while (i < rows.length) {
            let bytes = 0;
            const batch: string[] = [];
            while (i < rows.length && (batch.length === 0 || bytes + rows[i].length < BATCH_BYTES)) {
              bytes += rows[i].length;
              batch.push(rows[i++]);
            }
            await tx.$executeRawUnsafe(`INSERT INTO ${ident(t)} SELECT * FROM json_populate_recordset(null::${ident(t)}, $1::json)`, `[${batch.join(",")}]`);
          }
          console.log(`  ${t.padEnd(26)} ${String(rows.length).padStart(7)} rows`);
        }
      },
      { maxWait: 30_000, timeout: 60 * 60 * 1000 }
    );

    for (const [t, n] of Object.entries(header.tables)) {
      const [{ c }] = await db.$queryRawUnsafe<{ c: bigint }[]>(`SELECT count(*) AS c FROM ${ident(t)}`);
      if (Number(c) !== n) throw new Error(`After restoring, ${t} has ${c} rows but the backup had ${n}.`);
    }
    console.log(`\nRestored ${total} rows into ${hostOf(url)} and counted them to confirm.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(`\nRestore failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
