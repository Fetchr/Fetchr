import { readFileSync, writeFileSync } from "node:fs";

const packagePath = "package.json";
const tauriPath = "src-tauri/tauri.conf.json";
const cargoPath = "src-tauri/Cargo.toml";
const landingPath = "fetchr-landing.html";

const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const currentVersion = String(packageJson.version || "0.2.0");
const nextVersion = bumpPatchVersion(currentVersion);

packageJson.version = nextVersion;
writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

const tauriConfig = JSON.parse(readFileSync(tauriPath, "utf8"));
tauriConfig.version = nextVersion;
if (tauriConfig.app?.windows?.[0]?.title) {
  tauriConfig.app.windows[0].title = `Fetchr beta v${nextVersion}`;
}
writeFileSync(tauriPath, `${JSON.stringify(tauriConfig, null, 2)}\n`);

let cargoToml = readFileSync(cargoPath, "utf8");
cargoToml = cargoToml.replace(
  /^version\s*=\s*"[^"]+"/m,
  `version = "${nextVersion}"`,
);
writeFileSync(cargoPath, cargoToml);

try {
  let landingHtml = readFileSync(landingPath, "utf8");
  landingHtml = landingHtml.replace(
    /\/api\/downloads\/Fetchr-Setup-v\d+\.\d+\.\d+\.exe/g,
    `/api/downloads/Fetchr-Setup-v${nextVersion}.exe`,
  );
  writeFileSync(landingPath, landingHtml);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

console.log(nextVersion);

function bumpPatchVersion(version) {
  const normalized = version.trim().replace(/^v/i, "");
  const match = normalized.match(/^(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (!match) {
    throw new Error(`Unsupported version format: ${version}`);
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3] ?? 0) + 1;
  return `${major}.${minor}.${patch}`;
}
