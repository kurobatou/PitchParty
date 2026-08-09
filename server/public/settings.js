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

const enableMicsBtn = document.getElementById('enable-mics-btn');
const micsStatusEl = document.getElementById('mics-status');
const micListEl = document.getElementById('mic-list');
const saveMicsBtn = document.getElementById('save-mics-btn');
const saveMicsStatusEl = document.getElementById('save-mics-status');

const monitorEnabledEl = document.getElementById('monitor-enabled');
const monitorDeviceEl = document.getElementById('monitor-device');
const monitorVolumeEl = document.getElementById('monitor-volume');
const monitorVolumeValEl = document.getElementById('monitor-volume-val');
const saveMonitorBtn = document.getElementById('save-monitor-btn');
const monitorStatusEl = document.getElementById('monitor-status');
let monitorDeviceId = null; // saved monitor mic (may not be visible right now)

const publicDomainEl = document.getElementById('public-domain');
const cloudflareTokenEl = document.getElementById('cloudflare-token');
const acmeEmailEl = document.getElementById('acme-email');
const saveCertBtn = document.getElementById('save-cert-btn');
const certStatusEl = document.getElementById('cert-status');
const certInfoEl = document.getElementById('cert-info');

let libraryPaths = [];
// Set of deviceIds currently enabled (from settings.json), and the audio
// input devices this browser can see (populated once the user grants mic
// permission so the OS labels are readable).
let enabledMicIds = new Set();
let savedMicsById = {}; // deviceId -> { deviceId, label } (to keep labels of not-connected mics)
let detectedInputs = [];

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

  savedMicsById = Object.fromEntries((data.localMics || []).map((m) => [m.deviceId, { deviceId: m.deviceId, label: m.label || '' }]));
  enabledMicIds = new Set(Object.keys(savedMicsById));
  renderMicList();

  const mm = data.micMonitor || {};
  monitorEnabledEl.checked = Boolean(mm.enabled);
  monitorDeviceId = mm.deviceId || null;
  const vol = Number.isFinite(mm.musicVolume) ? mm.musicVolume : 70;
  monitorVolumeEl.value = vol;
  monitorVolumeValEl.textContent = `${vol}%`;
  renderMonitorDevices();
}

// Fills the monitor mic <select> from the detected inputs, keeping the saved
// device selectable even if it isn't connected right now.
function renderMonitorDevices() {
  const opts = ['<option value="">(elegí un micrófono)</option>'];
  const seen = new Set();
  for (const d of detectedInputs) {
    seen.add(d.deviceId);
    const sel = d.deviceId === monitorDeviceId ? 'selected' : '';
    opts.push(`<option value="${escapeHtml(d.deviceId)}" ${sel}>${escapeHtml(d.label || 'Micrófono sin nombre')}</option>`);
  }
  if (monitorDeviceId && !seen.has(monitorDeviceId)) {
    const label = savedMicsById[monitorDeviceId]?.label || '(micrófono guardado)';
    opts.push(`<option value="${escapeHtml(monitorDeviceId)}" selected>${escapeHtml(label)} — no conectado ahora</option>`);
  }
  monitorDeviceEl.innerHTML = opts.join('');
}

monitorDeviceEl.addEventListener('change', () => { monitorDeviceId = monitorDeviceEl.value || null; });
monitorVolumeEl.addEventListener('input', () => { monitorVolumeValEl.textContent = `${monitorVolumeEl.value}%`; });

saveMonitorBtn.addEventListener('click', async () => {
  const micMonitor = {
    enabled: monitorEnabledEl.checked,
    deviceId: monitorDeviceEl.value || null,
    musicVolume: Number(monitorVolumeEl.value),
  };
  monitorStatusEl.textContent = 'Guardando...';
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ micMonitor }),
  });
  const data = await res.json();
  if (!res.ok) { monitorStatusEl.textContent = `Error: ${data.error}`; return; }
  const mm = data.micMonitor || {};
  monitorDeviceId = mm.deviceId || null;
  monitorStatusEl.textContent = mm.enabled
    ? `Guardado — monitor activo, música al ${mm.musicVolume}%. Recargá la Sala para aplicarlo.`
    : 'Guardado — monitor desactivado.';
});

// Renders one checkbox row per known audio input, plus any enabled mic whose
// device isn't currently visible (unplugged/Bluetooth off) so it isn't
// silently dropped. Checked = available for use in the Sala.
function renderMicList() {
  const seen = new Set(detectedInputs.map((d) => d.deviceId));
  const rows = detectedInputs.map((d) => ({ deviceId: d.deviceId, label: d.label, missing: false }));
  for (const deviceId of enabledMicIds) {
    if (!seen.has(deviceId)) {
      rows.push({ deviceId, label: savedMicsById[deviceId]?.label || '(micrófono guardado)', missing: true });
    }
  }

  if (rows.length === 0) {
    micListEl.innerHTML = '<li class="settings-hint">Tocá "Detectar micrófonos" para ver los dispositivos de entrada de este equipo.</li>';
    return;
  }

  micListEl.innerHTML = rows.map((d) => {
    const label = d.label || 'Micrófono sin nombre';
    const checked = enabledMicIds.has(d.deviceId) ? 'checked' : '';
    return `
      <li>
        <label class="mic-toggle">
          <input type="checkbox" class="mic-check" data-device-id="${escapeHtml(d.deviceId)}"
                 data-label="${escapeHtml(label)}" ${checked} />
          <span class="path-text">${escapeHtml(label)}${d.missing ? ' <span class="path-missing">⚠ no conectado ahora</span>' : ''}</span>
        </label>
      </li>
    `;
  }).join('');

  micListEl.querySelectorAll('.mic-check').forEach((chk) => {
    chk.addEventListener('change', () => {
      const id = chk.dataset.deviceId;
      if (chk.checked) enabledMicIds.add(id);
      else enabledMicIds.delete(id);
    });
  });
}

enableMicsBtn.addEventListener('click', async () => {
  enableMicsBtn.disabled = true;
  micsStatusEl.textContent = 'Pidiendo permiso de micrófono...';
  try {
    // Device labels are only exposed after a getUserMedia grant on this
    // origin; without it enumerateDevices returns blank names.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    const devices = await navigator.mediaDevices.enumerateDevices();
    detectedInputs = devices.filter((d) => d.kind === 'audioinput' && d.deviceId);
    micsStatusEl.textContent = `${detectedInputs.length} dispositivo(s) de entrada detectado(s).`;
    renderMicList();
    renderMonitorDevices();
  } catch (err) {
    micsStatusEl.textContent = `No se pudo acceder al micrófono: ${err.message}`;
  } finally {
    enableMicsBtn.disabled = false;
  }
});

saveMicsBtn.addEventListener('click', async () => {
  const localMics = [...micListEl.querySelectorAll('.mic-check')]
    .filter((chk) => chk.checked)
    .map((chk) => ({ deviceId: chk.dataset.deviceId, label: chk.dataset.label || '' }));

  saveMicsStatusEl.textContent = 'Guardando...';
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ localMics }),
  });
  const data = await res.json();
  if (!res.ok) {
    saveMicsStatusEl.textContent = `Error: ${data.error}`;
    return;
  }
  savedMicsById = Object.fromEntries((data.localMics || []).map((m) => [m.deviceId, { deviceId: m.deviceId, label: m.label || '' }]));
  enabledMicIds = new Set(Object.keys(savedMicsById));
  renderMicList();
  saveMicsStatusEl.textContent = localMics.length
    ? `Guardado — ${localMics.length} micrófono(s) disponible(s). Se usan desde la Sala.`
    : 'Guardado — sin micrófonos físicos habilitados.';
});

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
