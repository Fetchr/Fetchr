#!/usr/bin/env node
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PRODUCT_ID = "fetchr-beta";
const PREFIX = "FTR1";
const PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEII48025LE1ECoeTdBVwB+Sg1l2QmwRvk14YYTEXiTJvM
-----END PRIVATE KEY-----`;

if (isDirectRun()) {
  main();
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || (!args.machine && !args.csv)) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  if (args.csv) {
    const rows = parseCsv(readFileSync(args.csv, "utf8"));
    const out = rows.map((row, index) => {
      const machineId = (row.machine_id || row.machineId || "").trim();
      if (!machineId) {
        return {
          ...row,
          key: "",
          error: "missing machine_id",
        };
      }
      try {
        return {
          ...row,
          key: createLicenseKey({
            machine_id: normalizeMachineId(machineId),
            name: cleanOptional(row.name || row.tester || `Beta ${index + 1}`),
            note: cleanOptional(row.note),
          }),
          error: "",
        };
      } catch (err) {
        return {
          ...row,
          key: "",
          error: String(err instanceof Error ? err.message : err),
        };
      }
    });

    const output = args.out || "beta-keys.generated.csv";
    writeFileSync(output, toCsv(out), "utf8");
    console.log(`Wrote ${rows.length} rows to ${output}`);
    return;
  }

  const key = createLicenseKey({
    machine_id: normalizeMachineId(args.machine),
    name: cleanOptional(args.name),
    note: cleanOptional(args.note),
  });
  console.log(key);
}

export function createLicenseKey({ machine_id, name = null, note = null }) {
  const payload = {
    v: 1,
    product: PRODUCT_ID,
    machine_id,
    name,
    note,
    issued_at: new Date().toISOString(),
  };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = base64Url(Buffer.from(payloadJson, "utf8"));
  const privateKey = createPrivateKey(PRIVATE_KEY_PEM);
  const signature = sign(null, Buffer.from(payloadB64, "utf8"), privateKey);
  return `${PREFIX}.${payloadB64}.${base64Url(signature)}`;
}

export function normalizeMachineId(value) {
  const machineId = String(value || "").trim().toUpperCase();
  if (!/^[A-F0-9]{32}$/.test(machineId)) {
    throw new Error("machine_id must be 32 hex characters from the app activation screen");
  }
  return machineId;
}

function cleanOptional(value) {
  const text = String(value || "").trim();
  return text ? text : null;
}

function base64Url(buffer) {
  return buffer
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    parsed[key] = argv[index + 1] ?? "";
    index += 1;
  }
  return parsed;
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (quoted && char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function toCsv(rows) {
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function csvEscape(value) {
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function isDirectRun() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

function printHelp() {
  console.log(`Fetchr beta license generator

Single key:
  npm run license:keygen -- --machine <MACHINE_ID> --name "Tester 01" --note "Discord @name"

Batch from CSV:
  npm run license:keygen -- --csv beta-testers-50.csv --out beta-keys.generated.csv

CSV columns:
  id,name,machine_id,note
`);
}
