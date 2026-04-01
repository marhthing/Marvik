import fs from 'fs';
import path from 'path';

export const STORAGE_PATH = path.resolve(process.cwd(), 'storage', 'storage.json');
const STORAGE_BACKUP_PATH = `${STORAGE_PATH}.bak`;

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeJsonAtomic(filePath, data) {
  ensureParentDir(filePath);
  const serialized = JSON.stringify(data, null, 2);
  const tempPath = `${filePath}.tmp`;

  fs.writeFileSync(tempPath, serialized, 'utf8');

  if (fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, `${filePath}.bak`);
  }

  fs.renameSync(tempPath, filePath);
}

export function readJson(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw.replace(/^\/\/.*$/mg, ''));
  } catch {
    const backupPath = `${filePath}.bak`;
    try {
      if (!fs.existsSync(backupPath)) return fallback;
      const backupRaw = fs.readFileSync(backupPath, 'utf8');
      return JSON.parse(backupRaw.replace(/^\/\/.*$/mg, ''));
    } catch {
      return fallback;
    }
  }
}

export function readStorage() {
  return readJson(STORAGE_PATH, {});
}

export function writeJson(filePath, data) {
  writeJsonAtomic(filePath, data);
}

export function writeStorage(data) {
  writeJson(STORAGE_PATH, data);
}

export function getStorageSection(section, defaults = {}) {
  const storage = readStorage();
  const current = storage[section];
  if (current && typeof current === 'object' && !Array.isArray(current)) {
    return { ...defaults, ...current };
  }
  return current ?? defaults;
}

export function setStorageSection(section, value) {
  const storage = readStorage();
  storage[section] = value;
  writeStorage(storage);
  return storage[section];
}

export function patchStorageSection(section, patch, defaults = {}) {
  const next = { ...getStorageSection(section, defaults), ...patch };
  return setStorageSection(section, next);
}

export function getStorageBackupPath() {
  return STORAGE_BACKUP_PATH;
}
