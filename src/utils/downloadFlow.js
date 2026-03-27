import fs from 'fs-extra';
import pendingActions from './pendingActions.js';

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

  if (size > mediaLimit) {
    await ctx._adapter.sendMedia(ctx.chatId, buffer, {
      type: 'document',
      mimetype,
      caption
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
  return sendVideoBuffer(ctx, buffer, { ...options, size: options.size ?? buffer.length });
}

export async function sendImageBuffer(ctx, buffer, options = {}) {
  await ctx._adapter.sendMedia(ctx.chatId, buffer, {
    type: 'image',
    mimetype: options.mimetype || 'image/jpeg',
    caption: options.caption
  });
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
    data: { ...data, choices },
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
