import memoryStore from '../state/memory.js';
import { extractMessageText } from '../utils/messageUtils.js';
import { deletePinnedMessage, getChatPins, getPinnedMessage, setPinnedMessage } from '../state/pins.js';
import { normalizeWhatsAppJid } from '../utils/whatsappJid.js';

function getTargetMessage(ctx) {
  if (ctx.quoted?.raw?.message && ctx.quoted?.messageId) {
    return {
      sourceChatId: ctx.chatId,
      sourceMessageId: ctx.quoted.messageId,
      senderId: ctx.quoted.senderId || null,
      type: ctx.quoted.type || 'text',
      text: ctx.quoted.text || extractMessageText(ctx.quoted.raw.message) || ''
    };
  }

  return null;
}

function formatSavedTime(timestamp) {
  const date = new Date(Number(timestamp) || Date.now());
  return Number.isNaN(date.getTime()) ? 'unknown' : date.toLocaleString('en-US');
}

function buildPinSummary(pin) {
  return [
    `Tag: ${pin.tag}`,
    `Saved: ${formatSavedTime(pin.savedAt)}`,
    `Type: ${pin.type}`,
    `From: ${pin.senderId || 'unknown'}`,
    '',
    pin.text || '[No text stored]'
  ].join('\n');
}

async function forwardStoredMessage(ctx, pin) {
  if (!pin.sourceChatId || !pin.sourceMessageId) return false;
  const storedMessage = memoryStore.getMessage('whatsapp', pin.sourceChatId, pin.sourceMessageId);
  if (!storedMessage?.key || !storedMessage?.message) return false;

  await ctx.platformAdapter.client.sendMessage(ctx.chatId, {
    forward: storedMessage
  });
  return true;
}

async function setStarState(ctx, shouldStar) {
  if (!ctx.quoted?.messageId) {
    await ctx.reply(`Reply to a message with .${shouldStar ? 'star' : 'unstar'}`);
    return;
  }

  const loggedInJid = normalizeWhatsAppJid(ctx.platformAdapter?.client?.user?.id || '');
  const quotedSenderJid = normalizeWhatsAppJid(ctx.quoted?.senderId || '');
  const fromMe = typeof ctx.quoted?.raw?.key?.fromMe === 'boolean'
    ? ctx.quoted.raw.key.fromMe
    : Boolean(loggedInJid && quotedSenderJid && loggedInJid === quotedSenderJid);

  await ctx.platformAdapter.client.star(
    ctx.chatId,
    [{ id: ctx.quoted.messageId, fromMe }],
    shouldStar
  );
}

export default {
  name: 'pins',
  description: 'Save important replied messages with tags and retrieval',
  version: '1.0.0',
  author: 'Are Martins',
  commands: [
    {
      name: 'pin',
      aliases: ['pins'],
      description: 'Save and manage pinned messages for this chat',
      usage: '.pin save <tag> | .pin get <tag> | .pin list | .pin del <tag>',
      category: 'utility',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 3,
      async execute(ctx) {
        const action = ctx.args[0]?.toLowerCase();

        if (!action || action === 'list') {
          const pins = Object.values(getChatPins(ctx.chatId));
          if (!pins.length) {
            await ctx.reply('No pinned messages saved in this chat.');
            return;
          }

          const lines = pins
            .sort((a, b) => b.savedAt - a.savedAt)
            .map((pin, index) => `${index + 1}. ${pin.tag} | ${pin.type} | ${formatSavedTime(pin.savedAt)}`);
          await ctx.reply(['Pinned messages:', ...lines].join('\n'));
          return;
        }

        if (action === 'save' || action === 'add') {
          const tag = String(ctx.args[1] || '').trim().toLowerCase();
          if (!tag) {
            await ctx.reply('Usage: .pin save <tag>');
            return;
          }

          const target = getTargetMessage(ctx);
          if (!target) {
            await ctx.reply('Reply to a message with .pin save <tag>');
            return;
          }

          setPinnedMessage(ctx.chatId, {
            tag,
            savedAt: Date.now(),
            savedBy: ctx.senderId,
            sourceChatId: target.sourceChatId,
            sourceMessageId: target.sourceMessageId,
            senderId: target.senderId,
            text: target.text,
            type: target.type
          });
          await ctx.reply(`Saved pin "${tag}".`);
          return;
        }

        if (action === 'get') {
          const tag = String(ctx.args[1] || '').trim().toLowerCase();
          if (!tag) {
            await ctx.reply('Usage: .pin get <tag>');
            return;
          }

          const pin = getPinnedMessage(ctx.chatId, tag);
          if (!pin) {
            await ctx.reply(`No saved pin found for "${tag}".`);
            return;
          }

          const forwarded = await forwardStoredMessage(ctx, pin);
          if (!forwarded) {
            await ctx.reply(buildPinSummary(pin));
          }
          return;
        }

        if (action === 'del' || action === 'delete' || action === 'remove') {
          const tag = String(ctx.args[1] || '').trim().toLowerCase();
          if (!tag) {
            await ctx.reply('Usage: .pin del <tag>');
            return;
          }

          const removed = deletePinnedMessage(ctx.chatId, tag);
          await ctx.reply(removed ? `Deleted pin "${tag}".` : `No saved pin found for "${tag}".`);
          return;
        }

        await ctx.reply('Usage:\n.pin save <tag>\n.pin get <tag>\n.pin list\n.pin del <tag>');
      }
    },
    {
      name: 'star',
      description: 'Star a replied message in WhatsApp',
      usage: '.star',
      category: 'utility',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 2,
      async execute(ctx) {
        await setStarState(ctx, true);
      }
    },
    {
      name: 'unstar',
      description: 'Unstar a replied message in WhatsApp',
      usage: '.unstar',
      category: 'utility',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 2,
      async execute(ctx) {
        await setStarState(ctx, false);
      }
    }
  ]
};

