import { dedupeByCanonical, filterChats, getDisplayNameForJid, getMergedChats } from '../utils/recipientUtils.js';

export default {
  name: 'chats',
  description: 'List known chats from memory store',
  commands: [
    {
      name: 'chats',
      aliases: ['chatlist'],
      description: 'Show known chat JIDs',
      usage: '.chats [users|groups]',
      category: 'owner',
      ownerOnly: true,
      cooldown: 3,
      async execute(ctx) {
        const mode = ctx.args[0]?.toLowerCase();
        const merged = dedupeByCanonical(getMergedChats());
        const chats = filterChats(merged, mode);
        if (!chats.length) {
          await ctx.reply('No known chats yet.');
          return;
        }

        const mentions = [];
        const lines = [];
        for (const jid of chats) {
          if (jid === 'status@broadcast' || jid.endsWith('@broadcast') || jid.endsWith('@status')) {
            continue;
          }
          if (jid.endsWith('@g.us')) {
            let name = null;
            try {
              const meta = await ctx.platformAdapter?.client?.groupMetadata?.(jid);
              name = meta?.subject || null;
            } catch {}
            const label = name ? `${name} - ${jid}` : jid;
            lines.push(label);
            continue;
          }
          const handle = `@${jid.split('@')[0]}`;
          mentions.push(jid);
          lines.push(handle);
        }
        const header = `Chats: ${lines.length}` + (mode ? ` (${mode})` : '');
        const numbered = lines.map((line, index) => `${index + 1}. ${line}`);
        const body = [header, ...numbered].join('\n');

        if (body.length > 3500 && typeof ctx.sendMedia === 'function') {
          await ctx.sendMedia(Buffer.from(body, 'utf-8'), {
            type: 'document',
            mimetype: 'text/plain',
            fileName: 'chats.txt'
          });
          return;
        }

        await ctx.reply(body, mentions.length ? { mentions } : {});
      }
    }
  ]
};
