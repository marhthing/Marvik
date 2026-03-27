import dotenv from 'dotenv';
dotenv.config();
import envMemory from '../utils/envMemory.js';
import { shouldReact } from '../utils/pendingActions.js';
import { getQuotedMediaTarget } from '../utils/quotedMedia.js';
import { downloadMediaBuffer, hasValidMediaHeader } from '../utils/mediaDecode.js';

export default {
  name: 'sticker',
  description: 'Convert an image to a sticker',
  version: '1.0.0',
  author: 'MATDEV',
  commands: [
    {
      name: 'sticker',
      aliases: ['st', 's'],
      description: 'Convert an image to a sticker',
      usage: '.sticker (reply to image/video)',
      category: 'media',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 5,
      async execute(ctx) {
        const media = getQuotedMediaTarget(ctx, ['image', 'video', 'gif', 'sticker']);
        
        if (!media || !['image', 'video', 'gif', 'sticker'].includes(media.type)) {
          return await ctx.reply('❌ Please reply to an image, video, or gif to convert it to a sticker.');
        }

        // Download the media buffer
        let buffer;
        try {
          buffer = await downloadMediaBuffer(ctx, media);
        } catch (e) {
          console.error('[sticker] download error', e?.message || e, e?.stack || '');
          return await ctx.reply('❌ Failed to download media. The media might have been deleted from WhatsApp servers.');
        }

        if (!hasValidMediaHeader(buffer) && media.type === 'image') {
          const sig = buffer?.slice(0, 16);
          console.error('[sticker] invalid header', {
            type: media.type,
            mimetype: media.media?.mimetype,
            size: buffer?.length,
            head: sig ? sig.toString('hex') : null
          });
          return await ctx.reply('❌ The downloaded image appears corrupted or unsupported.');
        }

        // Import wa-sticker-formatter
        let Sticker, StickerTypes;
        try {
          ({ Sticker, StickerTypes } = await import('wa-sticker-formatter'));
        } catch (e) {
          return await ctx.reply('❌ wa-sticker-formatter is not installed. Please run: npm install wa-sticker-formatter');
        }

        // Import config for sticker pack/author
        let config;
        try {
          config = (await import('../config/default.js')).default;
        } catch (e) {
          config = {};
        }
        // Fetch from envMemory (in-memory .env), fallback to config, then hardcoded
        const stickerPack = envMemory.get('STICKER_PACK') || config.stickerPack || 'MATDEV Bot';
        const stickerAuthor = envMemory.get('STICKER_AUTHOR') || config.stickerAuthor || 'Bot';

        // Send processing indicator
        if (shouldReact()) await ctx.react('?');

        // Create sticker with optimized settings
        try {
          const sticker = new Sticker(buffer, {
            pack: stickerPack,
            author: stickerAuthor,
            type: StickerTypes.DEFAULT, // Faster than FULL
            quality: 30, // Lower quality = faster processing (30-60 range)
            categories: ['??'],
          });
          
          const stickerBuffer = await sticker.toBuffer();
          
          // Remove processing indicator
          if (shouldReact()) await ctx.react('?');
          
          await ctx._adapter.sendMedia(ctx.chatId, stickerBuffer, { type: 'sticker' });
        } catch (e) {
          console.error('[sticker] Create sticker error:', e?.message || e, e?.stack || '');
          try {
            const sticker = new Sticker(buffer, {
              pack: stickerPack,
              author: stickerAuthor,
              type: StickerTypes.FULL,
              quality: 50,
              categories: ['??']
            });
            const stickerBuffer = await sticker.toBuffer();
            if (shouldReact()) await ctx.react('?');
            await ctx._adapter.sendMedia(ctx.chatId, stickerBuffer, { type: 'sticker' });
            return;
          } catch (e2) {
            console.error('[sticker] Create sticker FULL error:', e2?.message || e2, e2?.stack || '');
          }
          if (shouldReact()) await ctx.react('?');
          await ctx.reply(`❌ Failed to create sticker. ${e?.message ? `Error: ${e.message}` : 'Make sure the media is a valid image or video.'}`);
        }
      }
    },
    {
      name: 'setcmd',
      description: 'Bind a command to a sticker',
      usage: '.setcmd (reply to sticker) [command]',
      category: 'media',
      ownerOnly: true,
      async execute(ctx) {
        const stickerTarget = getQuotedMediaTarget(ctx, ['sticker']);
        if (!stickerTarget) {
          return await ctx.reply('❌ Please reply to a sticker to bind a command to it.');
        }

        const cmd = ctx.args[0];
        if (!cmd) {
          return await ctx.reply(`❌ Please specify the command to bind. Usage: ${this.usage}`);
        }

        const stickerMessage = stickerTarget.media;
        const fileSha256 = stickerMessage.fileSha256;
        
        if (!fileSha256) {
          return await ctx.reply('❌ Could not identify the sticker.');
        }

        const stickerId = Buffer.from(fileSha256).toString('base64');
        const storageUtil = (await import('../utils/storageUtil.js')).default;
        const stickerCommands = storageUtil.getStickerCommands();
        
        stickerCommands[stickerId] = cmd.startsWith('.') ? cmd.slice(1) : cmd;
        storageUtil.setStickerCommands(stickerCommands);

        await ctx.reply(`✅ Successfully bound command \`.${stickerCommands[stickerId]}\` to this sticker.`);
      }
    },
    {
      name: 'delcmd',
      description: 'Unbind a command from a sticker',
      usage: '.delcmd (reply to sticker)',
      category: 'media',
      ownerOnly: true,
      async execute(ctx) {
        const stickerTarget = getQuotedMediaTarget(ctx, ['sticker']);
        if (!stickerTarget) {
          return await ctx.reply('❌ Please reply to a sticker to unbind its command.');
        }

        const stickerMessage = stickerTarget.media;
        const fileSha256 = stickerMessage.fileSha256;
        
        if (!fileSha256) {
          return await ctx.reply('❌ Could not identify the sticker.');
        }

        const stickerId = Buffer.from(fileSha256).toString('base64');
        const storageUtil = (await import('../utils/storageUtil.js')).default;
        const stickerCommands = storageUtil.getStickerCommands();
        
        if (!stickerCommands[stickerId]) {
          return await ctx.reply('❌ This sticker has no command bound to it.');
        }

        const oldCmd = stickerCommands[stickerId];
        delete stickerCommands[stickerId];
        storageUtil.setStickerCommands(stickerCommands);

        await ctx.reply(`✅ Successfully unbound command \`.${oldCmd}\` from this sticker.`);
      }
    }
  ]
};
