import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const [, , version, installerPath] = process.argv;

if (!version || !installerPath) {
  throw new Error("Usage: node scripts/write-latest-update-manifest.mjs <version> <installer-path>");
}

const bytes = readFileSync(installerPath);
const sha256 = createHash("sha256").update(bytes).digest("hex").toUpperCase();
const installerName = basename(installerPath).replaceAll("\\", "/");

const manifest = {
  available: true,
  version,
  installer_url: `https://fetchr.fun/api/downloads/${installerName}`,
  installer_sha256: sha256,
  notes: "Fetchr beta installer with online VPS updates, Telegram activation and subscription validation.",
  published_at: new Date().toISOString(),
};

writeFileSync("deploy/latest-update.json", `${JSON.stringify(manifest, null, 2)}\n`);
console.log(sha256);
