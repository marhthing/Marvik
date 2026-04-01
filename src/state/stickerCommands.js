import { getStorageSection, setStorageSection } from '../utils/storageStore.js';

const STORAGE_KEY = 'stickerCommands';

export function getStickerCommands() {
  return getStorageSection(STORAGE_KEY, {});
}

export function setStickerCommands(stickerCommands) {
  return setStorageSection(STORAGE_KEY, stickerCommands || {});
}
