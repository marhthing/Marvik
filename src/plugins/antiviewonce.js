import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { getOwnerJid, getQuotedContextInfo, getQuotedMessageObject } from '../utils/messageUtils.js';
import { getAntiviewonceConfig, setAntiviewonceConfig } from '../state/antiviewonce.js';
import { getViewOnceBackup, saveViewOnceBackup } from '../state/viewOnceBackup.js';
import { applyDestinationCommand, resolveDestinationJid as resolveDestinationJidShared } from '../utils/destinationRouter.js';
import logger from '../utils/logger.js';

const pluginLogger = logger.child({ component: 'antiviewonce' });

// TEMP DEBUG: remove after anti-view-once detection is verified.
function logViewOnceDebug(stage, details = {}) {
  console.log('[antiviewonce-debug]', stage, details);
}

function resolveDestinationJid(ctx) {
  return resolveDestinationJidShared(ctx, getAntiviewonceConfig(), getOwnerJid(ctx) || ctx.chatId);
}

function unwrapViewOnceMessage(message = {}) {
  let current = message;

  while (current?.ephemeralMessage?.message) {
    current = current.ephemeralMessage.message;
  }

  const directViewOnce =
    current?.viewOnceMessage?.message ||
    current?.viewOnceMessageV2?.message ||
    current?.viewOnceMessageV3?.message ||
    current?.viewOnceMessageV2Extension?.message;

  if (directViewOnce) {
    return directViewOnce;
  }

  if (
    current?.imageMessage?.viewOnce ||
    current?.videoMessage?.viewOnce ||
    current?.audioMessage?.viewOnce
  ) {
    return current;
  }

  return current || null;
}

function hasViewOnceWrapper(message = {}) {
  let current = message;

  while (current?.ephemeralMessage?.message) {
    current = current.ephemeralMessage.message;
  }

  return Boolean(
    current?.viewOnceMessage ||
    current?.viewOnceMessageV2 ||
    current?.viewOnceMessageV3 ||
    current?.viewOnceMessageV2Extension ||
    current?.imageMessage?.viewOnce ||
    current?.videoMessage?.viewOnce ||
    current?.audioMessage?.viewOnce
  );
}

async function sendCapture(ctx, { buffer, mediaType, mimetype, caption = '' }) {
  const destJid = resolveDestinationJid(ctx);
  const shouldCaption = typeof caption === 'string' && caption.trim().length > 0;

  if (ctx.platform === 'whatsapp' && ctx.platformAdapter && typeof ctx.platformAdapter.sendMedia === 'function') {
    await ctx.platformAdapter.sendMedia(destJid, buffer, mediaType, {
      mimetype,
      ...(shouldCaption ? { caption: caption.trim() } : {})
    });
    return;
  }

  if (typeof ctx.reply === 'function') {
    await ctx.reply('', {
      files: [{
        name: `viewonce.${mediaType === 'image' ? 'jpg' : mediaType === 'video' ? 'mp4' : 'bin'}`,
        content: buffer
      }]
    });
  }
}

async function sendBackupCapture(ctx, backup, contextInfo = null) {
  return sendCapture(ctx, {
    buffer: backup.buffer,
    mediaType: backup.mediaType,
    mimetype: backup.mimetype,
    caption: backup.caption
  });
}

async function extractAndSend(ctx, quotedContent, contextInfo) {
  try {
    const viewOnceContent = unwrapViewOnceMessage(quotedContent);

    if (!viewOnceContent) {
      const backup = getViewOnceBackup(contextInfo?.stanzaId);
      if (backup) {
        await sendBackupCapture(ctx, backup, contextInfo);
      }
      return;
    }

    let contentType = null;
    let mediaType = null;

    if (viewOnceContent.imageMessage) {
      contentType = 'imageMessage';
      mediaType = 'image';
    } else if (viewOnceContent.videoMessage) {
      contentType = 'videoMessage';
      mediaType = 'video';
    } else if (viewOnceContent.audioMessage) {
      contentType = 'audioMessage';
      mediaType = 'audio';
    }

    if (!mediaType) return;

    const mockMessage = {
      key: ctx.raw.key,
      message: {
        [contentType]: viewOnceContent[contentType]
      }
    };

    let buffer;
    if (ctx.platformAdapter && typeof ctx.platformAdapter.downloadMedia === 'function') {
      buffer = await ctx.platformAdapter.downloadMedia({ raw: mockMessage });
    } else if (typeof downloadMediaMessage === 'function') {
      buffer = await downloadMediaMessage(
        mockMessage,
        'buffer',
        {},
        {
          logger: ctx.platformAdapter?.baileysLogger,
          reuploadRequest: ctx.platformAdapter?.client?.updateMediaMessage
        }
      );
    } else {
      throw new Error('No downloadMedia method available');
    }

    if (!buffer || buffer.length === 0) {
      const backup = getViewOnceBackup(contextInfo?.stanzaId);
      if (backup) {
        await sendBackupCapture(ctx, backup, contextInfo);
      }
      return;
    }

    const senderId = contextInfo?.participant || ctx.senderId;
    const mediaData = viewOnceContent[contentType];
    const caption = mediaData?.caption || '';
    const mimetype = mediaData?.mimetype || 'application/octet-stream';
    const backupId = contextInfo?.stanzaId || ctx.quoted?.messageId || ctx.messageId;

    saveViewOnceBackup({
      messageId: backupId,
      chatId: ctx.chatId,
      senderId,
      mediaType,
      mimetype,
      caption,
      key: contextInfo ? {
        id: contextInfo.stanzaId,
        participant: contextInfo.participant,
        remoteJid: contextInfo.remoteJid || ctx.chatId
      } : null,
      buffer
    });

    await sendCapture(ctx, {
      buffer,
      mediaType,
      mimetype,
      caption
    });
  } catch (error) {
    pluginLogger.error({ error }, 'Extract failed');
  }
}

const AntiViewOncePlugin = {
  name: 'antiviewonce',
  description: 'Automatically captures view-once messages',
  category: 'privacy',
  commands: [
    {
      name: 'vv',
      description: 'Manually extract view-once from reply or set destination',
      usage: '.vv (reply to a view-once message) | .vv <jid|g|p>',
      category: 'privacy',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 3,
      async execute(ctx) {
        const arg = ctx.args[0]?.toLowerCase();
        if (arg && !ctx.quoted) {
          const response = applyDestinationCommand(arg, setAntiviewonceConfig, {
            group: 'AntiViewOnce will now send captures to the same chat.',
            owner: 'AntiViewOnce will now send captures to the owner.',
            custom: 'AntiViewOnce will now send captures to JID: %s'
          });
          if (response) {
            await ctx.reply(response);
            return;
          }
          await ctx.reply('Invalid argument. Usage: .vv <jid|g|p> or reply to a view-once message.');
          return;
        }

        if (!arg && !ctx.quoted) {
          const conf = getAntiviewonceConfig();
          await ctx.reply(`AntiViewOnce destination: ${conf.dest}${conf.jid ? `\nJID: ${conf.jid}` : ''}`);
          return;
        }

        try {
          const quotedMessage = getQuotedMessageObject(ctx);
          const contextInfo = getQuotedContextInfo(ctx);
          const backupId = contextInfo?.stanzaId || ctx.quoted?.messageId;

          if (!quotedMessage) {
            const backup = getViewOnceBackup(backupId);
            if (!backup) {
              await ctx.reply('❌ Please reply to a view-once message with .vv');
              return;
            }
            await sendBackupCapture(ctx, backup, contextInfo);
            return;
          }

          await extractAndSend(ctx, quotedMessage, contextInfo);
        } catch (error) {
          pluginLogger.error({ error }, '.vv command failed');
          await ctx.reply('❌ Failed to extract view-once content.');
        }
      }
    }
  ],
  onLoad: async (bot) => {
    pluginLogger.info('Plugin loaded');
    const adapter = bot.getAdapter('whatsapp');
    if (!adapter) return;

    bot.on('message', async (ctx) => {
      if (ctx.platform !== 'whatsapp') return;

      const msg = ctx.raw;
      logViewOnceDebug('message-received', {
        chatId: ctx.chatId,
        messageId: ctx.messageId,
        hasViewOnceMessage: Boolean(msg?.message?.viewOnceMessage),
        hasViewOnceMessageV2: Boolean(msg?.message?.viewOnceMessageV2),
        hasViewOnceMessageV3: Boolean(msg?.message?.viewOnceMessageV3),
        hasViewOnceMessageV2Extension: Boolean(msg?.message?.viewOnceMessageV2Extension),
        hasEphemeralMessage: Boolean(msg?.message?.ephemeralMessage),
        hasDirectImageViewOnce: Boolean(msg?.message?.imageMessage?.viewOnce),
        hasDirectVideoViewOnce: Boolean(msg?.message?.videoMessage?.viewOnce),
        hasDirectAudioViewOnce: Boolean(msg?.message?.audioMessage?.viewOnce),
        detectedWrapper: hasViewOnceWrapper(msg?.message)
      });

      if (hasViewOnceWrapper(msg.message)) {
        logViewOnceDebug('view-once-detected', {
          chatId: ctx.chatId,
          messageId: ctx.messageId
        });
        pluginLogger.debug({ chatId: ctx.chatId, messageId: ctx.messageId }, 'View-once detected');
        const quotedMessage = unwrapViewOnceMessage(msg.message);

        if (quotedMessage) {
          logViewOnceDebug('view-once-unwrapped', {
            messageId: ctx.messageId,
            keys: Object.keys(quotedMessage || {})
          });
          await extractAndSend(ctx, quotedMessage, msg.messageContextInfo || msg.contextInfo);
        } else {
          logViewOnceDebug('view-once-unwrapped-empty', {
            messageId: ctx.messageId
          });
        }
      }
    });
  }
};

export default AntiViewOncePlugin;
