import {
  getModerationState,
  getWarnSettings,
  getWarningCount,
  migrateLegacyModerationStorage,
  setModerationState,
  setWarningCount
} from '../state/moderation.js';
import { removeGroupParticipant } from '../domains/whatsapp/groupActions.js';
import memoryStore from '../state/memory.js';
import { getGroupActionContext } from '../domains/whatsapp/groupContext.js';
import { buildMentionEntry } from '../utils/mentions.js';

const MAX_PURGE_COUNT = 50;

// State for spam detection (memory only, reset on restart)
const messageHistory = new Map();
const SPAM_WINDOW = 5000;
const MAX_MESSAGES = 5;

function ensureAntiwordGroup(state, groupJid) {
  if (!state.antiwordGroups[groupJid]) {
    state.antiwordGroups[groupJid] = { enabled: false, words: [] };
  }
}

function ensureWarnSettings(state, groupJid) {
  if (!state.warnSettingsByGroup[groupJid]) {
    state.warnSettingsByGroup[groupJid] = { enabled: true, max: 3, action: 'kick' };
  }
}

function formatMention(senderId) {
  return buildMentionEntry(senderId)?.jid || `${senderId}@s.whatsapp.net`;
}

function getMentionHandle(senderId) {
  return buildMentionEntry(senderId)?.handle || `@${String(senderId || '').split('@')[0]}`;
}

function normalizeText(value = '') {
  return String(value || '').trim();
}

function getStoredChatMessages(chatId) {
  const messages = Object.entries(memoryStore.getAllMessages('whatsapp', chatId) || {})
    .map(([messageId, message]) => ({ messageId, ...message }))
    .filter((entry) => entry?.message && !entry?.message?.protocolMessage);

  messages.sort((a, b) => {
    const aTime = Number(a._savedAt || a.messageTimestamp || 0);
    const bTime = Number(b._savedAt || b.messageTimestamp || 0);
    return bTime - aTime;
  });

  return messages;
}

async function resolveModerationTarget(ctx) {
  const { targetParticipant } = await getGroupActionContext(ctx, { resolveTarget: true });
  return targetParticipant || null;
}

async function applyWarning(ctx, senderId, reason = 'Manual warning') {
  const groupJid = ctx.chatId;
  const settings = getWarnSettings(groupJid);
  const mention = formatMention(senderId);
  const mentionHandle = getMentionHandle(mention);
  const currentWarns = getWarningCount(groupJid, senderId) + 1;
  setWarningCount(groupJid, senderId, currentWarns);

  if (currentWarns >= settings.max) {
    await ctx.reply(
      `${mentionHandle} reached max warnings (${settings.max})${reason ? `.\nReason: ${reason}` : '.'}`,
      { mentions: [mention] }
    );

    if (settings.action === 'kick') {
      try {
        await removeGroupParticipant(ctx._adapter.client, groupJid, mention);
      } catch {
        await ctx.reply('Failed to kick user. Make sure I am an admin.');
      }
    }

    setWarningCount(groupJid, senderId, 0);
    return;
  }

  const remaining = Math.max(0, settings.max - currentWarns);
  await ctx.reply(
    `${mentionHandle} warned.\nReason: ${reason}\nWarnings: ${currentWarns}/${settings.max}\nRemaining: ${remaining}`,
    { mentions: [mention] }
  );
}

export default {
  name: 'moderation',
  description: 'Anti-link, Anti-spam, Anti-word and Warning system',
  version: '1.2.0',
  async onLoad() {
    migrateLegacyModerationStorage();
  },
  commands: [
    {
      name: 'antilink',
      description: 'Turn anti-link on or off',
      usage: '.antilink on/off',
      category: 'admin',
      ownerOnly: false,
      adminOnly: true,
      groupOnly: true,
      cooldown: 3,
      async execute(ctx) {
        const arg = ctx.args[0]?.toLowerCase();
        const state = getModerationState();
        const groupJid = ctx.chatId;

        if (arg === 'on') {
          if (!state.antilinkGroups.includes(groupJid)) {
            state.antilinkGroups.push(groupJid);
            setModerationState(state);
          }
          return ctx.reply('Anti-link enabled for this group.');
        }

        if (arg === 'off') {
          state.antilinkGroups = state.antilinkGroups.filter((id) => id !== groupJid);
          setModerationState(state);
          return ctx.reply('Anti-link disabled for this group.');
        }

        return ctx.reply('Usage: .antilink on/off');
      }
    },
    {
      name: 'antispam',
      description: 'Turn anti-spam on or off',
      usage: '.antispam on/off',
      category: 'admin',
      ownerOnly: false,
      adminOnly: true,
      groupOnly: true,
      cooldown: 3,
      async execute(ctx) {
        const arg = ctx.args[0]?.toLowerCase();
        const state = getModerationState();
        const groupJid = ctx.chatId;

        if (arg === 'on') {
          if (!state.antispamGroups.includes(groupJid)) {
            state.antispamGroups.push(groupJid);
            setModerationState(state);
          }
          return ctx.reply('Anti-spam enabled for this group.');
        }

        if (arg === 'off') {
          state.antispamGroups = state.antispamGroups.filter((id) => id !== groupJid);
          setModerationState(state);
          return ctx.reply('Anti-spam disabled for this group.');
        }

        return ctx.reply('Usage: .antispam on/off');
      }
    },
    {
      name: 'antiword',
      description: 'Manage anti-word list',
      usage: '.antiword on/off | .antiword add <word> | .antiword remove <word>',
      category: 'admin',
      ownerOnly: false,
      adminOnly: true,
      groupOnly: true,
      cooldown: 3,
      async execute(ctx) {
        const sub = ctx.args[0]?.toLowerCase();
        const word = ctx.args[1]?.toLowerCase();
        const state = getModerationState();
        const groupJid = ctx.chatId;

        ensureAntiwordGroup(state, groupJid);

        if (sub === 'on') {
          state.antiwordGroups[groupJid].enabled = true;
          setModerationState(state);
          return ctx.reply('Anti-word enabled for this group.');
        }

        if (sub === 'off') {
          state.antiwordGroups[groupJid].enabled = false;
          setModerationState(state);
          return ctx.reply('Anti-word disabled for this group.');
        }

        if (sub === 'add' && word) {
          if (!state.antiwordGroups[groupJid].words.includes(word)) {
            state.antiwordGroups[groupJid].words.push(word);
            setModerationState(state);
          }
          return ctx.reply(`Added "${word}" to anti-word list.`);
        }

        if (sub === 'remove' && word) {
          state.antiwordGroups[groupJid].words = state.antiwordGroups[groupJid].words.filter((entry) => entry !== word);
          setModerationState(state);
          return ctx.reply(`Removed "${word}" from anti-word list.`);
        }

        return ctx.reply('Usage:\n.antiword on/off\n.antiword add <word>\n.antiword remove <word>');
      }
    },
    {
      name: 'warn',
      description: 'Manage warning system and warn users',
      usage: '.warn on/off | .warn max <number> | .warn reset [reply/@user] | .warn [reply/@user] [reason]',
      category: 'admin',
      ownerOnly: false,
      adminOnly: true,
      groupOnly: true,
      cooldown: 3,
      async execute(ctx) {
        const sub = ctx.args[0]?.toLowerCase();
        const state = getModerationState();
        const groupJid = ctx.chatId;

        ensureWarnSettings(state, groupJid);

        if (sub === 'on') {
          state.warnSettingsByGroup[groupJid].enabled = true;
          setModerationState(state);
          return ctx.reply('Warning system enabled.');
        }

        if (sub === 'off') {
          state.warnSettingsByGroup[groupJid].enabled = false;
          setModerationState(state);
          return ctx.reply('Warning system disabled.');
        }

        if (sub === 'max' && ctx.args[1]) {
          const max = parseInt(ctx.args[1], 10);
          if (Number.isNaN(max)) return ctx.reply('Invalid number.');
          state.warnSettingsByGroup[groupJid].max = max;
          setModerationState(state);
          return ctx.reply(`Max warnings set to ${max}.`);
        }

        if (sub === 'reset' && ctx.quoted?.senderId) {
          setWarningCount(groupJid, ctx.quoted.senderId, 0);
          return ctx.reply(`Warnings reset for ${getMentionHandle(ctx.quoted.senderId)}`, {
            mentions: [ctx.quoted.senderId]
          });
        }

        if (sub === 'reset') {
          const target = await resolveModerationTarget(ctx);
          if (!target) {
            return ctx.reply('Reply to a user or mention a user to reset warnings.');
          }

          setWarningCount(groupJid, target.id, 0);
          return ctx.reply(`Warnings reset for ${getMentionHandle(target.id)}`, {
            mentions: [target.id]
          });
        }

        const target = await resolveModerationTarget(ctx);
        if (target) {
          const reasonStartIndex = ctx.quoted?.senderId ? 0 : 1;
          const reason = normalizeText(ctx.args.slice(reasonStartIndex).join(' ')) || 'Manual warning';
          await applyWarning(ctx, target.id, reason);
          return;
        }

        return ctx.reply('Usage:\n.warn on/off\n.warn max <number>\n.warn reset [reply/@user]\n.warn [reply/@user] [reason]');
      }
    },
    {
      name: 'purge',
      description: 'Delete recent messages from this group',
      usage: '.purge <count>',
      category: 'admin',
      ownerOnly: false,
      adminOnly: true,
      groupOnly: true,
      cooldown: 5,
      async execute(ctx) {
        const requestedCount = parseInt(ctx.args[0], 10);
        if (Number.isNaN(requestedCount) || requestedCount < 1) {
          return ctx.reply('Usage: .purge <count>');
        }

        const count = Math.min(requestedCount, MAX_PURGE_COUNT);
        const messages = getStoredChatMessages(ctx.chatId)
          .filter((entry) => entry.messageId !== ctx.messageId)
          .slice(0, count);

        if (!messages.length) {
          return ctx.reply('No recent messages available to purge.');
        }

        let deleted = 0;
        for (const entry of messages) {
          const key = entry?.key || entry?.raw?.key;
          if (!key) continue;
          try {
            await ctx._adapter.client.sendMessage(ctx.chatId, { delete: key });
            deleted += 1;
          } catch {}
        }

        await ctx.reply(`Purged ${deleted} message(s).${requestedCount > MAX_PURGE_COUNT ? ` Max per command is ${MAX_PURGE_COUNT}.` : ''}`);
      }
    }
  ],
  async onMessage(ctx) {
    if (!ctx.isGroup) return;

    const state = getModerationState();
    const sender = ctx.senderId || ctx.sender;
    const groupJid = ctx.chatId;
    const messageText = (ctx.text || '').toLowerCase();

    if (ctx.isAdmin || ctx.isOwner) return;

    const handleViolation = async (type) => {
      const settings = getWarnSettings(groupJid);

      try {
        const messageKey = ctx.messageKey || ctx.raw?.key;
        if (messageKey && ctx._adapter?.client) {
          await ctx._adapter.client.sendMessage(groupJid, { delete: messageKey });
        }
      } catch {}

      if (!settings.enabled) return;

      const currentWarns = getWarningCount(groupJid, sender) + 1;
      setWarningCount(groupJid, sender, currentWarns);

      const remaining = settings.max - currentWarns;
      const mention = sender.includes('@') ? sender : `${sender}@s.whatsapp.net`;

      if (currentWarns >= settings.max) {
        await ctx.reply(`${getMentionHandle(mention)} reached max warnings (${settings.max}) and will be kicked.`, {
          mentions: [mention]
        });
        try {
          await removeGroupParticipant(ctx._adapter.client, groupJid, mention);
        } catch {
          await ctx.reply('Failed to kick user. Make sure I am an admin.');
        }
        setWarningCount(groupJid, sender, 0);
        return;
      }

      await ctx.reply(
        `${getMentionHandle(mention)}, violation detected (${type}).\nWarnings: ${currentWarns}/${settings.max}\nYou have ${remaining} more grace.`,
        { mentions: [mention] }
      );
    };

    if (state.antilinkGroups.includes(groupJid)) {
      const linkPattern = /(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/gi;
      if (linkPattern.test(messageText)) {
        return handleViolation('Link detected');
      }
    }

    const antiword = state.antiwordGroups[groupJid];
    if (antiword?.enabled && antiword.words.length > 0) {
      const found = antiword.words.some((word) => messageText.includes(word));
      if (found) {
        return handleViolation('Banned word detected');
      }
    }

    if (state.antispamGroups.includes(groupJid)) {
      const now = Date.now();
      if (!messageHistory.has(sender)) messageHistory.set(sender, []);
      const timestamps = messageHistory.get(sender);

      const keysKey = `${sender}_keys`;
      if (!messageHistory.has(keysKey)) messageHistory.set(keysKey, []);
      const keys = messageHistory.get(keysKey);
      keys.push(ctx.messageKey || ctx.raw?.key);

      timestamps.push(now);
      const recentTimestamps = timestamps.filter((ts) => now - ts < SPAM_WINDOW);
      messageHistory.set(sender, recentTimestamps);

      if (recentTimestamps.length > MAX_MESSAGES) {
        messageHistory.set(sender, []);
        const spamKeys = [...keys];
        messageHistory.set(keysKey, []);

        for (const key of spamKeys) {
          if (!key) continue;
          try {
            await ctx._adapter.client.sendMessage(groupJid, { delete: key });
          } catch {}
        }

        return handleViolation('Spamming');
      }
    }
  }
};
