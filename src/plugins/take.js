import dotenv from 'dotenv';
dotenv.config();
import envMemory from '../utils/envMemory.js';
import { shouldReact } from '../utils/pendingActions.js';
import { getQuotedStickerTarget } from '../utils/quotedMedia.js';
import { downloadMediaBuffer, hasValidMediaHeader } from '../utils/mediaDecode.js';

export default {
  name: 'take',
  description: 'Change sticker pack name and author',
  version: '1.0.0',
  author: 'MATDEV',
  commands: [
    {
      name: 'take',
      aliases: [],
      description: 'Update sticker metadata with your pack name and author',
      usage: '.take (reply to sticker)',
      category: 'media',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 5,
      async execute(ctx) {
        const stickerTarget = getQuotedStickerTarget(ctx);
        
        if (!stickerTarget) {
          return await ctx.reply('❌ Please reply to a sticker to change its metadata.');
        }

        // Download the sticker buffer
        let buffer;
        try {
          buffer = await downloadMediaBuffer(ctx, stickerTarget);
        } catch (e) {
          return await ctx.reply('❌ Failed to download sticker. The sticker might have been deleted from WhatsApp servers.');
        }

        if (!hasValidMediaHeader(buffer)) {
          return await ctx.reply('❌ The downloaded sticker appears corrupted or unsupported.');
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
        if (shouldReact()) await ctx.react('⏳');

        // Re-create sticker with new metadata
        try {
          const sticker = new Sticker(buffer, {
            pack: stickerPack,
            author: stickerAuthor,
            type: StickerTypes.DEFAULT,
            quality: 100, // Keep original quality for existing stickers
            categories: ['🤖'],
          });
          
          const stickerBuffer = await sticker.toBuffer();
          
          // Remove processing indicator
          if (shouldReact()) await ctx.react('✅');
          
          await ctx._adapter.sendMedia(ctx.chatId, stickerBuffer, { type: 'sticker' });
        } catch (e) {
          if (shouldReact()) await ctx.react('❌');
          // console.error('Create sticker error:', e);
          await ctx.reply('❌ Failed to update sticker metadata.');
        }
      }
    }
  ]
};
