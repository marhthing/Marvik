// In-memory message store with disk backing for recovery features.
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';
import { readEncryptedBuffer, readEncryptedJson, writeEncryptedBuffer, writeEncryptedJson } from '../utils/secureDiskStore.js';

const STORAGE_DIR = path.join(process.cwd(), 'storage', 'messages');
const MEDIA_DIR = path.join(process.cwd(), 'storage', 'media');
const memoryLogger = logger.child({ component: 'memory' });

class MemoryStore {
  constructor() {
    this.messages = {};
    this.mediaDownloader = null;
    this.writeQueue = [];
    this.isProcessingWrites = false;
    if (!fs.existsSync(STORAGE_DIR)) {
      fs.mkdirSync(STORAGE_DIR, { recursive: true });
    }
    if (!fs.existsSync(MEDIA_DIR)) {
      fs.mkdirSync(MEDIA_DIR, { recursive: true });
    }
  }

  setMediaDownloader(downloaderFn) {
    this.mediaDownloader = downloaderFn;
  }

  enqueueWrite(task) {
    return new Promise((resolve, reject) => {
      this.writeQueue.push({ task, resolve, reject });
      this.processWriteQueue().catch(() => {});
    });
  }

  async processWriteQueue() {
    if (this.isProcessingWrites) return;
    this.isProcessingWrites = true;

    try {
      while (this.writeQueue.length > 0) {
        const job = this.writeQueue.shift();
        try {
          const result = await job.task();
          job.resolve(result);
        } catch (error) {
          job.reject(error);
        }
      }
    } finally {
      this.isProcessingWrites = false;
      if (this.writeQueue.length > 0) {
        this.processWriteQueue().catch(() => {});
      }
    }
  }

  async flushWrites(timeoutMs = 10000) {
    const startedAt = Date.now();
    while (this.isProcessingWrites || this.writeQueue.length > 0) {
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for memory store writes to flush after ${timeoutMs}ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  saveMessage(platform, chatId, messageId, messageData) {
    if (!this.messages[platform]) this.messages[platform] = {};
    if (!this.messages[platform][chatId]) this.messages[platform][chatId] = {};

    const isRealMessage = messageData.message && !messageData.message.protocolMessage;
    if (isRealMessage) {
      const timestamp = Date.now();
      const extendedData = { ...messageData, _savedAt: timestamp };
      this.messages[platform][chatId][messageId] = extendedData;
      this.saveToDisk(platform, chatId, messageId, extendedData).catch(() => {});
    }
  }

  async saveToDisk(platform, chatId, messageId, data) {
    return this.enqueueWrite(async () => {
      const platformDir = path.join(STORAGE_DIR, platform);
      const safeChatId = chatId.replace(/[^a-zA-Z0-9]/g, '_');
      const chatDir = path.join(platformDir, safeChatId);

      await fsp.mkdir(chatDir, { recursive: true });

      const filePath = path.join(chatDir, `${messageId}.json`);
      writeEncryptedJson(filePath, data);
      return filePath;
    });
  }

  async saveMediaToDisk(platform, chatId, messageId, buffer, extension = 'bin') {
    try {
      return await this.enqueueWrite(async () => {
        const safeChatId = chatId.replace(/[^a-zA-Z0-9]/g, '_');
        const mediaDir = path.join(MEDIA_DIR, platform, safeChatId);

        await fsp.mkdir(mediaDir, { recursive: true });

        const mediaPath = path.join(mediaDir, `${messageId}.${extension}`);
        writeEncryptedBuffer(mediaPath, buffer);
        return mediaPath;
      });
    } catch (err) {
      memoryLogger.error({ error: err }, 'Failed to save media');
      return null;
    }
  }

  getMediaFromDisk(platform, chatId, messageId) {
    try {
      const safeChatId = chatId.replace(/[^a-zA-Z0-9]/g, '_');
      const mediaDir = path.join(MEDIA_DIR, platform, safeChatId);
      if (!fs.existsSync(mediaDir)) return null;

      const files = fs.readdirSync(mediaDir);
      const mediaFile = files.find(f => f.startsWith(messageId + '.'));
      if (mediaFile) {
        const mediaPath = path.join(mediaDir, mediaFile);
        return readEncryptedBuffer(mediaPath);
      }
    } catch {}
    return null;
  }

  getMessage(platform, chatId, messageId) {
    const platformStore = this.messages[platform];
    let msg = platformStore?.[chatId]?.[messageId];

    if (!msg) {
      try {
        const safeChatId = chatId.replace(/[^a-zA-Z0-9]/g, '_');
        const filePath = path.join(STORAGE_DIR, platform, safeChatId, `${messageId}.json`);
        if (fs.existsSync(filePath)) {
          msg = readEncryptedJson(filePath, null);
          if (!this.messages[platform]) this.messages[platform] = {};
          if (!this.messages[platform][chatId]) this.messages[platform][chatId] = {};
          this.messages[platform][chatId][messageId] = msg;
        }
      } catch {}
    }

    return msg || null;
  }

  getAllMessages(platform, chatId) {
    return this.messages[platform]?.[chatId] || {};
  }

  getLatestMessage(platform, chatId) {
    const chatStore = this.messages[platform]?.[chatId];
    if (!chatStore) return null;
    const entries = Object.values(chatStore);
    if (entries.length === 0) return null;
    return entries.sort((a, b) => (b.messageTimestamp || 0) - (a.messageTimestamp || 0))[0];
  }

  deleteMessage(platform, chatId, messageId) {
    if (this.messages[platform]?.[chatId]) {
      delete this.messages[platform][chatId][messageId];
    }
  }

  _getMediaInfo(msg) {
    const actualMsg = msg?.message?.viewOnceMessage?.message ||
                      msg?.message?.viewOnceMessageV2?.message ||
                      msg?.message?.ephemeralMessage?.message ||
                      msg?.message;

    if (!actualMsg) return null;

    const mediaTypes = {
      imageMessage: 'jpg',
      videoMessage: 'mp4',
      audioMessage: 'mp3',
      documentMessage: 'bin',
      stickerMessage: 'webp',
      pttMessage: 'ogg'
    };

    for (const [type, ext] of Object.entries(mediaTypes)) {
      if (actualMsg[type]) {
        return { type, extension: actualMsg[type].mimetype?.split('/')[1] || ext };
      }
    }
    return null;
  }

  async smartCleanup({ minFreeMB = 200, minFreePercent = 15 } = {}) {
    const now = Date.now();
    const MS_PER_DAY = 24 * 60 * 60 * 1000;

    let freeMB;
    let freePercent;
    try {
      const os = await import('os');
      const getContainerMemoryLocal = () => {
        try {
          const memMax = '/sys/fs/cgroup/memory.max';
          const memCurrent = '/sys/fs/cgroup/memory.current';
          if (fs.existsSync(memMax)) {
            const maxRaw = fs.readFileSync(memMax, 'utf8').trim();
            const currentRaw = fs.readFileSync(memCurrent, 'utf8').trim();
            const total = maxRaw === 'max' ? os.totalmem() : parseInt(maxRaw);
            return { total, used: parseInt(currentRaw) };
          }
          const memLimit = '/sys/fs/cgroup/memory/memory.limit_in_bytes';
          const memUsage = '/sys/fs/cgroup/memory/memory.usage_in_bytes';
          if (fs.existsSync(memLimit)) {
            const limit = parseInt(fs.readFileSync(memLimit, 'utf8').trim());
            const usage = parseInt(fs.readFileSync(memUsage, 'utf8').trim());
            const total = limit > 100 * 1024 * 1024 * 1024 ? os.totalmem() : limit;
            return { total, used: usage };
          }
        } catch {}
        return { total: os.totalmem(), used: os.totalmem() - os.freemem() };
      };

      const containerMem = getContainerMemoryLocal();
      const freeMem = containerMem.total - containerMem.used;
      freeMB = freeMem / 1024 / 1024;
      freePercent = (freeMem / containerMem.total) * 100;
    } catch {
      const os = await import('os');
      const freeMem = os.default.freemem();
      const totalMem = os.default.totalmem();
      freeMB = freeMem / 1024 / 1024;
      freePercent = (freeMem / totalMem) * 100;
    }

    const isLowMemory = freeMB < minFreeMB || freePercent < minFreePercent;
    let prunedMem = 0;
    let prunedDisk = 0;
    let mediaSaved = 0;

    for (const platform of Object.keys(this.messages)) {
      for (const chatId of Object.keys(this.messages[platform])) {
        const isStatus = chatId.endsWith('@status') || chatId.endsWith('@broadcast');
        const retentionPeriod = isStatus ? MS_PER_DAY : 3 * MS_PER_DAY;

        const messages = Object.entries(this.messages[platform][chatId])
          .map(([id, msg]) => ({ id, ...msg }))
          .sort((a, b) => (b._savedAt || 0) - (a._savedAt || 0));

        for (let index = 0; index < messages.length; index++) {
          const msg = messages[index];
          const age = now - (msg._savedAt || now);

          if (age > retentionPeriod) {
            delete this.messages[platform][chatId][msg.id];
            prunedMem++;
            continue;
          }

          if (isLowMemory && index > 100) {
            const mediaInfo = this._getMediaInfo(msg);
            if (mediaInfo && this.mediaDownloader && !msg._mediaSaved) {
              try {
                const buffer = await this.mediaDownloader(msg);
                if (buffer) {
                  const savedPath = await this.saveMediaToDisk(platform, chatId, msg.id, buffer, mediaInfo.extension);
                  if (savedPath) {
                    msg._mediaSaved = true;
                    msg._mediaPath = savedPath;
                    this.saveToDisk(platform, chatId, msg.id, msg);
                    mediaSaved++;
                  }
                }
              } catch {}
            }

            delete this.messages[platform][chatId][msg.id];
            prunedMem++;
          }
        }
      }
    }

    const cleanDir = (dir, isMediaDir = false) => {
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stats = fs.statSync(fullPath);
        if (stats.isDirectory()) {
          cleanDir(fullPath, isMediaDir);
          if (fs.readdirSync(fullPath).length === 0) fs.rmdirSync(fullPath);
        } else if (file.endsWith('.json') || isMediaDir) {
          const isStatus = dir.includes('_status') || dir.includes('_broadcast');
          const retentionPeriod = isStatus ? MS_PER_DAY : 3 * MS_PER_DAY;
          if (now - stats.mtimeMs > retentionPeriod) {
            fs.unlinkSync(fullPath);
            prunedDisk++;
          }
        }
      }
    };

    cleanDir(STORAGE_DIR);
    cleanDir(MEDIA_DIR, true);

    if (prunedMem > 0 || prunedDisk > 0 || mediaSaved > 0) {
      memoryLogger.debug({
        prunedMem,
        prunedDisk,
        mediaSaved,
        freeMB: Number(freeMB.toFixed(2)),
        freePercent: Number(freePercent.toFixed(2))
      }, 'Cleanup completed');
    }
  }
}

const memoryStore = new MemoryStore();

setInterval(() => {
  memoryStore.smartCleanup().catch(() => {});
}, 600000);

export default memoryStore;
