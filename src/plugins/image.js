import { reactIfEnabled } from '../utils/pendingActions.js';
import fetch from 'node-fetch';

export default {
  name: 'image',
  description: 'Generate an image from a prompt using Pollinations.ai',
  version: '1.0.0',
  author: 'Are Martins',
  commands: [
    {
      name: 'image',
      aliases: ['pollinations'],
      description: 'Generate an image from text prompt',
      usage: '.image <prompt> or reply to a message with .image',
      category: 'ai',
      cooldown: 5,
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      async execute(ctx) {
        let prompt = ctx.args.join(' ');
        if (!prompt && ctx.quoted) {
          prompt = ctx.quoted.text || ctx.quoted.caption || '';
        }
        if (!prompt || !prompt.trim()) {
          return await ctx.reply('Please provide a prompt or reply to a message with .image\n\nUsage: .image a cat astronaut on the moon');
        }
        await reactIfEnabled(ctx, '🎨');
        try {
          // Pollinations API: https://image.pollinations.ai/prompt/<prompt>
          const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error('Failed to generate image');
          const arrayBuffer = await res.arrayBuffer();
          const imgBuffer = Buffer.from(arrayBuffer);
          await ctx._adapter.sendMedia(ctx.chatId, imgBuffer, {
            type: 'image',
            mimetype: 'image/png',
            caption: `Prompt: ${prompt}`
          });
          await reactIfEnabled(ctx, '✅');
        } catch (e) {
          await reactIfEnabled(ctx, '❌');
          await ctx.reply('❌ Failed to generate image. Please try again later.');
        }
      }
    }
  ]
};

