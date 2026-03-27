import { dedupeByCanonical, getMergedContacts } from '../utils/recipientUtils.js';

export default {
  name: 'contact',
  description: 'List WhatsApp contacts from Baileys',
  commands: [
    {
      name: 'contact',
      aliases: ['contacts'],
      description: 'Show all WhatsApp contacts',
      usage: '.contact',
      category: 'owner',
      ownerOnly: true,
      cooldown: 3,
      async execute(ctx) {
        const merged = getMergedContacts({ adapter: ctx.platformAdapter });
        const allJids = Object.keys(merged);
        const uniqueJids = dedupeByCanonical(allJids)
          .filter((jid) => !(jid === 'status@broadcast' || jid.endsWith('@broadcast') || jid.endsWith('@status')));
        if (!uniqueJids.length) {
          await ctx.reply('No contacts found in Baileys yet.');
          return;
        }

        const mentions = [];
        const lines = uniqueJids.map((jid) => {
          const handle = `@${jid.split('@')[0]}`;
          mentions.push(jid);
          return handle;
        });

        const header = `Contacts: ${lines.length}`;
        const numbered = lines.map((line, index) => `${index + 1}. ${line}`);
        const body = [header, ...numbered].join('\n');

        if (body.length > 3500 && typeof ctx.sendMedia === 'function') {
          await ctx.sendMedia(Buffer.from(body, 'utf-8'), {
            type: 'document',
            mimetype: 'text/plain',
            fileName: 'contacts.txt'
          });
          return;
        }

        await ctx.reply(body, mentions.length ? { mentions } : {});
      }
    }
  ]
};
