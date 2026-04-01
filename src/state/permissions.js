import { getStorageSection, readStorage, setStorageSection, writeStorage } from '../utils/storageStore.js';

const STORAGE_KEY = 'permissions';
const DEFAULT_STATE = {
  allowedCommands: {}
};

function normalizeState(state = {}) {
  const allowedCommands = state?.allowedCommands && typeof state.allowedCommands === 'object'
    ? state.allowedCommands
    : {};

  const normalized = {};
  for (const [commandName, entries] of Object.entries(allowedCommands)) {
    normalized[commandName] = Array.isArray(entries)
      ? Array.from(new Set(entries.filter((entry) => typeof entry === 'string' && entry.trim())))
      : [];
  }

  return { allowedCommands: normalized };
}

export function getPermissionsState() {
  return normalizeState(getStorageSection(STORAGE_KEY, DEFAULT_STATE));
}

export function setPermissionsState(state) {
  return setStorageSection(STORAGE_KEY, normalizeState(state));
}

export function getAllowedCommandsMap() {
  return getPermissionsState().allowedCommands;
}

export function isCommandAllowedForJid(commandName, jid) {
  const allowedCommands = getAllowedCommandsMap();
  return Array.isArray(allowedCommands[commandName]) && allowedCommands[commandName].includes(jid);
}

export function allowCommandForJid(commandName, jid) {
  const state = getPermissionsState();
  state.allowedCommands[commandName] = state.allowedCommands[commandName] || [];
  if (!state.allowedCommands[commandName].includes(jid)) {
    state.allowedCommands[commandName].push(jid);
  }
  return setPermissionsState(state);
}

export function denyCommandForJid(commandName, jid) {
  const state = getPermissionsState();
  state.allowedCommands[commandName] = (state.allowedCommands[commandName] || []).filter((entry) => entry !== jid);
  return setPermissionsState(state);
}

export function migrateLegacyPermissionsStorage() {
  const storage = readStorage();
  const legacyAllowedCommands = storage.allowedCommands;
  const current = getPermissionsState();

  if (!legacyAllowedCommands || typeof legacyAllowedCommands !== 'object') {
    return current;
  }

  const nextState = normalizeState({
    allowedCommands: {
      ...legacyAllowedCommands,
      ...current.allowedCommands
    }
  });

  storage.permissions = nextState;
  delete storage.allowedCommands;
  writeStorage(storage);

  return nextState;
}
