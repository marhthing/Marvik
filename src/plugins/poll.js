export default {
  name: 'poll',
  description: 'Create WhatsApp polls',
  version: '1.0.0',
  author: 'Are Martins',
  commands: [
    {
      name: 'poll',
      description: 'Create a WhatsApp poll',
      usage: '.poll Question | Option 1 | Option 2 | [Option 3...]',
      category: 'utility',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 3,
      async execute(ctx) {
        const raw = ctx.args.join(' ').trim();
        if (!raw) {
          await ctx.reply('Usage: .poll Question | Option 1 | Option 2 | [Option 3...]');
          return;
        }

        const parts = raw.split('|').map((part) => part.trim()).filter(Boolean);
        if (parts.length < 3) {
          await ctx.reply('A poll needs one question and at least two options.\nUsage: .poll Question | Option 1 | Option 2');
          return;
        }

        const [name, ...values] = parts;
        await ctx.platformAdapter.client.sendMessage(ctx.chatId, {
          poll: {
            name,
            values,
            selectableCount: 1
          }
        });
      }
    }
  ]
};
