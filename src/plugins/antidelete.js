import memoryStore from '../utils/memory.js';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { getBooleanEnv, setEnvValue } from '../utils/envStore.js';
import { getStorageSection, patchStorageSection } from '../utils/storageStore.js';
import {
  applyDestinationCommand,
  normalizeDestinationConfig,
  normalizeDestinationJid,
  normalizeDirectJid,
  normalizeJidList,
  resolveDestinationJid
} from '../utils/destinationRouter.js';

const STATUS_ANTIDELETE_DEFAULT = {
  dest: 'owner',
  jid: null,
  scope: 'all',
  only: [],
  except: []
};

function getAntideleteConfig() {
  return getStorageSection('antidelete', { dest: 'owner', jid: null });
}

function setAntideleteConfig(newConfig) {
  return patchStorageSection('antidelete', newConfig, { dest: 'owner', jid: null });
}

function setAntideleteEnabled(enabled) {
  setEnvValue('ANTIDELETE_ENABLED', enabled ? 'on' : 'off');
}

function getAntideleteEnabled() {
  return getBooleanEnv('ANTIDELETE_ENABLED', true);
}

function getStatusAntideleteConfig() {
  const config = getStorageSection('statusantidelete', STATUS_ANTIDELETE_DEFAULT);
  const normalized = normalizeDestinationConfig(config, STATUS_ANTIDELETE_DEFAULT, { allowGroup: true });
  return {
    dest: normalized.dest,
    jid: normalized.jid,
    scope: ['all', 'only', 'except'].includes(config.scope) ? config.scope : 'all',
    only: normalizeJidList(config.only),
    except: normalizeJidList(config.except)
  };
}

function setStatusAntideleteConfig(newConfig) {
  const current = getStatusAntideleteConfig();
  const next = {
    ...current,
    ...newConfig
  };

  next.dest = next.dest === 'custom' ? 'custom' : 'owner';
  next.jid = next.dest === 'custom' ? normalizeDestinationJid(next.jid, { allowGroup: true }) : null;
  next.scope = ['all', 'only', 'except'].includes(next.scope) ? next.scope : 'all';
  next.only = normalizeJidList(next.only);
  next.except = normalizeJidList(next.except);

  if (next.scope !== 'only') next.only = [];
  if (next.scope !== 'except') next.except = [];

  return patchStorageSection('statusantidelete', next, STATUS_ANTIDELETE_DEFAULT);
}

function getStatusAntideleteEnabled() {
  return getBooleanEnv('STATUSANTIDELETE_ENABLED', false);
}

function setStatusAntideleteEnabled(enabled) {
  setEnvValue('STATUSANTIDELETE_ENABLED', enabled ? 'true' : 'false');
}

function parseStatusSenderList(input) {
  return normalizeJidList(String(input || '').split(','));
}

function shouldTrackStatusSender(senderJid, config) {
  const normalizedSender = normalizeDirectJid(senderJid);
  if (!normalizedSender) return false;
  if (config.scope === 'only') {
    return config.only.includes(normalizedSender);
  }
  if (config.scope === 'except') {
    return !config.except.includes(normalizedSender);
  }
  return true;
}

function formatStatusAntideleteSummary() {
  const enabled = getStatusAntideleteEnabled();
  const conf = getStatusAntideleteConfig();
  const destination = conf.dest === 'custom' ? conf.jid : 'owner';
  let scopeLine = 'All status senders';
  if (conf.scope === 'only') {
    scopeLine = conf.only.length ? `Only: ${conf.only.join(', ')}` : 'Only: none configured';
  } else if (conf.scope === 'except') {
    scopeLine = conf.except.length ? `Except: ${conf.except.join(', ')}` : 'Except: none configured';
  }

  return [
    `Status delete recovery is ${enabled ? 'ON' : 'OFF'}`,
    `Destination: ${destination}`,
    `Scope: ${scopeLine}`,
    '',
    'Usage:',
    '.antistatusdelete on',
    '.antistatusdelete off',
    '.antistatusdelete all',
    '.antistatusdelete only <jid>,<jid>',
    '.antistatusdelete except <jid>,<jid>',
    '.antistatusdelete to owner',
    '.antistatusdelete to <jid|groupJid>'
  ].join('\n');
}

function resolveAntideleteDestination(ownerJid, conf, fallbackJid = ownerJid) {
  return resolveDestinationJid({ chatId: fallbackJid }, conf, ownerJid || fallbackJid);
}

function extractMessageBody(msg) {
  return msg?.conversation ||
    msg?.extendedTextMessage?.text ||
    msg?.imageMessage?.caption ||
    msg?.videoMessage?.caption ||
    msg?.documentMessage?.caption ||
    msg?.buttonsResponseMessage?.selectedDisplayText ||
    msg?.listResponseMessage?.title ||
    msg?.templateButtonReplyMessage?.selectedDisplayText ||
    msg?.buttonsMessage?.contentText ||
    msg?.listMessage?.description ||
    msg?.pollCreationMessage?.name ||
    msg?.interactiveMessage?.body?.text ||
    '';
}

function extractMediaType(msg) {
  const mediaTypes = [
    'imageMessage',
    'videoMessage',
    'audioMessage',
    'documentMessage',
    'stickerMessage',
    'contactMessage',
    'locationMessage',
    'liveLocationMessage',
    'pttMessage'
  ];

  for (const type of mediaTypes) {
    if (msg?.[type]) return type.replace('Message', '');
  }
  return null;
}

async function sendRecoveredMedia(whatsappAdapter, sourceMessage, chatId, deletedMessageId, mediaType, actualMsg, destJid, sentNotif, logPrefix) {
  let buffer = null;

  try {
    buffer = await downloadMediaMessage(
      sourceMessage,
      'buffer',
      {},
      {
        logger: whatsappAdapter.baileysLogger,
        reuploadRequest: whatsappAdapter.client.updateMediaMessage
      }
    );
  } catch {}

  if (!buffer) {
    try {
      buffer = memoryStore.getMediaFromDisk('whatsapp', chatId, deletedMessageId);
    } catch {}
  }

  if (!buffer) {
    console.error(`[${logPrefix}] Failed to recover media: not available from server or disk`);
    return;
  }

  try {
    const messageType = `${mediaType}Message`;
    const mimetype = actualMsg?.[messageType]?.mimetype || 'application/octet-stream';
    await whatsappAdapter.client.sendMessage(
      destJid,
      {
        [mediaType]: buffer,
        caption: mediaType !== 'sticker' ? `Deleted ${logPrefix === 'statusantidelete' ? 'status ' : ''}${mediaType}` : undefined,
        mimetype,
        ptt: mediaType === 'ptt'
      },
      { quoted: sentNotif }
    );
  } catch (error) {
    console.error(`[${logPrefix}] Failed to send recovered media:`, error.message);
  }
}

const processedDeletes = new Map();
const processingDeletes = new Set();
const deletionQueue = [];
let isProcessingQueue = false;
const groupMetadataCache = new Map();

export default {
  name: 'antidelete',
  description: 'Recovers deleted messages and deleted statuses',
  version: '1.7.0',
  author: 'MATDEV',
  commands: [
    {
      name: 'delete',
      description: 'Configure antidelete destination and state',
      usage: '.delete <jid|g|p|on|off>',
      category: 'owner',
      ownerOnly: true,
      adminOnly: false,
      groupOnly: false,
      cooldown: 3,
      async execute(ctx) {
        const arg = ctx.args[0]?.toLowerCase();
        if (!arg) {
          const conf = getAntideleteConfig();
          const enabled = getAntideleteEnabled();
          await ctx.reply(`Antidelete is ${enabled ? 'ON' : 'OFF'}\nDestination: ${conf.dest}${conf.jid ? `\nJID: ${conf.jid}` : ''}`);
          return;
        }
        if (arg === 'on' || arg === 'off') {
          setAntideleteEnabled(arg === 'on');
          await ctx.reply(`Antidelete ${arg === 'on' ? 'enabled' : 'disabled'}.`);
          return;
        }
        const response = applyDestinationCommand(arg, setAntideleteConfig, {
          group: 'Antidelete will now send deleted messages to the same chat.',
          owner: 'Antidelete will now send deleted messages to the owner.',
          custom: 'Antidelete will now send deleted messages to JID: %s'
        });
        if (response) {
          await ctx.reply(response);
          return;
        }
        await ctx.reply('Invalid argument. Usage: .delete <jid|g|p|on|off>');
      }
    },
    {
      name: 'antistatusdelete',
      aliases: ['antistatus'],
      description: 'Recover deleted WhatsApp statuses with include/exclude filters',
      usage: '.antistatusdelete <on|off|all|only|except|to>',
      category: 'owner',
      ownerOnly: true,
      adminOnly: false,
      groupOnly: false,
      cooldown: 3,
      async execute(ctx) {
        const action = ctx.args[0]?.toLowerCase();

        if (!action) {
          await ctx.reply(formatStatusAntideleteSummary());
          return;
        }

        if (
          action !== 'on' &&
          action !== 'off' &&
          action !== 'all' &&
          action !== 'only' &&
          action !== 'except' &&
          action !== 'to'
        ) {
          const jid = normalizeDestinationJid(action, { allowGroup: true });
          if (jid) {
            setStatusAntideleteConfig({ dest: 'custom', jid });
            await ctx.reply(`Status delete recovery destination set to ${jid}.`);
            return;
          }
        }

        if (action === 'on' || action === 'off') {
          setStatusAntideleteEnabled(action === 'on');
          await ctx.reply(`Status delete recovery ${action === 'on' ? 'enabled' : 'disabled'}.`);
          return;
        }

        if (action === 'all') {
          setStatusAntideleteConfig({ scope: 'all', only: [], except: [] });
          await ctx.reply('Status delete recovery will now track all status senders.');
          return;
        }

        if (action === 'only' || action === 'except') {
          const listInput = ctx.args.slice(1).join(' ').trim();
          const parsed = parseStatusSenderList(listInput);
          if (parsed.length === 0) {
            await ctx.reply(`Usage: .antistatusdelete ${action} <jid>,<jid>,<jid>`);
            return;
          }

          if (action === 'only') {
            setStatusAntideleteConfig({ scope: 'only', only: parsed, except: [] });
            await ctx.reply(`Status delete recovery will only track: ${parsed.join(', ')}`);
          } else {
            setStatusAntideleteConfig({ scope: 'except', only: [], except: parsed });
            await ctx.reply(`Status delete recovery will ignore: ${parsed.join(', ')}`);
          }
          return;
        }

        if (action === 'to') {
          const targetInput = ctx.args.slice(1).join(' ').trim();
          if (!targetInput) {
            await ctx.reply('Usage: .antistatusdelete to owner\n.antistatusdelete to <jid>');
            return;
          }

          if (targetInput.toLowerCase() === 'owner') {
            setStatusAntideleteConfig({ dest: 'owner', jid: null });
            await ctx.reply('Status delete recovery destination set to owner.');
            return;
          }

          const jid = normalizeDestinationJid(targetInput, { allowGroup: true });
          if (!jid) {
            await ctx.reply('Invalid JID. Use a user JID/phone or a group JID (ends with @g.us).');
            return;
          }

          setStatusAntideleteConfig({ dest: 'custom', jid });
          await ctx.reply(`Status delete recovery destination set to ${jid}.`);
          return;
        }

        await ctx.reply(formatStatusAntideleteSummary());
      }
    }
  ],

  async onLoad(bot) {
    const whatsappAdapter = bot.getAdapter('whatsapp');
    if (!whatsappAdapter) return;

    const ownerJid = bot.config.ownerNumber ? `${bot.config.ownerNumber}@s.whatsapp.net` : null;
    if (!ownerJid) return;

    const cleanupTimer = setInterval(() => {
      const now = Date.now();
      const cutoff = now - 300000;
      for (const [key, timestamp] of processedDeletes.entries()) {
        if (timestamp < cutoff) {
          processedDeletes.delete(key);
        }
      }
    }, 300000);

    const processQueue = async () => {
      if (isProcessingQueue || deletionQueue.length === 0) return;
      isProcessingQueue = true;

      while (deletionQueue.length > 0) {
        const deletion = deletionQueue.shift();
        try {
          await processDeletion(deletion);
        } catch (error) {
          console.error('[antidelete] Error processing queued deletion:', error);
        }
        if (deletionQueue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      isProcessingQueue = false;
    };

    const processDeletion = async ({ deletedKey, chatId, deletedMessageId }) => {
      const dedupeKey = `${chatId}|${deletedMessageId}`;
      const now = Date.now();

      if ((processedDeletes.get(dedupeKey) || 0) + 300000 > now) {
        return;
      }

      try {
        if (!getAntideleteEnabled()) {
          processedDeletes.set(dedupeKey, now);
          return;
        }

        const originalMessage = memoryStore.getMessage('whatsapp', chatId, deletedMessageId);
        if (!originalMessage || originalMessage.key?.fromMe) {
          processedDeletes.set(dedupeKey, now);
          return;
        }

        const pushName = originalMessage.pushName || '';
        const isGroup = chatId.endsWith('@g.us');
        let groupName = '';

        if (isGroup) {
          if (groupMetadataCache.has(chatId)) {
            groupName = groupMetadataCache.get(chatId);
          } else {
            try {
              const metadata = await whatsappAdapter.client.groupMetadata(chatId);
              groupName = metadata.subject || 'Unknown Group';
              groupMetadataCache.set(chatId, groupName);
              setTimeout(() => groupMetadataCache.delete(chatId), 3600000);
            } catch {
              groupName = 'Unknown Group';
            }
          }
        }

        const senderJid = deletedKey.participant || originalMessage.key?.participant || originalMessage.key?.remoteJid || '';
        let senderNumber = senderJid.split('@')[0] || 'Unknown';
        if (senderNumber.includes(':')) senderNumber = senderNumber.split(':')[0];

        let actualMsg = originalMessage.message;
        if (!actualMsg || actualMsg?.protocolMessage) {
          processedDeletes.set(dedupeKey, now);
          return;
        }

        if (actualMsg?.viewOnceMessage?.message) actualMsg = actualMsg.viewOnceMessage.message;
        else if (actualMsg?.viewOnceMessageV2?.message) actualMsg = actualMsg.viewOnceMessageV2.message;
        else if (actualMsg?.ephemeralMessage?.message) actualMsg = actualMsg.ephemeralMessage.message;

        const actualMsgKeys = Object.keys(actualMsg || {});
        if (actualMsgKeys.length === 0 || actualMsgKeys.every(key => ['contextInfo', 'messageContextInfo'].includes(key))) {
          processedDeletes.set(dedupeKey, now);
          return;
        }

        const textContent = extractMessageBody(actualMsg);
        const mediaType = extractMediaType(actualMsg);
        let notification = isGroup
          ? `Deleted in ${groupName}\n@${senderNumber}\n\n`
          : `@${senderNumber} deleted:\n\n`;

        if (textContent) notification += `"${textContent}"`;
        else if (mediaType) notification += `[${mediaType}]`;
        else notification += `[${actualMsgKeys[0] || 'empty message'}]`;

        const destJid = resolveAntideleteDestination(ownerJid, getAntideleteConfig(), chatId);
        let sentNotif;
        try {
          sentNotif = await whatsappAdapter.client.sendMessage(destJid, {
            text: notification,
            mentions: [senderJid]
          });
        } catch (error) {
          console.error('[antidelete] Failed to send notification:', error.message);
          processedDeletes.set(dedupeKey, now);
          return;
        }

        if (mediaType && ['image', 'video', 'audio', 'document', 'sticker', 'ptt'].includes(mediaType)) {
          await sendRecoveredMedia(
            whatsappAdapter,
            originalMessage,
            chatId,
            deletedMessageId,
            mediaType,
            actualMsg,
            destJid,
            sentNotif,
            'antidelete'
          );
        }

        processedDeletes.set(dedupeKey, now);
      } catch (error) {
        console.error('[antidelete] Error processing deletion:', error);
        processedDeletes.set(dedupeKey, Date.now());
      } finally {
        processingDeletes.delete(dedupeKey);
      }
    };

    const handleStatusDeletion = async (deletedKey, chatId, deletedMessageId) => {
      if (!getStatusAntideleteEnabled()) return;

      const senderJid = normalizeDirectJid(deletedKey.participant || 'unknown');
      const conf = getStatusAntideleteConfig();
      if (!shouldTrackStatusSender(senderJid, conf)) return;

      const msg = memoryStore.getMessage('whatsapp', chatId, deletedMessageId);
      if (!msg?.message) return;

      const destJid = resolveDestinationJid({ chatId: ownerJid }, conf, ownerJid, { allowGroup: true });
      let senderNumber = (senderJid || 'unknown').split('@')[0] || 'Unknown';
      if (senderNumber.includes(':')) senderNumber = senderNumber.split(':')[0];

      const textContent = extractMessageBody(msg.message);
      const mediaType = extractMediaType(msg.message);
      let notification = `@${senderNumber} deleted status:\n\n`;
      if (textContent) notification += `"${textContent}"`;
      else if (mediaType) notification += `[${mediaType}]`;
      else notification += `[${Object.keys(msg.message || {})[0] || 'empty message'}]`;

      let sentNotif;
      try {
        sentNotif = await whatsappAdapter.client.sendMessage(destJid, {
          text: notification,
          mentions: senderJid ? [senderJid] : []
        });
      } catch (error) {
        console.error('[statusantidelete] Failed to send notification:', error.message);
        return;
      }

      if (mediaType && ['image', 'video', 'audio', 'document', 'sticker', 'ptt'].includes(mediaType)) {
        await sendRecoveredMedia(
          whatsappAdapter,
          msg,
          chatId,
          deletedMessageId,
          mediaType,
          msg.message,
          destJid,
          sentNotif,
          'statusantidelete'
        );
      }
    };

    const handleMessageUpdates = async (updates) => {
      for (const update of updates) {
        try {
          const isRevoke = update.update?.message?.protocolMessage?.type === 0;
          const isStubDelete = update.update?.messageStubType === 1;
          if (!isRevoke && !isStubDelete) continue;

          const deletedKey = isStubDelete ? update.key : update.update?.message?.protocolMessage?.key;
          if (!deletedKey?.id) continue;

          const chatId = deletedKey.remoteJid || deletedKey.remoteJidAlt;
          const deletedMessageId = deletedKey.id;
          if (!chatId) continue;

          if (chatId.endsWith('@status') || chatId.endsWith('@broadcast')) {
            await handleStatusDeletion(deletedKey, chatId, deletedMessageId);
            continue;
          }

          const dedupeKey = `${chatId}|${deletedMessageId}`;
          if (processingDeletes.has(dedupeKey)) continue;
          if ((processedDeletes.get(dedupeKey) || 0) + 300000 > Date.now()) continue;

          processingDeletes.add(dedupeKey);
          deletionQueue.push({ deletedKey, chatId, deletedMessageId });
          processQueue().catch(error => {
            console.error('[antidelete] Queue processor error:', error);
          });
        } catch (error) {
          console.error('[antidelete] Error queueing deletion:', error);
        }
      }
    };

    whatsappAdapter.on('raw:messages.update', handleMessageUpdates);

    return () => {
      clearInterval(cleanupTimer);
      if (typeof whatsappAdapter.off === 'function') {
        whatsappAdapter.off('raw:messages.update', handleMessageUpdates);
      } else if (typeof whatsappAdapter.removeListener === 'function') {
        whatsappAdapter.removeListener('raw:messages.update', handleMessageUpdates);
      }
    };
  }
};
