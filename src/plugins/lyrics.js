/**
 * Lyrics plugin
 */
import axios from 'axios';

export default {
  name: 'lyrics',
  description: 'Find lyrics for a song',
  version: '1.0.0',
  author: 'MATDEV',
  commands: [
    {
      name: 'lyrics',
      description: 'Find lyrics for a song',
      usage: '.lyrics <song name>',
      category: 'utils',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 3,
      async execute(ctx) {
        if (!ctx.args[0]) return ctx.reply('Please provide a song name.');
        try {
          const res = await axios.get(`https://api.lyrics.ovh/v1/${encodeURIComponent(ctx.args.join(' '))}`);
          if (res.data.lyrics) {
            await ctx.reply(res.data.lyrics);
          } else {
            await ctx.reply('❌ Lyrics not found.');
          }
        } catch (error) {
          await ctx.reply('❌ Song not found.');
        }
      }
    }
  ]
};
