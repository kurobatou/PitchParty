// Minimal Cloudflare API v4 client — just enough to create/delete the
// _acme-challenge TXT record the Let's Encrypt DNS-01 flow needs (see
// certManager.js). Uses global fetch (Node 18+), no SDK dependency.

const API_BASE = 'https://api.cloudflare.com/client/v4';

async function cfFetch(path, token, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const body = await res.json();
  if (!res.ok || body.success === false) {
    const message = body.errors?.map((e) => e.message).join('; ') || res.statusText;
    throw new Error(`Cloudflare API error (${res.status}): ${message}`);
  }
  return body.result;
}

// A "domain" the user configures (e.g. karaoke.midominio.com) may live in
// a zone that's the whole registered domain (midominio.com) or, less
// commonly, a zone for a deeper subdomain. Try progressively shorter
// suffixes until Cloudflare recognizes one as a zone we can manage.
export async function findZoneId(domain, token) {
  const labels = domain.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join('.');
    const zones = await cfFetch(`/zones?name=${encodeURIComponent(candidate)}`, token);
    if (zones.length > 0) return zones[0].id;
  }
  throw new Error(`No Cloudflare zone found for "${domain}" — check the API token has access to it`);
}

export async function createTxtRecord(zoneId, token, name, content) {
  const record = await cfFetch(`/zones/${zoneId}/dns_records`, token, {
    method: 'POST',
    body: JSON.stringify({ type: 'TXT', name, content, ttl: 120 }),
  });
  return record.id;
}

export async function deleteTxtRecord(zoneId, token, recordId) {
  await cfFetch(`/zones/${zoneId}/dns_records/${recordId}`, token, { method: 'DELETE' });
}
