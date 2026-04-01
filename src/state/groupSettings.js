import { getStorageSection, setStorageSection } from '../utils/storageStore.js';

const STORAGE_KEY = 'groupSettings';
const DEFAULT_GROUP_SETTINGS = {
  ephemeralDuration: null,
  joinRequestsEnabled: null
};

function normalizeSettings(settings = {}) {
  return {
    ephemeralDuration: Number.isInteger(settings?.ephemeralDuration) ? settings.ephemeralDuration : null,
    joinRequestsEnabled: typeof settings?.joinRequestsEnabled === 'boolean' ? settings.joinRequestsEnabled : null
  };
}

function normalizeState(state = {}) {
  const groups = state?.groups && typeof state.groups === 'object' ? state.groups : {};
  const normalizedGroups = {};

  for (const [groupJid, settings] of Object.entries(groups)) {
    if (typeof groupJid !== 'string' || !groupJid.trim()) continue;
    normalizedGroups[groupJid] = normalizeSettings(settings);
  }

  return { groups: normalizedGroups };
}

export function getGroupSettingsState() {
  return normalizeState(getStorageSection(STORAGE_KEY, { groups: {} }));
}

export function setGroupSettingsState(state) {
  return setStorageSection(STORAGE_KEY, normalizeState(state));
}

export function getGroupSettings(groupJid) {
  const state = getGroupSettingsState();
  return {
    ...DEFAULT_GROUP_SETTINGS,
    ...(state.groups[groupJid] || {})
  };
}

export function patchGroupSettings(groupJid, patch = {}) {
  const state = getGroupSettingsState();
  state.groups[groupJid] = {
    ...getGroupSettings(groupJid),
    ...normalizeSettings(patch)
  };
  return setGroupSettingsState(state);
}

export function setGroupSetting(groupJid, key, value) {
  return patchGroupSettings(groupJid, { [key]: value });
}
