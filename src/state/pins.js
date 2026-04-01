import { getStorageSection, setStorageSection } from '../utils/storageStore.js';

const STORAGE_KEY = 'pins';
const DEFAULT_STATE = {
  chats: {}
};

function normalizePinEntry(entry = {}) {
  return {
    tag: String(entry.tag || '').trim().toLowerCase(),
    savedAt: Number(entry.savedAt) || Date.now(),
    savedBy: typeof entry.savedBy === 'string' ? entry.savedBy : null,
    sourceChatId: typeof entry.sourceChatId === 'string' ? entry.sourceChatId : null,
    sourceMessageId: typeof entry.sourceMessageId === 'string' ? entry.sourceMessageId : null,
    senderId: typeof entry.senderId === 'string' ? entry.senderId : null,
    text: typeof entry.text === 'string' ? entry.text : '',
    type: typeof entry.type === 'string' ? entry.type : 'text'
  };
}

function normalizeChatPins(value = {}) {
  const pins = value && typeof value === 'object' ? value : {};
  const normalized = {};
  for (const [tag, entry] of Object.entries(pins)) {
    const normalizedEntry = normalizePinEntry({ ...entry, tag });
    if (!normalizedEntry.tag) continue;
    normalized[normalizedEntry.tag] = normalizedEntry;
  }
  return normalized;
}

function normalizeState(state = {}) {
  const chats = state?.chats && typeof state.chats === 'object' ? state.chats : {};
  const normalizedChats = {};

  for (const [chatId, pins] of Object.entries(chats)) {
    if (!chatId || typeof chatId !== 'string') continue;
    normalizedChats[chatId] = normalizeChatPins(pins);
  }

  return { chats: normalizedChats };
}

export function getPinsState() {
  return normalizeState(getStorageSection(STORAGE_KEY, DEFAULT_STATE));
}

export function setPinsState(state) {
  return setStorageSection(STORAGE_KEY, normalizeState(state));
}

export function getChatPins(chatId) {
  const state = getPinsState();
  return normalizeChatPins(state.chats[chatId] || {});
}

export function getPinnedMessage(chatId, tag) {
  const key = String(tag || '').trim().toLowerCase();
  if (!key) return null;
  return getChatPins(chatId)[key] || null;
}

export function setPinnedMessage(chatId, entry) {
  const normalizedEntry = normalizePinEntry(entry);
  if (!normalizedEntry.tag) return null;

  const state = getPinsState();
  const chatPins = getChatPins(chatId);
  chatPins[normalizedEntry.tag] = normalizedEntry;
  state.chats[chatId] = chatPins;
  setPinsState(state);
  return normalizedEntry;
}

export function deletePinnedMessage(chatId, tag) {
  const key = String(tag || '').trim().toLowerCase();
  if (!key) return false;

  const state = getPinsState();
  const chatPins = getChatPins(chatId);
  if (!chatPins[key]) return false;
  delete chatPins[key];
  state.chats[chatId] = chatPins;
  setPinsState(state);
  return true;
}
