import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exportRoot = path.join(root, ".github-export");
const repoRoot = path.join(exportRoot, "repo");
const manifestPath = path.join(exportRoot, "manifest.json");
const archivePath = path.join(root, "MediSched.zip");
const compatibilityArchivePath = path.join(root, "MediSched-export.zip");

const rootFiles = [
  ".gitignore",
  ".replit",
  "GITHUB_SYNC.md",
  "MediSched_User_Guide.md",
  "capacitor.config.ts",
  "components.json",
  "drizzle.config.ts",
  "package-lock.json",
  "package.json",
  "postcss.config.js",
  "replit.md",
  "tsconfig.json",
  "vite-plugin-meta-images.ts",
  "vite.config.ts",
];

const sourceDirectories = [
  "attached_assets",
  "client",
  "ios",
  "script",
  "scripts",
  "server",
  "shared",
];

const excludedDirectories = new Set([
  ".agents",
  ".cache",
  ".config",
  ".git",
  ".github-export",
  ".local",
  ".upm",
  "coverage",
  "dist",
  "node_modules",
]);

const excludedPaths = new Set([
  "client/public/medisched-ios-ready.zip",
  "ios/App/App/capacitor.config.json",
  "ios/App/App/config.xml",
]);

const excludedPrefixes = [
  "ios/App/App/public/",
  "ios/capacitor-cordova-ios-plugins/",
];

const secretFilePattern =
  /(^|\/)\.env(?:\.|$)|(^|\/)(?:credentials?|secrets?)(?:\/|\.|$)|\.(?:pem|key|p12|pfx|keystore|jks|sqlite|db)$/i;

function isExcluded(relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  const parts = normalized.split("/");
  return (
    parts.some((part) => excludedDirectories.has(part)) ||
    excludedPaths.has(normalized) ||
    excludedPrefixes.some((prefix) => normalized.startsWith(prefix)) ||
    secretFilePattern.test(normalized) ||
    /(^|\/)(?:id_rsa|id_ed25519)(?:$|\.)/i.test(normalized)
  );
}

async function collectFiles(directory, relativeDirectory = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (isExcluded(relativePath)) continue;

    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolutePath, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

for (const relativePath of rootFiles) {
  try {
    await stat(path.join(root, relativePath));
  } catch {
    throw new Error(`Required export file is missing: ${relativePath}`);
  }
}

const selectedFiles = [...rootFiles];
for (const directory of sourceDirectories) {
  const absolutePath = path.join(root, directory);
  try {
    await stat(absolutePath);
  } catch (error) {
    if (directory === "attached_assets" && error.code === "ENOENT") continue;
    throw new Error(`Required export directory is missing: ${directory}`);
  }
  selectedFiles.push(...(await collectFiles(absolutePath, directory)));
}

const files = [...new Set(selectedFiles)]
  .filter((relativePath) => !isExcluded(relativePath))
  .sort((a, b) => a.localeCompare(b));

await rm(repoRoot, { recursive: true, force: true });
await mkdir(repoRoot, { recursive: true });

for (const relativePath of files) {
  const destination = path.join(repoRoot, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(root, relativePath), destination);
}

const archiveWorkPath = path.join(exportRoot, "MediSched.zip");
await rm(archiveWorkPath, { force: true });
execFileSync("zip", ["-X", "-q", "-r", archiveWorkPath, "."], {
  cwd: repoRoot,
  stdio: "inherit",
});

await copyFile(archiveWorkPath, archivePath);
await copyFile(archiveWorkPath, compatibilityArchivePath);
await copyFile(archivePath, path.join(repoRoot, "MediSched.zip"));

const outputFiles = [...files, "MediSched.zip"].sort((a, b) =>
  a.localeCompare(b),
);
const manifest = {
  repository: "E100978l/MediSched-export",
  branch: "main",
  generatedAt: new Date().toISOString(),
  archive: "MediSched.zip",
  files: await Promise.all(
    outputFiles.map(async (relativePath) => ({
      path: relativePath,
      sha256: await sha256(path.join(repoRoot, relativePath)),
      bytes: (await stat(path.join(repoRoot, relativePath))).size,
    })),
  ),
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `Prepared ${manifest.files.length} public files in .github-export/repo`,
);
console.log(`Archive: MediSched.zip (${(await stat(archivePath)).size} bytes)`);
console.log("Manifest: .github-export/manifest.json");
