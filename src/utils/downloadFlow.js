import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import pendingActions from './pendingActions.js';

const execFileAsync = promisify(execFile);
const FFMPEG_PATH = ffmpegInstaller.path;
const FFPROBE_PATH = path.join(
  path.dirname(FFMPEG_PATH),
  process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
);

export function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / Math.pow(1024, unitIndex);
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

export async function sendVideoBuffer(ctx, buffer, options = {}) {
  const {
    caption,
    mimetype = 'video/mp4',
    sizeLimit = 100 * 1024 * 1024,
    mediaLimit = 30 * 1024 * 1024,
    limitLabel = '100MB'
  } = options;
  const size = options.size ?? buffer.length;

  if (size > sizeLimit) {
    throw new Error(`Video too large (${formatFileSize(size)}). Limit is ${limitLabel}.`);
  }

  const shouldSendAsDocument = size > mediaLimit || mimetype !== 'video/mp4';

  if (shouldSendAsDocument) {
    await ctx._adapter.sendMedia(ctx.chatId, buffer, {
      type: 'document',
      mimetype,
      caption,
      fileName: options.fileName
    });
    return;
  }

  await ctx._adapter.sendMedia(ctx.chatId, buffer, {
    type: 'video',
    mimetype,
    caption
  });
}

export async function sendVideoFile(ctx, filePath, options = {}) {
  const buffer = await fs.readFile(filePath);
  return sendVideoBuffer(ctx, buffer, {
    ...options,
    size: options.size ?? buffer.length,
    fileName: options.fileName || path.basename(filePath)
  });
}

export async function sendImageBuffer(ctx, buffer, options = {}) {
  await ctx._adapter.sendMedia(ctx.chatId, buffer, {
    type: 'image',
    mimetype: options.mimetype || 'image/jpeg',
    caption: options.caption
  });
}

export async function validateVideoFile(filePath, options = {}) {
  const { minSize = 1024, probeSeconds = 5, timeoutMs = 120000 } = options;
  const stats = await fs.stat(filePath);

  if (!stats.isFile() || stats.size < minSize) {
    throw new Error('Downloaded video is too small or invalid.');
  }

  if (await fs.pathExists(FFPROBE_PATH)) {
    const { stdout } = await execFileAsync(FFPROBE_PATH, [
      '-v', 'error',
      '-show_entries', 'stream=codec_type',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ], {
      timeout: timeoutMs,
      windowsHide: true
    });

    if (!String(stdout || '').split(/\r?\n/).some((line) => line.trim() === 'video')) {
      throw new Error('Downloaded file does not contain a valid video stream.');
    }
  }

  await execFileAsync(FFMPEG_PATH, [
    '-v', 'error',
    '-xerror',
    '-t', String(probeSeconds),
    '-i', filePath,
    '-f', 'null',
    '-'
  ], {
    timeout: timeoutMs,
    windowsHide: true
  });

  return stats.size;
}

export async function validateVideoBuffer(buffer, options = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matbot-video-'));
  const extension = options.extension || 'mp4';
  const tempPath = path.join(tempDir, `probe.${extension}`);

  try {
    await fs.writeFile(tempPath, buffer);
    return await validateVideoFile(tempPath, options);
  } finally {
    await fs.remove(tempDir).catch(() => {});
  }
}

export async function filterValidChoices(choices, validator) {
  const validChoices = [];

  for (const choice of choices) {
    try {
      if (await validator(choice)) validChoices.push(choice);
    } catch {}
  }

  return validChoices;
}

export async function withDelayedNotice(ctx, task, options = {}) {
  const {
    delayMs = 2 * 60 * 1000,
    message = 'Your download is still in progress, please be patience.'
  } = options;

  let settled = false;
  const timer = setTimeout(async () => {
    if (settled || !ctx?.reply) return;
    try {
      await ctx.reply(message);
    } catch {}
  }, delayMs);

  try {
    return await task();
  } finally {
    settled = true;
    clearTimeout(timer);
  }
}

export function getChoiceFallbackOrder(choices, selectedIndex) {
  return choices
    .map((choice, index) => ({
      choice,
      index,
      distance: Math.abs(index - selectedIndex)
    }))
    .sort((a, b) => (
      a.distance - b.distance ||
      b.index - a.index
    ));
}

export async function attemptChoiceWithFallback(options) {
  const {
    choices,
    selectedIndex,
    attempt
  } = options;

  const orderedChoices = getChoiceFallbackOrder(choices, selectedIndex);
  let lastError = null;

  for (const entry of orderedChoices) {
    try {
      return await attempt(entry.choice, entry.index, entry.index !== selectedIndex);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('All quality options failed.');
}

export async function promptNumericSelection(ctx, options) {
  const {
    type,
    prompt,
    choices,
    userId = ctx.senderId,
    timeout = 10 * 60 * 1000,
    data = {},
    handler
  } = options;

  const sentMsg = await ctx.reply(prompt);

  pendingActions.set(ctx.chatId, sentMsg.key.id, {
    type,
    userId,
    data: {
      ...data,
      choices,
      originChatId: ctx.chatId,
      originMessageKey: ctx.messageKey || ctx.messageId || ctx.raw?.key
    },
    match: (text) => {
      if (typeof text !== 'string') return false;
      const choice = parseInt(text.trim(), 10);
      return choice >= 1 && choice <= choices.length;
    },
    handler: async (replyCtx, pending) => {
      const choice = parseInt(replyCtx.text.trim(), 10);
      return handler(replyCtx, pending.data.choices[choice - 1], choice, pending);
    },
    timeout
  });

  return sentMsg;
}

export async function reactPendingOrigin(replyCtx, pending, emoji) {
  const originChatId = pending?.data?.originChatId;
  const originMessageKey = pending?.data?.originMessageKey;
  if (!originChatId || !originMessageKey || !replyCtx?._adapter?.sendReaction) return false;
  try {
    await replyCtx._adapter.sendReaction(originChatId, originMessageKey, emoji);
    return true;
  } catch {
    return false;
  }
}
