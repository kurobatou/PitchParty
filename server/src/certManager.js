import * as acme from 'acme-client';
import { X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findZoneId, createTxtRecord, deleteTxtRecord } from './cloudflareDns.js';

const DEFAULT_DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const LE_DIR = process.env.LE_CERT_DIR ?? join(DEFAULT_DATA_DIR, 'certs-le');
const ACCOUNT_KEY_PATH = join(LE_DIR, 'account-key.pem');
const RENEW_WITHIN_DAYS = 30;

function pathsFor(domain) {
  const dir = join(LE_DIR, domain);
  return { dir, keyPath: join(dir, 'key.pem'), certPath: join(dir, 'cert.pem') };
}

function daysUntilExpiry(certPem) {
  const cert = new X509Certificate(certPem);
  return (new Date(cert.validTo).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
}

async function getAccountKey() {
  mkdirSync(LE_DIR, { recursive: true });
  if (existsSync(ACCOUNT_KEY_PATH)) return readFileSync(ACCOUNT_KEY_PATH);
  const key = await acme.crypto.createPrivateKey();
  writeFileSync(ACCOUNT_KEY_PATH, key);
  return key;
}

/**
 * Gets (from disk, reusing a still-valid cert) or issues a real,
 * browser-trusted certificate for `domain` via Let's Encrypt's DNS-01
 * challenge, automated through the Cloudflare API — no need to expose
 * this server to the internet, since DNS-01 only proves you control the
 * domain's DNS, not that the domain is publicly reachable.
 */
export async function ensureLetsEncryptCert({ domain, cloudflareApiToken, email }) {
  const { dir, keyPath, certPath } = pathsFor(domain);

  if (existsSync(keyPath) && existsSync(certPath)) {
    const cert = readFileSync(certPath);
    if (daysUntilExpiry(cert) > RENEW_WITHIN_DAYS) {
      return { key: readFileSync(keyPath), cert, validUntil: new X509Certificate(cert).validTo };
    }
  }

  const accountKey = await getAccountKey();
  const client = new acme.Client({
    directoryUrl: acme.directory.letsencrypt.production,
    accountKey,
  });

  const [key, csr] = await acme.crypto.createCsr({ commonName: domain });

  const zoneId = await findZoneId(domain, cloudflareApiToken);
  const recordName = `_acme-challenge.${domain}`;
  const recordIdByToken = new Map(); // challenge.token -> Cloudflare DNS record id

  const cert = await client.auto({
    csr,
    email,
    termsOfServiceAgreed: true,
    challengePriority: ['dns-01'],
    challengeCreateFn: async (_authz, challenge, keyAuthorization) => {
      const recordId = await createTxtRecord(zoneId, cloudflareApiToken, recordName, keyAuthorization);
      recordIdByToken.set(challenge.token, recordId);
      // Give Cloudflare's edge a moment to propagate before Let's Encrypt
      // validates — cheap insurance against a validation race.
      await new Promise((resolve) => setTimeout(resolve, 15000));
    },
    challengeRemoveFn: async (_authz, challenge) => {
      const recordId = recordIdByToken.get(challenge.token);
      if (recordId) await deleteTxtRecord(zoneId, cloudflareApiToken, recordId);
    },
  });

  mkdirSync(dir, { recursive: true });
  writeFileSync(keyPath, key);
  writeFileSync(certPath, cert);

  return { key, cert, validUntil: new X509Certificate(cert).validTo };
}
