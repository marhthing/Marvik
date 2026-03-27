import { getBooleanEnv, setBooleanEnv } from '../utils/envStore.js';

function getAutoFeatureSettings() {
  return {
    AUTO_TYPING: getBooleanEnv('AUTO_TYPING'),
    ALWAYS_ONLINE: getBooleanEnv('ALWAYS_ONLINE'),
    AUTO_READ: getBooleanEnv('AUTO_READ'),
    AUTO_REACT: getBooleanEnv('AUTO_REACT'),
    AUTO_STATUS_REACT: getBooleanEnv('AUTO_STATUS_REACT')
  };
}

export default {
  name: 'auto-features',
  description: 'Automated bot interactions (Typing, Online, React, Read)',
  version: '1.0.0',
  author: 'MATDEV',

  async onMessage(ctx) {
    const settings = getAutoFeatureSettings();

    if (!ctx.isFromMe) {
      if (settings.AUTO_READ && typeof ctx.read === 'function') {
        try { await ctx.read(); } catch {}
      }

      if (settings.AUTO_TYPING && typeof ctx.presence === 'function') {
        try { await ctx.presence('composing'); } catch {}
      }

      if (settings.AUTO_REACT && typeof ctx.react === 'function' && !ctx.command) {
        const reactions = ['❤', '👍', '🔥', '✨', '🤖'];
        const randomReact = reactions[Math.floor(Math.random() * reactions.length)];
        try { await ctx.react(randomReact); } catch {}
      }
    }

    if (settings.AUTO_STATUS_REACT && ctx.raw?.key?.remoteJid === 'status@broadcast') {
      if (typeof ctx.react === 'function') {
        try { await ctx.react('❤'); } catch {}
      }
    }

    if (settings.ALWAYS_ONLINE && typeof ctx.presence === 'function') {
      try { await ctx.presence('available'); } catch {}
    }
  },

  commands: [
    {
      name: 'autotyping',
      description: 'Turn auto typing on or off',
      usage: '.autotyping <on/off>',
      category: 'owner',
      ownerOnly: true,
      async execute(ctx) {
        const value = ctx.args[0]?.toLowerCase();
        if (!['on', 'off'].includes(value)) {
          return await ctx.reply('Usage: .autotyping <on/off>');
        }
        setBooleanEnv('AUTO_TYPING', value === 'on');
        await ctx.reply(`✅ AUTO_TYPING has been set to ${value}.`);
      }
    },
    {
      name: 'autoonline',
      description: 'Turn always online on or off',
      usage: '.autoonline <on/off>',
      category: 'owner',
      ownerOnly: true,
      async execute(ctx) {
        const value = ctx.args[0]?.toLowerCase();
        if (!['on', 'off'].includes(value)) {
          return await ctx.reply('Usage: .autoonline <on/off>');
        }
        setBooleanEnv('ALWAYS_ONLINE', value === 'on');
        const waAdapter = ctx.platformAdapter || (ctx.bot && ctx.bot.getAdapter && ctx.bot.getAdapter('whatsapp'));
        if (waAdapter && typeof waAdapter.setAlwaysOnline === 'function') {
          await waAdapter.setAlwaysOnline(value === 'on');
        }
        await ctx.reply(`✅ ALWAYS_ONLINE has been set to ${value}.`);
      }
    },
    {
      name: 'autoread',
      description: 'Turn auto read on or off',
      usage: '.autoread <on/off>',
      category: 'owner',
      ownerOnly: true,
      async execute(ctx) {
        const value = ctx.args[0]?.toLowerCase();
        if (!['on', 'off'].includes(value)) {
          return await ctx.reply('Usage: .autoread <on/off>');
        }
        setBooleanEnv('AUTO_READ', value === 'on');
        const waAdapter = ctx.platformAdapter || (ctx.bot && ctx.bot.getAdapter && ctx.bot.getAdapter('whatsapp'));
        if (waAdapter) waAdapter._autoRead = value === 'on';
        await ctx.reply(`✅ AUTO_READ has been set to ${value}.`);
      }
    },
    {
      name: 'autoreact',
      description: 'Turn auto react on or off',
      usage: '.autoreact <on/off>',
      category: 'owner',
      ownerOnly: true,
      async execute(ctx) {
        const value = ctx.args[0]?.toLowerCase();
        if (!['on', 'off'].includes(value)) {
          return await ctx.reply('Usage: .autoreact <on/off>');
        }
        setBooleanEnv('AUTO_REACT', value === 'on');
        await ctx.reply(`✅ AUTO_REACT has been set to ${value}.`);
      }
    },
    {
      name: 'autostatusreact',
      description: 'Turn auto status react on or off',
      usage: '.autostatusreact <on/off>',
      category: 'owner',
      ownerOnly: true,
      async execute(ctx) {
        const value = ctx.args[0]?.toLowerCase();
        if (!['on', 'off'].includes(value)) {
          return await ctx.reply('Usage: .autostatusreact <on/off>');
        }
        setBooleanEnv('AUTO_STATUS_REACT', value === 'on');
        await ctx.reply(`✅ AUTO_STATUS_REACT has been set to ${value}.`);
      }
    }
  ]
};
