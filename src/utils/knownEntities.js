import { getStorageSection, setStorageSection } from './storageStore.js';

const CHATS_KEY = 'knownChats';
const CONTACTS_KEY = 'knownContacts';
const LID_MAP_KEY = 'knownLidMap';

const DEFAULT_CHATS = { chats: {} };
const DEFAULT_CONTACTS = { contacts: {} };
const DEFAULT_LID_MAP = { map: {} };

function normalizeKey(jid) {
  const key = String(jid || '').trim();
  return key || null;
}

function digitsOf(jid) {
  return String(jid || '').replace(/[^\d]/g, '') || null;
}

export function getLidMap() {
  const state = getStorageSection(LID_MAP_KEY, DEFAULT_LID_MAP);
  return state.map && typeof state.map === 'object' ? state.map : {};
}

function setLidMap(map) {
  setStorageSection(LID_MAP_KEY, { map });
}

export function resolveCanonicalJid(jid) {
  const key = normalizeKey(jid);
  if (!key) return null;
  if (key.endsWith('@s.whatsapp.net') || key.endsWith('@g.us')) return key;
  if (key.endsWith('@lid')) {
    const map = getLidMap();
    return map[key] || key;
  }
  return key;
}

export function mapLidToJid(lid, jid) {
  const lidKey = normalizeKey(lid);
  const jidKey = normalizeKey(jid);
  if (!lidKey || !jidKey) return;
  if (!lidKey.endsWith('@lid')) return;
  if (!jidKey.endsWith('@s.whatsapp.net')) return;
  const map = getLidMap();
  map[lidKey] = jidKey;
  setLidMap(map);
}

export function getKnownChats() {
  const state = getStorageSection(CHATS_KEY, DEFAULT_CHATS);
  return state.chats && typeof state.chats === 'object' ? state.chats : {};
}

export function getKnownContacts() {
  const state = getStorageSection(CONTACTS_KEY, DEFAULT_CONTACTS);
  return state.contacts && typeof state.contacts === 'object' ? state.contacts : {};
}

export function upsertKnownChat(jid, data = {}) {
  const key = resolveCanonicalJid(jid);
  if (!key) return;
  const now = Date.now();
  const state = getStorageSection(CHATS_KEY, DEFAULT_CHATS);
  const existing = state.chats?.[key] || {};
  state.chats = state.chats && typeof state.chats === 'object' ? state.chats : {};
  state.chats[key] = {
    jid: key,
    firstSeen: existing.firstSeen || now,
    lastSeen: now,
    ...existing,
    ...data
  };
  setStorageSection(CHATS_KEY, state);
}

export function upsertKnownContact(jid, data = {}) {
  const key = resolveCanonicalJid(jid);
  if (!key) return;
  const now = Date.now();
  const state = getStorageSection(CONTACTS_KEY, DEFAULT_CONTACTS);
  const existing = state.contacts?.[key] || {};
  state.contacts = state.contacts && typeof state.contacts === 'object' ? state.contacts : {};
  state.contacts[key] = {
    jid: key,
    firstSeen: existing.firstSeen || now,
    lastSeen: now,
    ...existing,
    ...data
  };
  setStorageSection(CONTACTS_KEY, state);
}

export function dedupeKnownEntities() {
  const chatState = getStorageSection(CHATS_KEY, DEFAULT_CHATS);
  const contactState = getStorageSection(CONTACTS_KEY, DEFAULT_CONTACTS);

  const chats = chatState.chats && typeof chatState.chats === 'object' ? chatState.chats : {};
  const contacts = contactState.contacts && typeof contactState.contacts === 'object' ? contactState.contacts : {};

  const map = getLidMap();

  const byDigits = {};
  for (const [jid, entry] of Object.entries(contacts)) {
    const digits = digitsOf(jid);
    if (!digits) continue;
    if (!byDigits[digits]) byDigits[digits] = [];
    byDigits[digits].push({ jid, entry });
  }

  for (const group of Object.values(byDigits)) {
    const sJid = group.find((item) => item.jid.endsWith('@s.whatsapp.net'));
    if (!sJid) continue;
    for (const item of group) {
      if (item.jid.endsWith('@lid')) {
        map[item.jid] = sJid.jid;
      }
    }
  }
  setLidMap(map);

  const normalizedContacts = {};
  for (const [jid, entry] of Object.entries(contacts)) {
    const canonical = resolveCanonicalJid(jid);
    if (!canonical) continue;
    const existing = normalizedContacts[canonical] || {};
    normalizedContacts[canonical] = {
      jid: canonical,
      firstSeen: existing.firstSeen || entry.firstSeen || Date.now(),
      lastSeen: Math.max(existing.lastSeen || 0, entry.lastSeen || 0),
      ...existing,
      ...entry
    };
  }

  const normalizedChats = {};
  for (const [jid, entry] of Object.entries(chats)) {
    const canonical = resolveCanonicalJid(jid);
    if (!canonical) continue;
    const existing = normalizedChats[canonical] || {};
    normalizedChats[canonical] = {
      jid: canonical,
      firstSeen: existing.firstSeen || entry.firstSeen || Date.now(),
      lastSeen: Math.max(existing.lastSeen || 0, entry.lastSeen || 0),
      ...existing,
      ...entry
    };
  }

  setStorageSection(CHATS_KEY, { chats: normalizedChats });
  setStorageSection(CONTACTS_KEY, { contacts: normalizedContacts });
}
