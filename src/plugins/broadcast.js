import { buildForwardPayload } from '../utils/messageUtils.js';
import { buildMentionEntry } from '../utils/mentions.js';
import { dedupeByCanonical, filterChats, getMergedChats } from '../utils/recipientUtils.js';

function getBroadcastTargets(scope = 'users') {
  const merged = dedupeByCanonical(getMergedChats());
  const chats = filterChats(merged, scope === 'all' ? '' : scope);
  return chats.filter((jid) => !(jid === 'status@broadcast' || jid.endsWith('@broadcast') || jid.endsWith('@status')));
}

function parseScope(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'all' || normalized === 'groups' || normalized === 'users') return normalized;
  return null;
}

function formatBroadcastTargets(targets) {
  const mentions = [];
  const lines = targets.map((jid, index) => {
    if (jid.endsWith('@g.us')) {
      return `${index + 1}. ${jid}`;
    }

    const mention = buildMentionEntry(jid);
    if (mention) mentions.push(mention.jid);
    return `${index + 1}. ${mention?.handle || jid}`;
  });

  return { lines, mentions };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default {
  name: 'broadcast',
  description: 'Broadcast text or forwarded content to stored chats',
  commands: [
    {
      name: 'broadcast',
      aliases: ['bc'],
      description: 'Broadcast a message to known users, groups, or both',
      usage: '.broadcast <users|groups|all> <text> or reply to a message with .broadcast <scope>',
      category: 'owner',
      ownerOnly: true,
      adminOnly: false,
      groupOnly: false,
      cooldown: 5,
      async execute(ctx) {
        const firstArg = String(ctx.args[0] || '').toLowerCase();
        const isListMode = firstArg === 'list';
        const scopeArg = isListMode ? ctx.args[1] : ctx.args[0];
        const scope = parseScope(scopeArg) || 'users';
        const hasExplicitScope = isListMode ? !!parseScope(ctx.args[1]) : !!parseScope(ctx.args[0]);
        const text = (isListMode
          ? (hasExplicitScope ? ctx.args.slice(2) : ctx.args.slice(1))
          : (hasExplicitScope ? ctx.args.slice(1) : ctx.args)
        ).join(' ').trim();
        const targets = getBroadcastTargets(scope).filter((jid) => jid !== ctx.chatId);

        if (!targets.length) {
          await ctx.reply('No known target chats found for that broadcast scope yet.');
          return;
        }

        if (isListMode) {
          const formatted = formatBroadcastTargets(targets);
          await ctx.reply(
            [
              `Broadcast targets: ${targets.length}`,
              `Scope: ${scope}`,
              '',
              ...formatted.lines
            ].join('\n'),
            formatted.mentions.length ? { mentions: formatted.mentions } : {}
          );
          return;
        }

        if (!ctx.quoted && !text) {
          await ctx.reply('Provide broadcast text or reply to a message to forward.');
          return;
        }

        let sent = 0;
        let failed = 0;

        for (const target of targets) {
          try {
            if (ctx.quoted && !text) {
              await ctx.platformAdapter.client.sendMessage(target, {
                forward: buildForwardPayload(ctx)
              });
            } else {
              await ctx.platformAdapter.sendMessage(target, text);
            }
            sent += 1;
          } catch {
            failed += 1;
          }
          await sleep(800);
        }

        await ctx.reply(`Broadcast complete.\nScope: ${scope}\nSent: ${sent}\nFailed: ${failed}`);
      }
    }
  ]
};
