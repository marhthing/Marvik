import { getStorageSection, patchStorageSection } from '../utils/storageStore.js';
import { normalizeDestinationConfig } from '../utils/destinationRouter.js';

const DEFAULT_CONFIG = { dest: 'owner', jid: null };

export function getAntiviewonceConfig() {
  return normalizeDestinationConfig(getStorageSection('antiviewonce', DEFAULT_CONFIG));
}

export function setAntiviewonceConfig(newConfig) {
  return patchStorageSection('antiviewonce', newConfig, DEFAULT_CONFIG);
}
