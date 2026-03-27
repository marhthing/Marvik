import memoryStore from './memory.js';
import { getKnownChats, getKnownContacts, resolveCanonicalJid, getLidMap } from './knownEntities.js';
import { normalizeWhatsAppJid } from './whatsappJid.js';

export function getMemoryChats(platform = 'whatsapp') {
  return Object.keys(memoryStore.messages?.[platform] || {});
}

export function getStoredChats() {
  return Object.keys(getKnownChats() || {});
}

export function getStoredContacts() {
  return getKnownContacts() || {};
}

export function getRuntimeContacts(adapter) {
  return adapter?.getContacts?.() || adapter?.client?.contacts || {};
}

export function getMergedChats({ includeStored = true, includeMemory = true, platform = 'whatsapp' } = {}) {
  const chats = [];
  if (includeStored) chats.push(...getStoredChats());
  if (includeMemory) chats.push(...getMemoryChats(platform));
  return Array.from(new Set(chats));
}

export function getMergedContacts({ adapter = null, includeStored = true, includeRuntime = true } = {}) {
  const stored = includeStored ? getStoredContacts() : {};
  const runtime = includeRuntime ? getRuntimeContacts(adapter) : {};
  return { ...stored, ...runtime };
}

export function filterChats(chats = [], mode = '') {
  if (mode === 'users') return chats.filter((jid) => jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid'));
  if (mode === 'groups') return chats.filter((jid) => jid.endsWith('@g.us'));
  return chats;
}

function uniqueJids(list = []) {
  return Array.from(new Set(list.filter(Boolean)));
}

function getStoredRecipients() {
  const storedContacts = Object.keys(getStoredContacts());
  const storedChats = getStoredChats();
  return [...storedContacts, ...storedChats]
    .map((jid) => resolveCanonicalJid(jid))
    .filter((jid) => typeof jid === 'string' && jid.endsWith('@s.whatsapp.net'));
}

function getRuntimeContactRecipients(adapter) {
  const contacts = getRuntimeContacts(adapter);
  return Object.keys(contacts)
    .map((jid) => normalizeWhatsAppJid(jid))
    .filter((jid) => typeof jid === 'string' && jid.endsWith('@s.whatsapp.net'));
}

function getRecentRecipients(platform = 'whatsapp') {
  return getMemoryChats(platform).filter((jid) => jid.endsWith('@s.whatsapp.net'));
}

export function getStatusRecipients({ adapter = null, audience = null, platform = 'whatsapp' } = {}) {
  if (Array.isArray(audience) && audience.length) {
    return uniqueJids(audience);
  }
  if (audience === 'recent') {
    return uniqueJids(getRecentRecipients(platform));
  }
  if (audience === 'all') {
    return uniqueJids([
      ...getStoredRecipients(),
      ...getRuntimeContactRecipients(adapter),
      ...getRecentRecipients(platform)
    ]);
  }

  const stored = getStoredRecipients();
  if (stored.length) return uniqueJids(stored);

  const runtime = getRuntimeContactRecipients(adapter);
  if (runtime.length) return uniqueJids(runtime);

  return uniqueJids(getRecentRecipients(platform));
}

export function dedupeByCanonical(jids = []) {
  const map = new Map();
  for (const jid of jids) {
    const canonical = resolveCanonicalJid(jid) || jid;
    if (!canonical) continue;
    if (!map.has(canonical)) map.set(canonical, canonical);
  }
  return Array.from(map.values());
}

export function getDisplayNameForJid(jid) {
  const canonical = resolveCanonicalJid(jid) || jid;
  const contacts = getStoredContacts();
  const direct = contacts[canonical];
  if (direct) {
    return direct.name || direct.notify || direct.verifiedName || direct.short || null;
  }
  const lidMap = getLidMap();
  for (const [lid, mapped] of Object.entries(lidMap)) {
    if (mapped === canonical && contacts[lid]) {
      const entry = contacts[lid];
      return entry.name || entry.notify || entry.verifiedName || entry.short || null;
    }
  }
  return null;
}
