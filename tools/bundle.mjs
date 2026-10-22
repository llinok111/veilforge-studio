/**
 * Minimal ESM flattener.
 *
 * The project ships as plain ES modules (no build step needed to read the source),
 * but two artefacts must be single-file: the standalone demo and the Canvas
 * runtime users download. Rather than pull in a bundler, this walks the import
 * graph myself — it is ~70 lines and the only thing it has to understand is
 * `import … from './x.js'` plus `export`, which I control.
 */

import fs from 'node:fs';
import path from 'node:path';

const IMPORT_RE = /^[ \t]*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"][ \t]*;?[ \t]*$/gm;

function stripModuleSyntax(src) {
  return src
    .replace(/^[ \t]*export\s+\{[^}]*\}[ \t]*;?[ \t]*$/gm, '')
    .replace(/^[ \t]*export\s+default\s+/gm, 'const __default__ = ')
    .replace(/^[ \t]*export\s+(async\s+function|function|class|const|let|var)\b/gm, '$1');
}

/**
 * Depth-first topological flatten.
 * Returns [{ file, src }] in dependency order with module syntax removed.
 */
export function flatten(entry) {
  const visited = new Set();
  const out = [];

  const visit = (file) => {
    const abs = path.resolve(file);
    if (visited.has(abs)) return;
    visited.add(abs);

    let src = fs.readFileSync(abs, 'utf8');
    const deps = [];
    src = src.replace(IMPORT_RE, (_m, spec) => {
      if (spec.startsWith('.')) deps.push(path.resolve(path.dirname(abs), spec));
      return '';
    });
    deps.forEach(visit);
    out.push({ file: path.relative(process.cwd(), abs).replace(/\\/g, '/'), src: stripModuleSyntax(src) });
  };

  visit(entry);
  return out;
}

/**
 * Top-level binding names declared by a module. Used to catch collisions: once
 * modules are concatenated into one scope, two `const BUILDERS` in different files
 * become a SyntaxError that only shows up in the built artefact.
 */
function topLevelNames(src) {
  const names = new Set();
  const re = /^(?:export\s+)?(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(src))) names.add(m[1]);
  return names;
}

/** Concatenate into one IIFE-compatible script body. */
export function bundle(entry, { header = '', indent = '' } = {}) {
  const parts = flatten(entry);

  const owner = new Map();
  const clashes = [];
  for (const part of parts) {
    for (const name of topLevelNames(part.src)) {
      if (owner.has(name) && owner.get(name) !== part.file) {
        clashes.push(`${name} (${owner.get(name)} ↔ ${part.file})`);
      } else {
        owner.set(name, part.file);
      }
    }
  }
  if (clashes.length) {
    throw new Error(`bundle: top-level name collision in flattened scope: ${clashes.join(', ')}`);
  }
  const body = parts
    .map((p) => `/* ---- ${p.file} ---- */\n${p.src.trim()}\n`)
    .join('\n');
  return `${header}${body}`;
}

/** Stable content hash for staleness checks. */
export function hashOf(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
