import { getQuotedContextInfo, getQuotedMessageObject } from './messageUtils.js';

function reconstructQuotedRawMessage(ctx, messageType, messagePayload) {
  const contextInfo = getQuotedContextInfo(ctx);
  if (!contextInfo || !messagePayload) return null;
  return {
    key: {
      remoteJid: ctx.chatId,
      id: contextInfo.stanzaId,
      participant: contextInfo.participant,
      fromMe: false
    },
    message: {
      [messageType]: messagePayload
    }
  };
}

export function getQuotedMediaTarget(ctx, allowedTypes = []) {
  const allowed = new Set(allowedTypes);

  if (ctx.quoted?.media && allowed.has(ctx.quoted.media.type)) {
    return {
      type: ctx.quoted.media.type,
      raw: ctx.quoted.media.raw || ctx.quoted.raw || ctx.quoted.messageKey || null,
      media: ctx.quoted.media
    };
  }

  if (ctx.media && allowed.has(ctx.media.type)) {
    return {
      type: ctx.media.type,
      raw: ctx.raw,
      media: ctx.media
    };
  }

  const quotedMessage = getQuotedMessageObject(ctx);
  if (!quotedMessage) return null;

  const candidates = [
    ['image', 'imageMessage'],
    ['video', 'videoMessage'],
    ['gif', 'videoMessage'],
    ['audio', 'audioMessage'],
    ['sticker', 'stickerMessage'],
    ['document', 'documentMessage']
  ];

  for (const [type, messageType] of candidates) {
    if (!allowed.has(type)) continue;
    const payload = quotedMessage[messageType];
    if (!payload) continue;
    if (type === 'gif' && !quotedMessage.videoMessage?.gifPlayback) continue;
    return {
      type,
      raw: reconstructQuotedRawMessage(ctx, messageType, payload),
      media: payload
    };
  }

  return null;
}

export function getQuotedStickerTarget(ctx) {
  return getQuotedMediaTarget(ctx, ['sticker']);
}
