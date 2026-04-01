import { getStorageSection, patchStorageSection } from '../utils/storageStore.js';
import { normalizeDestinationConfig } from '../utils/destinationRouter.js';

const DEFAULT_CONFIG = { dest: 'owner', jid: null };

export function getSaveConfig() {
  return normalizeDestinationConfig(getStorageSection('save', DEFAULT_CONFIG), DEFAULT_CONFIG, { allowGroup: true });
}

export function setSaveConfig(newConfig) {
  const current = getSaveConfig();
  const next = normalizeDestinationConfig({ ...current, ...newConfig }, DEFAULT_CONFIG, { allowGroup: true });
  return patchStorageSection('save', next, DEFAULT_CONFIG);
}
