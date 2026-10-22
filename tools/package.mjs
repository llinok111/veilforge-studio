/**
 * Packages the deliverable ZIP.
 *
 * Uses PowerShell's Compress-Archive (no npm dependency) and an explicit include
 * list, so the archive can never accidentally carry node_modules, run logs or
 * verification screenshots.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = path.basename(root);
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const outDir = path.resolve(root, '..', 'deliver-veilforge');
fs.mkdirSync(outDir, { recursive: true });

const INCLUDE = [
  'index.html',
  'package.json',
  'README.md',
  'LICENSE',
  'NOTICE',
  '.gitignore',
  'src',
  'styles',
  'assets',
  'tools',
  'tests',
  'verify/verify.mjs',
  'verify/perf.mjs',
  'verify/built.mjs',
  'verify/ascii.mjs',
  'verify/inspect-all.mjs',
  'verify/probe.mjs',
  'verify/browser.mjs',
  'verify/browser-raw.mjs',
  'verify/out/report.md',
  'verify/out/report.json',
  'dist/veilforge.html',
  'dist/demo.html',
  'dist/veilforge-runtime.js',
];

const missing = INCLUDE.filter((rel) => !fs.existsSync(path.join(root, rel)));
if (missing.length) {
  console.error('missing before packaging:\n  ' + missing.join('\n  '));
  process.exit(1);
}

const staging = path.join(outDir, '.__stage__');
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });
const target = path.join(staging, project);

for (const rel of INCLUDE) {
  const src = path.join(root, rel);
  const dst = path.join(target, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
}

const zipName = `${project}-v${version}.zip`;
const zipPath = path.join(outDir, zipName);
fs.rmSync(zipPath, { force: true });

execFileSync(
  'powershell',
  ['-NoProfile', '-NonInteractive', '-Command', `Compress-Archive -Path '${target}' -DestinationPath '${zipPath}' -CompressionLevel Optimal`],
  { stdio: 'inherit' },
);

// Verify the archive by listing its entries back out.
const listing = execFileSync(
  'powershell',
  ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -A System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::OpenRead('${zipPath}').Entries.Count`],
  { encoding: 'utf8' },
).trim();

const size = fs.statSync(zipPath).size;
fs.rmSync(staging, { recursive: true, force: true });

console.log(`zip   ${zipName}  ${(size / 1024).toFixed(1)} KB  entries=${listing}`);
console.log(`path  ${zipPath}`);
