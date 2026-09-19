import { activeSession, itemName } from './model.js';

export const SYNC_KEY = 'countlist.sync';

export function syncPayload(state) {
  const session = activeSession(state);
  const lang = state.preferences.lang;
  return {
    session: session.name || '',
    date: session.date,
    items: session.items
      .filter(item => !item.spacer)
      .map(item => ({ name: itemName(item, lang), qty: item.qty })),
  };
}

export function createCloud({ storage, getState, onStatus }) {
  let url = storage.getItem(SYNC_KEY) || '';
  let timer = null, sending = false, status = {};

  const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;
  const configured = () => url.length > 0;
  const readUrl = () => url;

  function report(extra) {
    status = { ...status, configured: configured(), online: online(), ...extra };
    if (onStatus) onStatus(status);
  }
  function setUrl(value) {
    url = String(value || '').trim();
    if (url) storage.setItem(SYNC_KEY, url);
    else storage.removeItem?.(SYNC_KEY);
    report();
  }
  function schedule() {
    if (!configured()) { report(); return; }
    report({ pending: true, synced: false, error: null });
    clearTimeout(timer);
    timer = setTimeout(send, 2000);
  }
  async function send() {
    clearTimeout(timer);
    if (!configured()) { report(); return false; }
    if (!online()) { report({ pending: true, offline: true }); return false; }
    if (sending) { report({ pending: true }); return false; }
    sending = true;
    report({ sending: true, pending: true, error: null });
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(syncPayload(getState())),
        keepalive: true,
      });
      if (!response.ok) throw new Error(`Sync failed (${response.status})`);
      report({ sending: false, pending: false, synced: true, at: Date.now(), error: null });
      return true;
    } catch (error) {
      report({ sending: false, pending: true, synced: false, error: error.message });
      return false;
    } finally {
      sending = false;
    }
  }

  return { readUrl, setUrl, schedule, send, configured, online, refresh: () => report() };
}
