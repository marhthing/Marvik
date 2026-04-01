import fs from 'fs';
import path from 'path';
import { getStorageSection, setStorageSection } from '../utils/storageStore.js';

const STORAGE_KEY = 'viewOnceBackup';
const DEFAULT_STATE = { items: {} };
const BACKUP_DIR = path.join(process.cwd(), 'storage', 'viewonce');

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function getState() {
  const state = getStorageSection(STORAGE_KEY, DEFAULT_STATE);
  return {
    items: state.items && typeof state.items === 'object' ? state.items : {}
  };
}

function saveState(state) {
  setStorageSection(STORAGE_KEY, state);
}

function makeBackupPath(messageId, extension = 'bin') {
  ensureBackupDir();
  const safeId = String(messageId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeExt = String(extension || 'bin').replace(/[^a-z0-9]/gi, '') || 'bin';
  return path.join(BACKUP_DIR, `${safeId}.${safeExt}`);
}

export function saveViewOnceBackup({
  messageId,
  chatId,
  senderId,
  mediaType,
  mimetype,
  caption,
  key,
  buffer
}) {
  if (!messageId || !buffer?.length) return null;

  const extension = mimetype?.split('/')[1] || (mediaType === 'image' ? 'jpg' : mediaType === 'video' ? 'mp4' : 'bin');
  const filePath = makeBackupPath(messageId, extension);
  fs.writeFileSync(filePath, buffer);

  const state = getState();
  state.items[String(messageId)] = {
    messageId: String(messageId),
    chatId: chatId || null,
    senderId: senderId || null,
    mediaType: mediaType || 'document',
    mimetype: mimetype || 'application/octet-stream',
    caption: caption || '',
    filePath,
    key: key || null,
    savedAt: Date.now()
  };
  saveState(state);
  return state.items[String(messageId)];
}

export function getViewOnceBackup(messageId) {
  if (!messageId) return null;
  const entry = getState().items[String(messageId)];
  if (!entry?.filePath || !fs.existsSync(entry.filePath)) {
    return null;
  }
  return {
    ...entry,
    buffer: fs.readFileSync(entry.filePath)
  };
}
