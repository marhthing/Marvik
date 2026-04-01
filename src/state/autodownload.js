import { getStorageSection, setStorageSection } from '../utils/storageStore.js';

const STORAGE_KEY = 'autodownload';
const DEFAULT_CONFIG = {
  mode: 'off',
  includeJids: []
};

export function getAutodownloadConfig() {
  const config = getStorageSection(STORAGE_KEY, DEFAULT_CONFIG);
  return {
    mode: ['off', 'all', 'personal', 'group', 'include'].includes(config.mode) ? config.mode : 'off',
    includeJids: Array.isArray(config.includeJids)
      ? [...new Set(config.includeJids.map(jid => String(jid).trim().toLowerCase()).filter(Boolean))]
      : []
  };
}

export function setAutodownloadConfig(patch) {
  const current = getAutodownloadConfig();
  const next = {
    ...current,
    ...patch
  };

  next.includeJids = Array.isArray(next.includeJids)
    ? [...new Set(next.includeJids.map(jid => String(jid).trim().toLowerCase()).filter(Boolean))]
    : [];

  return setStorageSection(STORAGE_KEY, next);
}
