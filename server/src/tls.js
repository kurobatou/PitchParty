import selfsigned from 'selfsigned';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const CERT_DIR = process.env.CERT_DIR ?? join(DEFAULT_DATA_DIR, 'certs');
const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/**
 * getUserMedia (mic capture) is only available in a "secure context":
 * HTTPS or localhost. A home LAN party server has neither a real domain
 * nor a trusted CA, so we self-sign a cert for the configured LAN IP,
 * cached under /data/certs so it survives restarts and phones only need
 * to click through the browser's "unsafe" warning once.
 */
export function getOrCreateCert(lanIp) {
  mkdirSync(CERT_DIR, { recursive: true });
  const keyPath = join(CERT_DIR, 'key.pem');
  const certPath = join(CERT_DIR, 'cert.pem');
  const metaPath = join(CERT_DIR, 'meta.json');

  if (existsSync(keyPath) && existsSync(certPath) && existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    if (meta.lanIp === lanIp) {
      return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
    }
  }

  const altNames = [
    { type: 2, value: 'localhost' }, // DNS
    { type: 7, ip: '127.0.0.1' }, // IP
  ];
  if (IPV4_RE.test(lanIp)) {
    altNames.push({ type: 7, ip: lanIp });
  } else {
    altNames.push({ type: 2, value: lanIp });
  }

  const pems = selfsigned.generate([{ name: 'commonName', value: lanIp }], {
    days: 3650,
    keySize: 2048,
    algorithm: 'sha256', // iOS rejects SHA-1 signed certs outright (no click-through)
    extensions: [{ name: 'subjectAltName', altNames }],
  });

  writeFileSync(keyPath, pems.private);
  writeFileSync(certPath, pems.cert);
  writeFileSync(metaPath, JSON.stringify({ lanIp }));

  return { key: pems.private, cert: pems.cert };
}
