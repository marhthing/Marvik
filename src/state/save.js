import { getStorageSection, patchStorageSection } from '../utils/storageStore.js';
import { normalizeDestinationConfig } from '../utils/destinationRouter.js';

const DEFAULT_CONFIG = { dest: 'owner', jid: null };

export function getSaveConfig() {
  return normalizeDestinationConfig(getStorageSection('save', DEFAULT_CONFIG));
}

export function setSaveConfig(newConfig) {
  return patchStorageSection('save', newConfig, DEFAULT_CONFIG);
}
