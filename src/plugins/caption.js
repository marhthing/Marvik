import { getQuotedMediaTarget } from '../utils/quotedMedia.js';
import { downloadMediaBuffer } from '../utils/mediaDecode.js';
export default {
  name: 'caption',
  description: 'Resend media with a new caption',
  commands: [
    {
      name: 'caption',
      aliases: ['setcaption'],
      description: 'Resend media with a caption',
      usage: '.caption <text> (reply to media or send media with command)',
      category: 'utility',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 3,
      async execute(ctx) {
        const caption = ctx.args.join(' ').trim();
        if (!caption) {
          await ctx.reply('Usage: .caption <text> (reply to media or send media with command)');
          return;
        }

        const media = getQuotedMediaTarget(ctx, ['image', 'video', 'gif', 'document']);
        if (!media) {
          await ctx.reply('Please reply to an image/video/document or send one with the command.');
          return;
        }

        let buffer;
        try {
          buffer = await downloadMediaBuffer(ctx, media);
        } catch {
          await ctx.reply('Failed to download media.');
          return;
        }

        let type = media.type;
        const options = { caption };

        if (type === 'gif') {
          type = 'video';
          options.gifPlayback = true;
        }

        if (!['image', 'video', 'document'].includes(type)) {
          await ctx.reply('Caption is supported only for images, videos, or documents.');
          return;
        }

        if (media.media?.mimetype) options.mimetype = media.media.mimetype;
        if (media.media?.fileName) options.fileName = media.media.fileName;

        await ctx.sendMedia(buffer, { type, ...options });
      }
    }
  ]
};
