const libraryListEl = document.getElementById('library-list');
const newPathEl = document.getElementById('new-path');
const browseBtn = document.getElementById('browse-btn');
const addPathBtn = document.getElementById('add-path-btn');
const saveLibraryBtn = document.getElementById('save-library-btn');
const libraryStatusEl = document.getElementById('library-status');

const detectedIpEl = document.getElementById('detected-ip');
const effectiveIpEl = document.getElementById('effective-ip');
const ipOverrideEl = document.getElementById('ip-override');
const saveIpBtn = document.getElementById('save-ip-btn');
const ipStatusEl = document.getElementById('ip-status');

const publicDomainEl = document.getElementById('public-domain');
const cloudflareTokenEl = document.getElementById('cloudflare-token');
const acmeEmailEl = document.getElementById('acme-email');
const saveCertBtn = document.getElementById('save-cert-btn');
const certStatusEl = document.getElementById('cert-status');
const certInfoEl = document.getElementById('cert-info');

let libraryPaths = [];

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderLibraryList(statusByPath = {}) {
  libraryListEl.innerHTML = libraryPaths.map((p, i) => {
    const status = statusByPath[p];
    const badge = status === undefined
      ? ''
      : status
        ? '<span class="path-ok">✓ existe</span>'
        : '<span class="path-missing">⚠ no encontrada</span>';
    return `
      <li>
        <span class="path-text">${escapeHtml(p)}</span>
        ${badge}
        <button data-index="${i}" class="remove-path-btn" type="button">Quitar</button>
      </li>
    `;
  }).join('') || '<li class="settings-hint">No hay carpetas configuradas.</li>';

  libraryListEl.querySelectorAll('.remove-path-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      libraryPaths.splice(Number(btn.dataset.index), 1);
      renderLibraryList();
    });
  });
}

async function loadSettings() {
  const res = await fetch('/api/settings');
  const data = await res.json();

  libraryPaths = data.libraryPaths;
  const statusByPath = Object.fromEntries(data.libraryPathStatus.map((s) => [s.path, s.exists]));
  renderLibraryList(statusByPath);

  detectedIpEl.textContent = data.detectedLanIp || '(no detectada)';
  effectiveIpEl.textContent = data.effectiveLanIp || '(sin HTTPS — el mic no va a funcionar en celulares)';
  ipOverrideEl.value = data.lanIpOverride || '';

  publicDomainEl.value = data.publicDomain || '';
  acmeEmailEl.value = data.acmeEmail || '';
  cloudflareTokenEl.placeholder = data.cloudflareTokenSet
    ? 'Token guardado (dejalo vacío para no cambiarlo)'
    : 'Token de API de Cloudflare';
  renderCertInfo(data.certInfo);
}

function renderCertInfo(certInfo) {
  if (!certInfo) {
    certInfoEl.textContent = '—';
  } else if (certInfo.type === 'letsencrypt') {
    certInfoEl.textContent = `Let's Encrypt para ${certInfo.domain} (válido hasta ${new Date(certInfo.validUntil).toLocaleDateString()})`;
  } else {
    certInfoEl.textContent = `Autofirmado para ${certInfo.lanIp}`;
  }
}

addPathBtn.addEventListener('click', () => {
  const path = newPathEl.value.trim();
  if (!path) return;
  libraryPaths.push(path);
  newPathEl.value = '';
  renderLibraryList();
});

browseBtn.addEventListener('click', async () => {
  browseBtn.disabled = true;
  try {
    const res = await fetch('/api/browse-folder', { method: 'POST' });
    if (res.status === 501) {
      alert('No hay un selector de carpetas nativo disponible en este sistema. Escribí la ruta a mano.');
      return;
    }
    const data = await res.json();
    if (data.path) {
      libraryPaths.push(data.path);
      renderLibraryList();
    }
  } finally {
    browseBtn.disabled = false;
  }
});

saveLibraryBtn.addEventListener('click', async () => {
  if (libraryPaths.length === 0) {
    libraryStatusEl.textContent = 'Agregá al menos una carpeta.';
    return;
  }
  libraryStatusEl.textContent = 'Reindexando...';
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ libraryPaths }),
  });
  const data = await res.json();
  if (!res.ok) {
    libraryStatusEl.textContent = `Error: ${data.error}`;
    return;
  }
  const statusByPath = Object.fromEntries(data.libraryPathStatus.map((s) => [s.path, s.exists]));
  renderLibraryList(statusByPath);
  libraryStatusEl.textContent = `Listo — ${data.reindex.total} canciones indexadas (${data.reindex.indexed} nuevas/actualizadas, ${data.reindex.skipped} omitidas, ${data.reindex.removed} eliminadas).`;
});

saveIpBtn.addEventListener('click', async () => {
  ipStatusEl.textContent = 'Guardando...';
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lanIpOverride: ipOverrideEl.value.trim() || null }),
  });
  const data = await res.json();
  effectiveIpEl.textContent = data.effectiveLanIp || '(sin HTTPS)';
  ipStatusEl.textContent = data.lanIpRestartRequired
    ? 'Guardado — reiniciá el servidor a mano (Ctrl+C y "npm start" de nuevo) para aplicar el cambio.'
    : 'Guardado.';
});

saveCertBtn.addEventListener('click', async () => {
  const domain = publicDomainEl.value.trim();
  if (!domain) {
    certStatusEl.textContent = 'Ingresá un dominio.';
    return;
  }

  const body = { publicDomain: domain, acmeEmail: acmeEmailEl.value.trim() || null };
  // Empty token field means "keep the saved one" — only send it if the
  // user actually typed something, so re-saving the domain doesn't wipe it.
  if (cloudflareTokenEl.value.trim()) body.cloudflareApiToken = cloudflareTokenEl.value.trim();

  saveCertBtn.disabled = true;
  certStatusEl.textContent = 'Generando certificado (puede tardar 1-2 minutos por la validación DNS)...';
  try {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    cloudflareTokenEl.value = '';
    cloudflareTokenEl.placeholder = data.cloudflareTokenSet
      ? 'Token guardado (dejalo vacío para no cambiarlo)'
      : 'Token de API de Cloudflare';

    if (!data.certAttempt) {
      certStatusEl.textContent = 'Guardado. Falta el token de Cloudflare para generar el certificado.';
    } else if (data.certAttempt.ok) {
      certStatusEl.textContent = `Certificado generado (válido hasta ${new Date(data.certAttempt.validUntil).toLocaleDateString()}) — reiniciá el servidor a mano para empezar a usarlo.`;
    } else {
      certStatusEl.textContent = `Error generando el certificado: ${data.certAttempt.error}`;
    }
  } finally {
    saveCertBtn.disabled = false;
  }
});

loadSettings();
