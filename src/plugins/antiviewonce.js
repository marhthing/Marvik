import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { getOwnerJid, getQuotedContextInfo, getQuotedMessageObject } from '../utils/messageUtils.js';
import { getStorageSection, patchStorageSection } from '../utils/storageStore.js';
import { getViewOnceBackup, saveViewOnceBackup } from '../utils/viewOnceBackup.js';
import { applyDestinationCommand, normalizeDestinationConfig, resolveDestinationJid as resolveDestinationJidShared } from '../utils/destinationRouter.js';

function getAntiviewonceConfig() {
  return normalizeDestinationConfig(getStorageSection('antiviewonce', { dest: 'owner', jid: null }));
}

function setAntiviewonceConfig(newConfig) {
  return patchStorageSection('antiviewonce', newConfig, { dest: 'owner', jid: null });
}

function resolveDestinationJid(ctx) {
  return resolveDestinationJidShared(ctx, getAntiviewonceConfig(), getOwnerJid(ctx) || ctx.chatId);
}

async function sendCapture(ctx, { buffer, mediaType, mimetype, caption = '' }) {
  const destJid = resolveDestinationJid(ctx);
  const shouldCaption = typeof caption === 'string' && caption.trim().length > 0;

  if (ctx.platform === 'whatsapp' && ctx.platformAdapter && typeof ctx.platformAdapter.sendMedia === 'function') {
    await ctx.platformAdapter.sendMedia(destJid, buffer, {
      type: mediaType,
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
    let viewOnceContent = null;

    if (quotedContent.viewOnceMessageV2) {
      viewOnceContent = quotedContent.viewOnceMessageV2.message;
    } else if (quotedContent.viewOnceMessage) {
      viewOnceContent = quotedContent.viewOnceMessage.message;
    } else if (quotedContent.viewOnceMessageV3) {
      viewOnceContent = quotedContent.viewOnceMessageV3.message;
    } else if (quotedContent.imageMessage || quotedContent.videoMessage || quotedContent.audioMessage) {
      viewOnceContent = quotedContent;
    }

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
    console.error('[antiviewonce] Extract error:', error.message);
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
          console.error(`Error in .vv command: ${error.message}`);
          await ctx.reply('❌ Failed to extract view-once content.');
        }
      }
    }
  ],
  onLoad: async (bot) => {
    console.log('✅ Anti-View Once plugin loaded');
    const adapter = bot.getAdapter('whatsapp');
    if (!adapter) return;

    bot.on('message', async (ctx) => {
      if (ctx.platform !== 'whatsapp') return;

      const msg = ctx.raw;
      if (msg.message?.viewOnceMessage || msg.message?.viewOnceMessageV2 || msg.message?.viewOnceMessageV3) {
        console.log('[antiviewonce] View-once detected, auto-capturing...');

        const quotedMessage = msg.message.viewOnceMessage?.message ||
          msg.message.viewOnceMessageV2?.message ||
          msg.message.viewOnceMessageV3?.message;

        if (quotedMessage) {
          await extractAndSend(ctx, quotedMessage, msg.messageContextInfo || msg.contextInfo);
        }
      }
    });
  }
};

export default AntiViewOncePlugin;
