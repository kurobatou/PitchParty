import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG_PATH = process.env.CONFIG_PATH ?? join(REPO_ROOT, 'config.json');

// config.json only supplies first-run defaults (see settings.js) — once
// the server has started once, the live library paths live in
// server/data/settings.json and are editable from the settings UI.
export function loadConfig() {
  const raw = readFileSync(CONFIG_PATH, 'utf-8');
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed.libraryPaths) || parsed.libraryPaths.length === 0) {
    throw new Error(`config.json must define a non-empty "libraryPaths" array (${CONFIG_PATH})`);
  }

  return {
    ...parsed,
    libraryPaths: parsed.libraryPaths.map((p) => (isAbsolute(p) ? p : resolve(REPO_ROOT, p))),
  };
}
