import { messageTypeInfo } from './messageTypes.js';

const listEl = document.getElementById('message-list');
const refreshBtn = document.getElementById('refresh-btn');
const toggleResolvedBtn = document.getElementById('toggle-resolved-btn');
const purgeResolvedBtn = document.getElementById('purge-resolved-btn');
const statusEl = document.getElementById('messages-status');

let messages = [];
// Resolved messages are hidden by default so what's actually pending isn't
// buried under everything already handled. This lives outside loadMessages
// on purpose: the 15s auto-refresh must not collapse the list while someone
// is reading it.
let showResolved = false;

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function messageBody(m) {
  if (m.type === 'sync') {
    const song = m.song_title ? `<strong>${escapeHtml(m.song_title)}</strong>` : '';
    return m.text ? `${song}${song ? ' — ' : ''}${escapeHtml(m.text)}` : song || '<em>(sin detalle)</em>';
  }
  if (m.type === 'song_request') {
    const artist = m.requested_artist ? ` — ${escapeHtml(m.requested_artist)}` : '';
    const note = m.text ? `<br><span class="settings-hint">${escapeHtml(m.text)}</span>` : '';
    return `<strong>${escapeHtml(m.requested_title)}</strong>${artist}${note}`;
  }
  return escapeHtml(m.text || '');
}

function renderControls(resolvedCount) {
  toggleResolvedBtn.hidden = resolvedCount === 0;
  toggleResolvedBtn.textContent = showResolved
    ? `🙈 Ocultar resueltos (${resolvedCount})`
    : `👁 Ver resueltos (${resolvedCount})`;

  purgeResolvedBtn.hidden = resolvedCount === 0;
  purgeResolvedBtn.textContent = `🧹 Borrar resueltos (${resolvedCount})`;
}

function renderMessages() {
  const resolvedCount = messages.filter((m) => m.resolved).length;
  renderControls(resolvedCount);

  const visible = showResolved ? messages : messages.filter((m) => !m.resolved);

  if (messages.length === 0) {
    listEl.innerHTML = '<li class="settings-hint">No hay mensajes todavía.</li>';
    return;
  }

  if (visible.length === 0) {
    listEl.innerHTML = `<li class="settings-hint">No hay mensajes pendientes. Hay ${resolvedCount} resuelto${resolvedCount === 1 ? '' : 's'} oculto${resolvedCount === 1 ? '' : 's'}.</li>`;
    return;
  }

  listEl.innerHTML = visible.map((m) => {
    const info = messageTypeInfo(m.type);
    const when = new Date(m.created_at).toLocaleString();
    const who = m.nickname ? escapeHtml(m.nickname) : 'Anónimo';
    return `
      <li class="message-item ${m.resolved ? 'resolved' : ''}" data-id="${m.id}">
        <div class="message-item-head">
          <span class="message-type-badge">${info.emoji} ${escapeHtml(info.label)}</span>
          <span class="settings-hint">${who} · ${when}</span>
        </div>
        <div class="message-item-body">${messageBody(m)}</div>
        <div class="message-item-actions">
          <button type="button" class="toggle-resolved-btn" data-id="${m.id}" data-resolved="${m.resolved ? '0' : '1'}">
            ${m.resolved ? '↩ Marcar pendiente' : '✓ Marcar resuelto'}
          </button>
          <button type="button" class="delete-message-btn" data-id="${m.id}">🗑 Eliminar</button>
        </div>
      </li>
    `;
  }).join('');

  listEl.querySelectorAll('.toggle-resolved-btn').forEach((btn) => {
    btn.addEventListener('click', () => setResolved(Number(btn.dataset.id), btn.dataset.resolved === '1'));
  });
  listEl.querySelectorAll('.delete-message-btn').forEach((btn) => {
    btn.addEventListener('click', () => deleteMessage(Number(btn.dataset.id)));
  });
}

async function loadMessages() {
  try {
    const res = await fetch('/api/messages');
    messages = await res.json();
    renderMessages();
    statusEl.textContent = '';
  } catch (err) {
    statusEl.textContent = `No se pudo cargar: ${err.message}`;
  }
}

async function setResolved(id, resolved) {
  await fetch(`/api/messages/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolved }),
  });
  await loadMessages();
}

async function deleteMessage(id) {
  await fetch(`/api/messages/${id}`, { method: 'DELETE' });
  await loadMessages();
}

async function purgeResolved() {
  const resolvedCount = messages.filter((m) => m.resolved).length;
  if (resolvedCount === 0) return;

  const plural = resolvedCount === 1 ? 'el mensaje resuelto' : `los ${resolvedCount} mensajes resueltos`;
  if (!confirm(`¿Borrar ${plural}? Los pendientes no se tocan. Esto no se puede deshacer.`)) return;

  try {
    const res = await fetch('/api/messages/resolved', { method: 'DELETE' });
    const { deleted } = await res.json();
    await loadMessages();
    statusEl.textContent = `Se borraron ${deleted} mensaje${deleted === 1 ? '' : 's'} resuelto${deleted === 1 ? '' : 's'}.`;
  } catch (err) {
    statusEl.textContent = `No se pudo borrar: ${err.message}`;
  }
}

refreshBtn.addEventListener('click', loadMessages);
toggleResolvedBtn.addEventListener('click', () => {
  showResolved = !showResolved;
  renderMessages();
});
purgeResolvedBtn.addEventListener('click', purgeResolved);

loadMessages();
setInterval(loadMessages, 15000);
