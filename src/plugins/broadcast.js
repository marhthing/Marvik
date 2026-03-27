import { buildForwardPayload } from '../utils/messageUtils.js';
import memoryStore from '../utils/memory.js';

function getBroadcastTargets(scope = 'users') {
  const chats = Object.keys(memoryStore.messages?.whatsapp || {});
  if (scope === 'groups') {
    return chats.filter((jid) => jid.endsWith('@g.us'));
  }
  if (scope === 'all') {
    return chats.filter((jid) => jid.endsWith('@g.us') || jid.endsWith('@s.whatsapp.net'));
  }
  return chats.filter((jid) => jid.endsWith('@s.whatsapp.net'));
}

function parseScope(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'all' || normalized === 'groups' || normalized === 'users') return normalized;
  return null;
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
        const scope = parseScope(ctx.args[0]) || 'users';
        const hasExplicitScope = !!parseScope(ctx.args[0]);
        const text = (hasExplicitScope ? ctx.args.slice(1) : ctx.args).join(' ').trim();
        const targets = getBroadcastTargets(scope).filter((jid) => jid !== ctx.chatId);

        if (!targets.length) {
          await ctx.reply('No known target chats found for that broadcast scope yet.');
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
