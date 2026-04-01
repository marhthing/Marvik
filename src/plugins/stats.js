import { getDisplayNameForJid } from '../utils/recipientUtils.js';
import { getChatStatsSummary, recordChatCommand, recordChatMessage } from '../state/stats.js';
import { buildMentionEntry } from '../utils/mentions.js';

const recentMessageKeys = new Map();
const MESSAGE_DEDUPE_WINDOW_MS = 5 * 60 * 1000;

function buildStatsMessageKey(ctx) {
  const platform = ctx?.platform || 'unknown';
  const chatId = ctx?.chatId || 'unknown-chat';
  const messageId = ctx?.messageId || ctx?.raw?.key?.id;
  if (!messageId) return null;
  return `${platform}:${chatId}:${messageId}`;
}

function markMessageSeen(messageKey) {
  if (!messageKey) return false;
  const now = Date.now();
  const previous = recentMessageKeys.get(messageKey);
  recentMessageKeys.set(messageKey, now);

  for (const [key, timestamp] of recentMessageKeys.entries()) {
    if (now - timestamp > MESSAGE_DEDUPE_WINDOW_MS) {
      recentMessageKeys.delete(key);
    }
  }

  return typeof previous === 'number' && now - previous <= MESSAGE_DEDUPE_WINDOW_MS;
}

function formatLabelForJid(jid) {
  return getDisplayNameForJid(jid) || jid.split('@')[0];
}

function formatTopUserList(entries, emptyText) {
  if (!entries.length) return { text: emptyText, mentions: [] };

  const mentions = [];
  const text = entries
    .slice(0, 5)
    .map(([jid, count], index) => {
      const mention = buildMentionEntry(jid);
      if (mention) mentions.push(mention.jid);
      return `${index + 1}. ${mention?.handle || formatLabelForJid(jid)} - ${count}`;
    })
    .join('\n');

  return { text, mentions };
}

function formatTopCommandList(entries, emptyText) {
  if (!entries.length) return emptyText;
  return entries
    .slice(0, 5)
    .map(([commandName, count], index) => `${index + 1}. ${commandName} - ${count}`)
    .join('\n');
}

export default {
  name: 'stats',
  description: 'Track and show group activity statistics',
  version: '1.0.0',
  author: 'Are Martins',
  async onLoad(bot) {
    const unregister = bot.getCommandRegistry().registerCommandExecutedHandler(async ({ messageContext, command }) => {
      if (!messageContext?.chatId || !command?.name) return;
      if (messageContext.raw?.key?.remoteJid === 'status@broadcast') return;
      recordChatCommand({
        chatId: messageContext.chatId,
        commandName: command.name
      });
    });

    return () => {
      unregister();
    };
  },
  async onMessage(ctx) {
    if (!ctx?.chatId || !ctx?.senderId) return;
    if (ctx.raw?.key?.remoteJid === 'status@broadcast') return;

    const messageKey = buildStatsMessageKey(ctx);
    if (markMessageSeen(messageKey)) return;

    recordChatMessage({
      chatId: ctx.chatId,
      senderId: ctx.senderId
    });
  },
  commands: [
    {
      name: 'stats',
      aliases: ['groupstats', 'activity'],
      description: 'Show message and command statistics for the group',
      usage: '.stats',
      category: 'group',
      ownerOnly: false,
      adminOnly: true,
      groupOnly: true,
      cooldown: 5,
      async execute(ctx) {
        const summary = getChatStatsSummary(ctx.chatId);
        const topUsers = formatTopUserList(summary.topUsers, 'No user activity recorded.');
        const topCommandsText = formatTopCommandList(
          summary.topCommands,
          'No commands recorded.'
        );
        await ctx.reply(
          [
            '*Group stats (all time)*',
            `Total messages: ${summary.totalMessages}`,
            '',
            '*Top active users*',
            topUsers.text,
            '',
            '*Command usage*',
            topCommandsText
          ].join('\n'),
          topUsers.mentions.length ? { mentions: topUsers.mentions } : {}
        );
      }
    }
  ]
};

