import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const SETTINGS_PATH = process.env.SETTINGS_PATH ?? join(DEFAULT_DATA_DIR, 'settings.json');

/**
 * Settings edited from the UI (library folders, LAN IP override) live in
 * this file on disk, separate from config.json (which only supplies the
 * first-run defaults) so they persist across restarts without needing to
 * hand-edit a repo file. Running as a plain Node process (no Docker) means
 * these can be any path the OS user can read — no container mount needed,
 * including a NAS share already mounted by the OS.
 */
export function loadSettings(defaults) {
  if (existsSync(SETTINGS_PATH)) {
    const parsed = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
    return {
      libraryPaths: parsed.libraryPaths ?? defaults.libraryPaths,
      lanIpOverride: parsed.lanIpOverride ?? null,
      // Optional: a real, browser-trusted cert via Let's Encrypt DNS-01
      // (see certManager.js) instead of the self-signed one, for a
      // domain the user owns that's managed in Cloudflare.
      publicDomain: parsed.publicDomain ?? null,
      cloudflareApiToken: parsed.cloudflareApiToken ?? null,
      acmeEmail: parsed.acmeEmail ?? null,
    };
  }
  return {
    libraryPaths: defaults.libraryPaths,
    lanIpOverride: null,
    publicDomain: null,
    cloudflareApiToken: null,
    acmeEmail: null,
  };
}

export function saveSettings(settings) {
  mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}
