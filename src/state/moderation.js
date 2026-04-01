import { getStorageSection, readStorage, setStorageSection, writeStorage } from '../utils/storageStore.js';

const STORAGE_KEY = 'moderation';

const DEFAULT_STATE = {
  antilinkGroups: [],
  antispamGroups: [],
  antiwordGroups: {},
  warnSettingsByGroup: {},
  warningsByGroup: {}
};

function normalizeState(state = {}) {
  return {
    antilinkGroups: Array.isArray(state.antilinkGroups) ? state.antilinkGroups : [],
    antispamGroups: Array.isArray(state.antispamGroups) ? state.antispamGroups : [],
    antiwordGroups: state.antiwordGroups && typeof state.antiwordGroups === 'object' ? state.antiwordGroups : {},
    warnSettingsByGroup: state.warnSettingsByGroup && typeof state.warnSettingsByGroup === 'object' ? state.warnSettingsByGroup : {},
    warningsByGroup: state.warningsByGroup && typeof state.warningsByGroup === 'object' ? state.warningsByGroup : {}
  };
}

export function getModerationState() {
  return normalizeState(getStorageSection(STORAGE_KEY, DEFAULT_STATE));
}

export function setModerationState(state) {
  return setStorageSection(STORAGE_KEY, normalizeState(state));
}

export function getWarnSettings(groupJid) {
  const state = getModerationState();
  return state.warnSettingsByGroup[groupJid] || { enabled: true, max: 3, action: 'kick' };
}

export function getWarningCount(groupJid, senderId) {
  const state = getModerationState();
  return state.warningsByGroup[groupJid]?.[senderId] || 0;
}

export function setWarningCount(groupJid, senderId, count) {
  const state = getModerationState();
  if (!state.warningsByGroup[groupJid]) state.warningsByGroup[groupJid] = {};
  state.warningsByGroup[groupJid][senderId] = count;
  setModerationState(state);
}

export function migrateLegacyModerationStorage() {
  const storage = readStorage();
  if (storage[STORAGE_KEY]) return false;

  const hasLegacyState = ['antilink', 'antispam', 'antiword', 'warnSettings', 'warnings']
    .some((key) => Object.prototype.hasOwnProperty.call(storage, key));

  if (!hasLegacyState) return false;

  storage[STORAGE_KEY] = normalizeState({
    antilinkGroups: storage.antilink || [],
    antispamGroups: storage.antispam || [],
    antiwordGroups: storage.antiword || {},
    warnSettingsByGroup: storage.warnSettings || {},
    warningsByGroup: storage.warnings || {}
  });

  delete storage.antilink;
  delete storage.antispam;
  delete storage.antiword;
  delete storage.warnSettings;
  delete storage.warnings;

  writeStorage(storage);
  return true;
}
