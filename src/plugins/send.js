import path from 'path';
import envMemory from '../utils/envMemory.js';
import pendingActions from '../utils/pendingActions.js';
import { downloadMediaMessage } from '@whiskeysockets/baileys';

/**
 * send.js - WhatsApp plugin
 * When a user replies to the owner's status with the word "Send",
 * the bot will send the status media/text to that user in their chat, using pendingActions for flow control.
 */

export default {
  name: 'send',
  description: 'Send owner status to user when they reply "Send" to owner status',
  version: '1.0.1',
  author: 'MATDEV',
  async onLoad(bot) {
    const whatsappAdapter = bot.getAdapter('whatsapp');
    if (!whatsappAdapter) {
      console.error('[send.js] No WhatsApp adapter, aborting');
      return;
    }
    const ownerJid = bot.config.ownerNumber ? `${bot.config.ownerNumber}@s.whatsapp.net` : null;
    if (!ownerJid) {
      console.error('[send.js] No ownerJid, aborting');
      return;
    }

    // Listen for replies to owner's status
    const handleMessagesUpsert = async (ev) => {
      try {
        if (ev.type !== 'notify' || !Array.isArray(ev.messages)) {
          return;
        }
        for (const msg of ev.messages) {
          try {
            const remoteJid = msg.key?.remoteJid;
            if (!remoteJid) continue;
            const contextInfo = msg.message?.extendedTextMessage?.contextInfo || msg.message?.imageMessage?.contextInfo || msg.message?.videoMessage?.contextInfo || {};
            const quoted = contextInfo.quotedMessage;
            const quotedParticipant = contextInfo.participant;
            const quotedRemoteJid = contextInfo.remoteJid || contextInfo.remoteJID;
            if (!quoted) continue;
            if (!quotedRemoteJid || !(quotedRemoteJid === 'status@broadcast' || quotedRemoteJid.endsWith('@status') || quotedRemoteJid.endsWith('@broadcast'))) continue;
            if (quotedParticipant !== ownerJid) continue;
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
            if (text.trim().toLowerCase() !== 'send') continue;
            const userJid = msg.key.participant || msg.key.remoteJid;
            const statusMsgId = contextInfo.stanzaId || contextInfo.stanzaID || contextInfo.id || null;
            if (!statusMsgId) continue;
            if (pendingActions.get(userJid, statusMsgId)) continue;
            pendingActions.set(userJid, statusMsgId, {
              type: 'send-status',
              userId: userJid,
              data: {
                quoted,
                quotedKey: {
                  remoteJid: quotedRemoteJid,
                  fromMe: false,
                  id: statusMsgId,
                  participant: ownerJid
                },
                mediaType: quoted.imageMessage ? 'image' : quoted.videoMessage ? 'video' : quoted.audioMessage ? 'audio' : quoted.documentMessage ? 'document' : null,
                caption: quoted.imageMessage?.caption || quoted.videoMessage?.caption || '',
                text: quoted.conversation || quoted.extendedTextMessage?.text || ''
              },
              match: (messageText) => /\bsend\b/i.test(messageText),
              handler: async (ctx) => {
                const { quoted, quotedKey, mediaType, caption, text } = ctx.pending.data;
                try {
                  if (mediaType) {
                    const buffer = await downloadMediaMessage({ key: quotedKey, message: quoted }, 'buffer', {}, {
                      logger: whatsappAdapter.baileysLogger,
                      reuploadRequest: whatsappAdapter.client.updateMediaMessage
                    });
                    if (buffer) {
                      await whatsappAdapter.client.sendMessage(ctx.senderId, {
                        [mediaType]: buffer,
                        ...(caption ? { caption } : {})
                      });
                      console.log('[send.js] Media sent to', ctx.senderId);
                    } else {
                      console.error('[send.js] No buffer returned for media');
                    }
                  } else if (text) {
                    await whatsappAdapter.client.sendMessage(ctx.senderId, { text });
                    console.log('[send.js] Text sent to', ctx.senderId);
                  } else {
                    console.error('[send.js] No media or text to send');
                  }
                } catch (err) {
                  console.error('[send.js] Failed to forward status:', err, JSON.stringify(err));
                }
                pendingActions.delete(userJid, statusMsgId);
              },
              timeout: 5 * 60 * 1000 // 5 minutes
            });
            // Immediately run the handler
            const ctx = {
              senderId: userJid,
              raw: msg,
              pending: pendingActions.get(userJid, statusMsgId)
            };
            try {
              await pendingActions.get(userJid, statusMsgId)?.handler(ctx);
            } catch (err) {
              console.error('[send.js] Handler threw error', err, JSON.stringify(err));
            }
          } catch (err) {
            console.error('[send.js] Error in message loop', err, JSON.stringify(err));
          }
        }
      } catch (err) {
        console.error('[send.js] Top-level error in messages.upsert', err, JSON.stringify(err));
      }
    };

    whatsappAdapter.client?.ev?.on('messages.upsert', handleMessagesUpsert);

    return () => {
      const eventBus = whatsappAdapter.client?.ev;
      if (!eventBus) return;
      if (typeof eventBus.off === 'function') {
        eventBus.off('messages.upsert', handleMessagesUpsert);
      } else if (typeof eventBus.removeListener === 'function') {
        eventBus.removeListener('messages.upsert', handleMessagesUpsert);
      }
    };
  }
};
