import { setEnvValue } from '../utils/envStore.js';

const BotReactionsPlugin = {
  name: 'botreactions',
  description: 'Toggle bot reactions to commands',
  category: 'utility',
  commands: [
    {
      name: 'br',
      description: 'Turn bot reactions on or off',
      usage: '.br on | off',
      category: 'owner',
      ownerOnly: true,
      adminOnly: false,
      groupOnly: false,
      cooldown: 3,
      execute: async (ctx) => {
        const arg = (ctx.args[0] || '').toLowerCase();
        if (!['on', 'off'].includes(arg)) {
          return ctx.reply('Usage: .br on | off');
        }
        setEnvValue('BOT_REACTIONS', arg);
        ctx.reply(`Bot reactions are now *${arg.toUpperCase()}*.`);
      }
    }
  ]
};

export default BotReactionsPlugin;
