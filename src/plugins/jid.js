import logger from '../utils/logger.js';

const pluginLogger = logger.child({ component: 'jid' });

export default {
  name: 'jid',
  description: 'Show the chat JID or the JID of a replied user',
  version: '1.0.0',
  author: 'Are Martins',
  commands: [
    {
      name: 'jid',
      aliases: [],
      description: 'Show the current chat JID or the JID of a replied user',
      usage: '.jid',
      category: 'utility',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 2,
      async execute(ctx) {
        try {
          // If a user is mentioned, show their JID; otherwise, show the chat JID
          const mentioned = ctx.raw?.message?.extendedTextMessage?.contextInfo?.mentionedJid;
          if (Array.isArray(mentioned) && mentioned.length > 0) {
            await ctx.reply(mentioned[0]);
          } else if (ctx.quoted && ctx.quoted.senderId) {
            await ctx.reply(ctx.quoted.senderId);
          } else {
            await ctx.reply(ctx.chatId);
          }
        } catch (err) {
          pluginLogger.error({ error: err }, 'JID command failed');
          if (ctx && ctx.reply) {
            await ctx.reply('❌ Error in jid command: ' + (err && err.message ? err.message : String(err)));
          }
        }
      }
    }
  ]
};

