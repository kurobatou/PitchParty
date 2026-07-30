import { networkInterfaces } from 'node:os';

// Running as a plain Node process (no Docker) means os.networkInterfaces()
// reflects this machine's real network adapters, so the LAN IP used for
// the HTTPS cert (see tls.js) can be found automatically instead of
// hand-edited in .env every time the server moves to a different
// computer. Works the same on Windows, macOS and Linux.
const PREFERRED_INTERFACE_PATTERNS = [/^en/, /^wi-?fi/i, /^eth/, /^wlan/];

export function detectLanIp() {
  const interfaces = networkInterfaces();
  const candidates = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      candidates.push({ name, address: addr.address });
    }
  }

  if (candidates.length === 0) return null;

  for (const pattern of PREFERRED_INTERFACE_PATTERNS) {
    const match = candidates.find((c) => pattern.test(c.name));
    if (match) return match.address;
  }

  return candidates[0].address;
}
