import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ENCRYPTION_ALGO = 'aes-256-gcm';
const ENCRYPTION_VERSION = 1;

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getEncryptionKey() {
  const configuredKey = String(process.env.STORAGE_BACKUP_KEY || '').trim();
  const fallbackSeed = `storage:${String(process.env.OWNER_NUMBER || '').trim()}:${process.cwd()}`;
  const material = configuredKey || fallbackSeed;
  return crypto.createHash('sha256').update(material).digest();
}

function encryptBuffer(buffer) {
  const iv = crypto.randomBytes(12);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.from(JSON.stringify({
    __encryptedFileStore: true,
    version: ENCRYPTION_VERSION,
    algo: ENCRYPTION_ALGO,
    iv: iv.toString('base64'),
    tag: authTag.toString('base64'),
    data: encrypted.toString('base64')
  }), 'utf8');
}

function tryParseEnvelope(buffer) {
  try {
    const parsed = JSON.parse(buffer.toString('utf8'));
    return parsed?.__encryptedFileStore ? parsed : null;
  } catch {
    return null;
  }
}

function decryptEnvelope(envelope) {
  if (envelope.version !== ENCRYPTION_VERSION || envelope.algo !== ENCRYPTION_ALGO) {
    throw new Error('Unsupported encrypted file-store format.');
  }

  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGO,
    key,
    Buffer.from(envelope.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final()
  ]);
}

export function writeEncryptedBuffer(filePath, buffer) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, encryptBuffer(Buffer.from(buffer)));
  return filePath;
}

export function readEncryptedBuffer(filePath, options = {}) {
  const { migrateLegacy = true } = options;
  const raw = fs.readFileSync(filePath);
  const envelope = tryParseEnvelope(raw);
  if (envelope) {
    return decryptEnvelope(envelope);
  }

  if (migrateLegacy) {
    writeEncryptedBuffer(filePath, raw);
  }

  return raw;
}

export function writeEncryptedJson(filePath, value) {
  const serialized = Buffer.from(JSON.stringify(value), 'utf8');
  return writeEncryptedBuffer(filePath, serialized);
}

export function readEncryptedJson(filePath, fallback = null, options = {}) {
  const { migrateLegacy = true } = options;

  try {
    const raw = fs.readFileSync(filePath);
    const envelope = tryParseEnvelope(raw);
    if (envelope) {
      return JSON.parse(decryptEnvelope(envelope).toString('utf8'));
    }

    const parsed = JSON.parse(raw.toString('utf8'));
    if (migrateLegacy) {
      writeEncryptedJson(filePath, parsed);
    }
    return parsed;
  } catch {
    return fallback;
  }
}
