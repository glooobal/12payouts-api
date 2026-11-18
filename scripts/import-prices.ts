#!/usr/bin/env bun

import { createClient } from "@supabase/supabase-js";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

type PriceRow = { ticker: string; date: string; close: number };

const TABLE = process.env.SUPABASE_PRICES_TABLE ?? "gpw";
const BATCH_SIZE = Number(process.env.IMPORT_BATCH_SIZE ?? 500);

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseLine(line: string, ticker: string, lineNumber: number): PriceRow | null {
  const fields = line.trim().replace(/^\uFEFF/, "").split(",");
  if (fields.length < 8) throw new Error(`Line ${lineNumber}: expected at least 8 columns`);

  const rawDate = fields[2].trim();
  const close = Number(fields[7].trim());
  // Ignore a header row if the file contains one.
  if (fields[0].trim().toUpperCase() === "<TICKER>" || fields[0].trim().toUpperCase() === "TICKER") return null;
  if (!/^\d{8}$/.test(rawDate)) throw new Error(`Line ${lineNumber}: date must use YYYYMMDD`);

  const year = Number(rawDate.slice(0, 4));
  const month = Number(rawDate.slice(4, 6));
  const day = Number(rawDate.slice(6, 8));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error(`Line ${lineNumber}: invalid calendar date ${rawDate}`);
  }
  if (!Number.isFinite(close)) throw new Error(`Line ${lineNumber}: close is not a number`);

  return {
    ticker,
    date: `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`,
    close,
  };
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log("Usage: bun run import:prices -- <folder-or-file> [table]");
    console.log("       bun run import:prices -- <file1.txt> <file2.txt> ... --table <table>");
    console.log("Every .txt file is imported; the ticker is derived from its filename (xtb.txt -> XTB).");
    if (args.length === 0) process.exitCode = 2;
    return;
  }

  let table = TABLE;
  const tableFlagIndex = args.indexOf("--table");
  if (tableFlagIndex !== -1) {
    const requestedTable = args[tableFlagIndex + 1];
    if (!requestedTable) throw new Error("Missing table name after --table");
    table = requestedTable;
    args.splice(tableFlagIndex, 2);
  } else if (args.length > 1) {
    const lastArg = args.at(-1)!;
    if (!lastArg.toLowerCase().endsWith(".txt") && !lastArg.includes("/") && !lastArg.includes("\\")) {
      table = args.pop()!;
    }
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    throw new Error(`Invalid table name: ${table}`);
  }
  const inputs = args;
  if (inputs.length === 0) throw new Error("Provide at least one folder or .txt file");

  const supabaseUrl = requiredEnv("SUPABASE_URL").replace(/\/$/, "");
  const supabaseKey = process.env.SUPABASE_SECRET_KEY?.trim()
    || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    || requiredEnv("SUPABASE_KEY");
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const filePaths: string[] = [];
  for (const input of inputs) {
    const absoluteInput = resolve(input);
    let inputStat;
    try {
      inputStat = await stat(absoluteInput);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Input path does not exist: ${input}`);
      }
      throw error;
    }
    if (inputStat.isDirectory()) {
      const entries: string[] = [];
      for await (const entry of new Bun.Glob("**/*.txt").scan({ cwd: absoluteInput, onlyFiles: true })) {
        entries.push(entry);
      }
      filePaths.push(...entries.map((entry) => resolve(absoluteInput, entry)));
    } else {
      filePaths.push(absoluteInput);
    }
  }
  if (filePaths.length === 0) throw new Error("No .txt files found in the provided input path(s)");

  const rowsByKey = new Map<string, PriceRow>();
  for (const filePath of filePaths) {
    const fileName = filePath.split(/[\\/]/).at(-1) ?? filePath;
    const ticker = fileName.replace(/\.txt$/i, "").trim().toUpperCase();
    if (!ticker || ticker === fileName.toUpperCase()) {
      throw new Error(`File ${filePath}: expected a .txt filename whose name is the ticker, e.g. xtb.txt`);
    }
    const contents = await Bun.file(filePath).text();
    for (const [index, line] of contents.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      const row = parseLine(line, ticker, index + 1);
      if (row) rowsByKey.set(`${row.ticker}\0${row.date}`, row);
    }
  }
  // Keep one row per conflict key so Postgres can upsert each batch safely.
  const rows = [...rowsByKey.values()];

  if (!Number.isInteger(BATCH_SIZE) || BATCH_SIZE < 1) throw new Error("IMPORT_BATCH_SIZE must be a positive integer");
  if (rows.length === 0) {
    console.log("No price rows found; nothing to import.");
    return;
  }

  let uploaded = 0;
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE);
    const { error } = await supabase.from(table).upsert(batch, { onConflict: "ticker,date" });
    if (error) throw new Error(`Supabase upsert failed: ${error.message}`);
    uploaded += batch.length;
    console.log(`Imported ${uploaded}/${rows.length} rows`);
  }
  console.log(`Done. Imported ${rows.length} rows into ${table}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
