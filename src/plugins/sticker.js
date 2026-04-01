import dotenv from 'dotenv';
dotenv.config();

import envMemory from '../utils/envMemory.js';
import { reactIfEnabled } from '../utils/pendingActions.js';
import { getQuotedMediaTarget } from '../utils/quotedMedia.js';
import { downloadMediaBuffer, hasValidMediaHeader } from '../utils/mediaDecode.js';
import {
  downloadPinterestMediaToBuffer,
  getPinterestMediaInfo,
  validatePinterestUrl
} from '../utils/pinterest.js';
import { getStickerCommands, setStickerCommands } from '../state/stickerCommands.js';
import logger from '../utils/logger.js';

const pluginLogger = logger.child({ component: 'sticker' });

function isPinterestPinUrl(value) {
  return /(?:https?:\/\/)?(?:www\.)?(?:pinterest\.com\/pin\/|pin\.it\/)/i.test(value || '');
}

async function loadStickerFormatter(ctx) {
  try {
    return await import('wa-sticker-formatter');
  } catch {
    await ctx.reply('❌ wa-sticker-formatter is not installed. Please run: npm install wa-sticker-formatter');
    return null;
  }
}

async function loadStickerBranding() {
  let config;
  try {
    config = (await import('../config/default.js')).default;
  } catch {
    config = {};
  }

  return {
    stickerPack: envMemory.get('STICKER_PACK') || config.stickerPack || 'Marvik',
    stickerAuthor: envMemory.get('STICKER_AUTHOR') || config.stickerAuthor || 'Bot'
  };
}

async function createStickerBuffer(Sticker, StickerTypes, buffer, stickerPack, stickerAuthor) {
  try {
    const sticker = new Sticker(buffer, {
      pack: stickerPack,
      author: stickerAuthor,
      type: StickerTypes.DEFAULT,
      quality: 30,
      categories: ['📌']
    });
    return await sticker.toBuffer();
  } catch {
    const sticker = new Sticker(buffer, {
      pack: stickerPack,
      author: stickerAuthor,
      type: StickerTypes.FULL,
      quality: 50,
      categories: ['📌']
    });
    return await sticker.toBuffer();
  }
}

async function sendStickerFromBuffer(ctx, Sticker, StickerTypes, stickerPack, stickerAuthor, buffer) {
  const stickerBuffer = await createStickerBuffer(Sticker, StickerTypes, buffer, stickerPack, stickerAuthor);
  await ctx._adapter.sendMedia(ctx.chatId, stickerBuffer, { type: 'sticker' });
}

export default {
  name: 'sticker',
  description: 'Convert media to a sticker',
  version: '1.2.1',
  author: 'Are Martins',
  commands: [
    {
      name: 'sticker',
      aliases: ['st', 's'],
      description: 'Convert an image or supported Pinterest pin to a sticker',
      usage: '.sticker (reply to image/video) | .sticker <pinterest pin url>',
      category: 'media',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 5,
      async execute(ctx) {
        const input = ctx.args.join(' ').trim();
        const stickerFormatter = await loadStickerFormatter(ctx);
        if (!stickerFormatter) return;

        const { Sticker, StickerTypes } = stickerFormatter;
        const { stickerPack, stickerAuthor } = await loadStickerBranding();

        let buffer;
        let sourceType = 'image';

        if (input && isPinterestPinUrl(input)) {
          try {
            const validatedUrl = await validatePinterestUrl(input);
            if (validatedUrl?.failedShortLink) {
              await ctx.reply('This Pinterest short link could not be resolved by Pinterest. Open it in your browser and copy the full pin URL, then send that instead.');
              return;
            }
            if (!validatedUrl) {
              await ctx.reply('❌ Please provide a valid Pinterest URL (pin.it or pinterest.com/pin/).');
              return;
            }

            const mediaInfo = await getPinterestMediaInfo(validatedUrl.url);
            const videoQualities = mediaInfo.videoQualities.filter((item) => !item.url.includes('.m3u8'));
            const selectedUrl = mediaInfo.isVideo
              ? videoQualities[0]?.url
              : mediaInfo.imageQualities[0]?.url;

            if (!selectedUrl) {
              await ctx.reply(`❌ No downloadable ${mediaInfo.isVideo ? 'video' : 'image'} found in that Pinterest link.`);
              return;
            }

            sourceType = mediaInfo.isVideo ? 'video' : 'image';
            buffer = await downloadPinterestMediaToBuffer(selectedUrl);
          } catch (error) {
            pluginLogger.error({ error, input }, 'Pinterest download failed');
            await ctx.reply('❌ Failed to download media from Pinterest. The pin may be private, deleted, or temporarily unavailable.');
            return;
          }
        } else {
          const media = getQuotedMediaTarget(ctx, ['image', 'video', 'gif', 'sticker']);
          if (!media || !['image', 'video', 'gif', 'sticker'].includes(media.type)) {
            await ctx.reply('❌ Please reply to an image, video, or gif, or use `.sticker <pinterest pin url>`.');
            return;
          }

          sourceType = media.type;
          try {
            buffer = await downloadMediaBuffer(ctx, media);
          } catch (error) {
            pluginLogger.error({ error, sourceType }, 'Media download failed');
            await ctx.reply('❌ Failed to download media. The media might have been deleted from WhatsApp servers.');
            return;
          }
        }

        if (!hasValidMediaHeader(buffer) && sourceType === 'image') {
          const sig = buffer?.slice(0, 16);
          pluginLogger.warn({
            type: sourceType,
            size: buffer?.length,
            head: sig ? sig.toString('hex') : null
          }, 'Invalid media header');
          await ctx.reply('❌ The downloaded image appears corrupted or unsupported.');
          return;
        }

        await reactIfEnabled(ctx, '⏳');

        try {
          await sendStickerFromBuffer(ctx, Sticker, StickerTypes, stickerPack, stickerAuthor, buffer);
          await reactIfEnabled(ctx, '✅');
        } catch (error) {
          pluginLogger.error({ error }, 'Failed to create sticker');
          await reactIfEnabled(ctx, '❌');
          await ctx.reply(`❌ Failed to create sticker. ${error?.message ? `Error: ${error.message}` : 'Make sure the media is a valid image or video.'}`);
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
          await ctx.reply('❌ Please reply to a sticker to bind a command to it.');
          return;
        }

        const cmd = ctx.args[0];
        if (!cmd) {
          await ctx.reply(`❌ Please specify the command to bind. Usage: ${this.usage}`);
          return;
        }

        const stickerMessage = stickerTarget.media;
        const fileSha256 = stickerMessage.fileSha256;

        if (!fileSha256) {
          await ctx.reply('❌ Could not identify the sticker.');
          return;
        }

        const stickerId = Buffer.from(fileSha256).toString('base64');
        const stickerCommands = getStickerCommands();

        stickerCommands[stickerId] = cmd.startsWith('.') ? cmd.slice(1) : cmd;
        setStickerCommands(stickerCommands);

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
          await ctx.reply('❌ Please reply to a sticker to unbind its command.');
          return;
        }

        const stickerMessage = stickerTarget.media;
        const fileSha256 = stickerMessage.fileSha256;

        if (!fileSha256) {
          await ctx.reply('❌ Could not identify the sticker.');
          return;
        }

        const stickerId = Buffer.from(fileSha256).toString('base64');
        const stickerCommands = getStickerCommands();

        if (!stickerCommands[stickerId]) {
          await ctx.reply('❌ This sticker has no command bound to it.');
          return;
        }

        const oldCmd = stickerCommands[stickerId];
        delete stickerCommands[stickerId];
        setStickerCommands(stickerCommands);

        await ctx.reply(`✅ Successfully unbound command \`.${oldCmd}\` from this sticker.`);
      }
    }
  ]
};
