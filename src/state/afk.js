import { getStorageSection, setStorageSection } from '../utils/storageStore.js';
import { normalizeDirectJid } from '../utils/destinationRouter.js';

const STORAGE_KEY = 'afk';
const DEFAULT_STATE = { users: {} };

export function normalizeAfkJid(jid) {
  return normalizeDirectJid(jid) || String(jid || '').trim().toLowerCase() || null;
}

export function getAfkState() {
  const state = getStorageSection(STORAGE_KEY, DEFAULT_STATE);
  return {
    users: state.users && typeof state.users === 'object' ? state.users : {}
  };
}

export function saveAfkState(state) {
  setStorageSection(STORAGE_KEY, state);
}

export function getAfkEntry(jid) {
  const key = normalizeAfkJid(jid);
  if (!key) return null;
  return getAfkState().users[key] || null;
}

export function setAfkEntry(jid, entry) {
  const key = normalizeAfkJid(jid);
  if (!key) return;
  const state = getAfkState();
  state.users[key] = entry;
  saveAfkState(state);
}

export function deleteAfkEntry(jid) {
  const key = normalizeAfkJid(jid);
  if (!key) return;
  const state = getAfkState();
  delete state.users[key];
  saveAfkState(state);
}
