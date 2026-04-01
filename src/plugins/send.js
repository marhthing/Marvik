import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { extractMessageText, getMessageContextInfo } from '../utils/messageUtils.js';
import { normalizeDigits, normalizeWhatsAppJid } from '../utils/whatsappJid.js';
import logger from '../utils/logger.js';

const SEND_TRIGGER_REGEX = /^(send|sed)$/i;
const pluginLogger = logger.child({ component: 'send' });

function isStatusRemoteJid(remoteJid = '') {
  return remoteJid === 'status@broadcast' || remoteJid.endsWith('@status') || remoteJid.endsWith('@broadcast');
}

function getOwnerConfigJid(ctx) {
  const rawOwner = ctx?.bot?.config?.ownerNumber || ctx?.platformAdapter?.config?.ownerNumber || process.env.OWNER_NUMBER || '';
  return normalizeWhatsAppJid(rawOwner);
}

function isOwnerStatusParticipant(participant, ownerJid) {
  const participantDigits = normalizeDigits(participant || '');
  const ownerDigits = normalizeDigits(ownerJid || '');
  if (participantDigits && ownerDigits) return participantDigits === ownerDigits;
  return normalizeWhatsAppJid(participant || '') === normalizeWhatsAppJid(ownerJid || '');
}

function getQuotedStatusPayload(ctx) {
  const contextInfo = getMessageContextInfo(ctx?.raw?.message);
  const quotedMessage = contextInfo?.quotedMessage;
  const remoteJid = contextInfo?.remoteJid || contextInfo?.remoteJID || 'status@broadcast';
  const participant = contextInfo?.participant || '';
  const stanzaId = contextInfo?.stanzaId || contextInfo?.stanzaID || contextInfo?.id || null;

  if (!quotedMessage || !stanzaId || !isStatusRemoteJid(remoteJid)) return null;

  const mediaType = quotedMessage.imageMessage
    ? 'image'
    : quotedMessage.videoMessage
      ? 'video'
      : quotedMessage.audioMessage
        ? 'audio'
        : quotedMessage.documentMessage
          ? 'document'
          : null;

  return {
    quotedMessage,
    remoteJid,
    participant,
    stanzaId,
    mediaType,
    caption: quotedMessage.imageMessage?.caption || quotedMessage.videoMessage?.caption || quotedMessage.documentMessage?.caption || '',
    text: extractMessageText(quotedMessage)
  };
}

export default {
  name: 'send',
  description: 'Send owner status to user when they reply with send',
  version: '2.0.0',
  author: 'Are Martins',

  async onMessage(ctx) {
    if (ctx.platform !== 'whatsapp' || !ctx.text) return;
    if (!SEND_TRIGGER_REGEX.test(ctx.text.trim())) return;

    const whatsappAdapter = ctx.bot?.getAdapter('whatsapp');
    if (!whatsappAdapter?.client) return;

    const ownerJid = getOwnerConfigJid(ctx);
    if (!ownerJid) return;

    const statusPayload = getQuotedStatusPayload(ctx);
    if (!statusPayload) return;
    if (!isOwnerStatusParticipant(statusPayload.participant, ownerJid)) return;

    try {
      if (statusPayload.mediaType) {
        const buffer = await downloadMediaMessage({
          key: {
            remoteJid: statusPayload.remoteJid,
            fromMe: false,
            id: statusPayload.stanzaId,
            participant: statusPayload.participant || ownerJid
          },
          message: statusPayload.quotedMessage
        }, 'buffer', {}, {
          logger: whatsappAdapter.baileysLogger,
          reuploadRequest: whatsappAdapter.client.updateMediaMessage
        });

        if (!buffer) {
          await ctx.reply('Failed to fetch that status media.');
          return;
        }

        await whatsappAdapter.client.sendMessage(ctx.chatId, {
          [statusPayload.mediaType]: buffer,
          ...(statusPayload.caption ? { caption: statusPayload.caption } : {})
        });
        return;
      }

      if (statusPayload.text) {
        await whatsappAdapter.client.sendMessage(ctx.chatId, { text: statusPayload.text });
      }
    } catch (error) {
      pluginLogger.error({
        chatId: ctx.chatId,
        senderId: ctx.senderId,
        messageId: ctx.messageId,
        statusId: statusPayload.stanzaId,
        error
      }, 'Failed to forward owner status');
      await ctx.reply('Failed to send that status.');
    }
  }
};

