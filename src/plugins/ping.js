export default {
  name: 'ping',
  description: 'Ping command plugin',
  version: '1.0.0',
  author: 'Are Martins',
  commands: [
    {
      name: 'ping',
      aliases: ['p'],
      description: 'Check if the bot is alive',
      usage: '.ping',
      category: 'utility',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 3,
      async execute(ctx) {
        const start = Date.now();
        // Send initial message
        const sentMsg = await ctx.reply('🏓 Pong!');
        const latency = Date.now() - start;
        // Edit the original message with latency
        try {
          if (ctx.edit) {
            await ctx.edit(`🏓 Pong!\n⏱️ Latency: ${latency}ms`);
          } else if (ctx._adapter && ctx._adapter.editMessage) {
            await ctx._adapter.editMessage(ctx.chatId, sentMsg.id || sentMsg.key?.id, `🏓 Pong!\n⏱️ Latency: ${latency}ms`);
          }
        } catch (e) {
          // Fallback: send a new message
          await ctx.reply(`🏓 Pong!\n⏱️ Latency: ${latency}ms`);
        }
      }
    }
  ]
};

