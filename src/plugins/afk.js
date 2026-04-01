import { deleteAfkEntry, getAfkEntry, normalizeAfkJid, setAfkEntry } from '../state/afk.js';
import { getOwnerJid } from '../utils/messageUtils.js';
import { buildMentionEntry } from '../utils/mentions.js';

function formatDuration(since) {
  const elapsed = Math.max(0, Date.now() - since);
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) return `${hours}h ${remMinutes}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}

export default {
  name: 'afk',
  description: 'AFK state with mention/reply notifications',
  commands: [
    {
      name: 'afk',
      aliases: [],
      description: 'Mark yourself as AFK with an optional reason',
      usage: '.afk [reason] | .afk off | .afk status',
      category: 'utility',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 2,
      async execute(ctx) {
        const mode = ctx.args[0]?.toLowerCase();
        if (mode === 'status') {
          const entry = getAfkEntry(ctx.senderId);
          if (!entry) {
            await ctx.reply('You are not marked as AFK.');
            return;
          }
          await ctx.reply(`AFK is on.\nReason: ${entry.reason || 'No reason'}\nSince: ${formatDuration(entry.since)}`);
          return;
        }

        if (mode === 'off' || mode === 'back') {
          const entry = getAfkEntry(ctx.senderId);
          if (!entry) {
            await ctx.reply('You are not AFK right now.');
            return;
          }
          deleteAfkEntry(ctx.senderId);
          await ctx.reply(`Welcome back. AFK cleared after ${formatDuration(entry.since)}.`);
          return;
        }

        const reason = ctx.args.join(' ').trim();
        setAfkEntry(ctx.senderId, {
          reason,
          since: Date.now(),
          by: ctx.senderName || ctx.senderId
        });
        await ctx.reply(`AFK enabled${reason ? `: ${reason}` : '.'}`);
      }
    },
    {
      name: 'back',
      aliases: [],
      description: 'Clear your AFK status',
      usage: '.back',
      category: 'utility',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 2,
      async execute(ctx) {
        const entry = getAfkEntry(ctx.senderId);
        if (!entry) {
          await ctx.reply('You are not AFK right now.');
          return;
        }
        deleteAfkEntry(ctx.senderId);
        await ctx.reply(`Welcome back. AFK cleared after ${formatDuration(entry.since)}.`);
      }
    }
  ],
  async onMessage(ctx) {
    if (ctx.command === 'afk' || ctx.command === 'back') return;

    const selfEntry = getAfkEntry(ctx.senderId);
    const hasActivity = Boolean(
      ctx.text?.trim() ||
      ctx.media ||
      ctx.raw?.message ||
      ctx.raw?.messageStubType ||
      ctx.raw?.key?.remoteJid === 'status@broadcast'
    );

    if (selfEntry && hasActivity) {
      deleteAfkEntry(ctx.senderId);
      const ownerJid = getOwnerJid(ctx);
      if (ownerJid && ctx.platformAdapter?.sendMessage) {
        await ctx.platformAdapter.sendMessage(
          ownerJid,
          `AFK cleared. You were away for ${formatDuration(selfEntry.since)}.`
        );
      }
      return;
    }

    if (!ctx.isGroup && !ctx.isOwner) {
      const ownerJid = getOwnerJid(ctx);
      const ownerEntry = ownerJid ? getAfkEntry(ownerJid) : null;
      if (ownerEntry) {
        const mention = buildMentionEntry(ownerJid);
        await ctx.reply(
          `${mention?.handle || ownerEntry.by || 'Owner'} is AFK${ownerEntry.reason ? `: ${ownerEntry.reason}` : ''} (${formatDuration(ownerEntry.since)})`,
          mention ? { mentions: [mention.jid] } : {}
        );
        return;
      }
    }

    const notify = new Map();

    const quotedSenderId = normalizeAfkJid(ctx.quoted?.senderId);
    if (quotedSenderId) {
      const quotedEntry = getAfkEntry(quotedSenderId);
      if (quotedEntry) notify.set(ctx.quoted.senderId, quotedEntry);
    }

    for (const mention of ctx.mentions || []) {
      const normalizedMention = normalizeAfkJid(mention);
      const entry = getAfkEntry(normalizedMention);
      if (entry) notify.set(mention, entry);
    }

    if (!notify.size) return;

    const mentions = [];
    const lines = Array.from(notify.entries()).map(([jid, entry]) => {
      const mention = buildMentionEntry(jid);
      if (mention) mentions.push(mention.jid);
      return `${mention?.handle || entry.by || 'User'} is AFK${entry.reason ? `: ${entry.reason}` : ''} (${formatDuration(entry.since)})`;
    });

    await ctx.reply(lines.join('\n'), mentions.length ? { mentions } : {});
  }
};
