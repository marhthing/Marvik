import { getStorageSection, patchStorageSection } from '../utils/storageStore.js';
import { normalizeDestinationConfig } from '../utils/destinationRouter.js';

const DEFAULT_CONFIG = { dest: 'owner', jid: null };

export function getAntiviewonceConfig() {
  return normalizeDestinationConfig(getStorageSection('antiviewonce', DEFAULT_CONFIG), DEFAULT_CONFIG, { allowGroup: true });
}

export function setAntiviewonceConfig(newConfig) {
  const current = getAntiviewonceConfig();
  const next = normalizeDestinationConfig({ ...current, ...newConfig }, DEFAULT_CONFIG, { allowGroup: true });
  return patchStorageSection('antiviewonce', next, DEFAULT_CONFIG);
}
