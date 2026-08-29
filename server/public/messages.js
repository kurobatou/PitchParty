import { messageTypeInfo } from './messageTypes.js';

const listEl = document.getElementById('message-list');
const refreshBtn = document.getElementById('refresh-btn');
const statusEl = document.getElementById('messages-status');

let messages = [];

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

function renderMessages() {
  if (messages.length === 0) {
    listEl.innerHTML = '<li class="settings-hint">No hay mensajes todavía.</li>';
    return;
  }

  listEl.innerHTML = messages.map((m) => {
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

refreshBtn.addEventListener('click', loadMessages);
loadMessages();
setInterval(loadMessages, 15000);
