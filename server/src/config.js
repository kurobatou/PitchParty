import { readFileSync } from 'node:fs';

const CONFIG_PATH = process.env.CONFIG_PATH ?? '/app/config.json';

export function loadConfig() {
  const raw = readFileSync(CONFIG_PATH, 'utf-8');
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed.libraryPaths) || parsed.libraryPaths.length === 0) {
    throw new Error(`config.json must define a non-empty "libraryPaths" array (${CONFIG_PATH})`);
  }

  return parsed;
}
