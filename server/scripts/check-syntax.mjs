// Runs `node --check` on every .js/.mjs under src/ and public/ — a fast
// syntax gate for the whole codebase, including the browser files (app.js,
// join.js, ...) that can't be unit-tested without a real browser. Pure Node
// and cross-platform on purpose: no shell globbing (which differs between
// Git Bash and npm's shell on Windows).
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['src', 'public'];

function collect(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collect(full, out);
    } else if (/\.m?js$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const files = ROOTS.flatMap((r) => collect(join(serverRoot, r), []));
const failures = [];

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    failures.push({ file, message: err.stderr?.toString() || err.message });
  }
}

if (failures.length > 0) {
  for (const { file, message } of failures) {
    console.error(`✗ ${file}\n${message}`);
  }
  console.error(`\nSyntax check failed: ${failures.length} of ${files.length} file(s).`);
  process.exit(1);
}

console.log(`✓ Syntax OK — ${files.length} file(s) checked.`);
