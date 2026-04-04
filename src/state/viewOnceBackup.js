import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getStorageSection, setStorageSection } from '../utils/storageStore.js';

const STORAGE_KEY = 'viewOnceBackup';
const DEFAULT_STATE = { items: {} };
const BACKUP_DIR = path.join(process.cwd(), 'storage', 'viewonce');
const ENCRYPTION_ALGO = 'aes-256-gcm';
const ENCRYPTION_VERSION = 1;

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

function getEncryptionKey() {
  const configuredKey = String(process.env.STORAGE_BACKUP_KEY || process.env.VIEWONCE_BACKUP_KEY || '').trim();
  const fallbackSeed = `viewonce:${String(process.env.OWNER_NUMBER || '').trim()}:${process.cwd()}`;
  const material = configuredKey || fallbackSeed;
  return crypto.createHash('sha256').update(material).digest();
}

function encryptBuffer(buffer) {
  const iv = crypto.randomBytes(12);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return JSON.stringify({
    version: ENCRYPTION_VERSION,
    algo: ENCRYPTION_ALGO,
    iv: iv.toString('base64'),
    tag: authTag.toString('base64'),
    data: encrypted.toString('base64')
  });
}

function decryptBuffer(payload) {
  const parsed = JSON.parse(String(payload || '{}'));
  if (parsed.version !== ENCRYPTION_VERSION || parsed.algo !== ENCRYPTION_ALGO) {
    throw new Error('Unsupported encrypted view-once backup format.');
  }

  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGO,
    key,
    Buffer.from(parsed.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(parsed.data, 'base64')),
    decipher.final()
  ]);
}

function makeBackupPath(messageId) {
  ensureBackupDir();
  const safeId = String(messageId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(BACKUP_DIR, `${safeId}.vob`);
}

function persistEntry(state, entry, buffer) {
  const filePath = makeBackupPath(entry.messageId);
  fs.writeFileSync(filePath, encryptBuffer(buffer), 'utf8');
  state.items[String(entry.messageId)] = {
    ...entry,
    filePath,
    encrypted: true,
    savedAt: Date.now()
  };
  saveState(state);
  return state.items[String(entry.messageId)];
}

function migrateLegacyEntry(state, entry) {
  if (!entry?.filePath || !fs.existsSync(entry.filePath)) return null;
  const buffer = fs.readFileSync(entry.filePath);
  const migrated = persistEntry(state, {
    ...entry,
    messageId: String(entry.messageId),
    chatId: entry.chatId || null,
    senderId: entry.senderId || null,
    mediaType: entry.mediaType || 'document',
    mimetype: entry.mimetype || 'application/octet-stream',
    caption: entry.caption || '',
    key: entry.key || null
  }, buffer);

  if (entry.filePath !== migrated.filePath) {
    fs.unlinkSync(entry.filePath);
  }

  return {
    ...migrated,
    buffer
  };
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

  const state = getState();
  return persistEntry(state, {
    messageId: String(messageId),
    chatId: chatId || null,
    senderId: senderId || null,
    mediaType: mediaType || 'document',
    mimetype: mimetype || 'application/octet-stream',
    caption: caption || '',
    key: key || null
  }, buffer);
}

export function getViewOnceBackup(messageId) {
  if (!messageId) return null;
  const state = getState();
  const entry = state.items[String(messageId)];
  if (!entry?.filePath || !fs.existsSync(entry.filePath)) {
    return null;
  }

  if (!entry.encrypted) {
    return migrateLegacyEntry(state, entry);
  }

  return {
    ...entry,
    buffer: decryptBuffer(fs.readFileSync(entry.filePath, 'utf8'))
  };
}
