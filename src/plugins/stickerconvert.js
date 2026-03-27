import dotenv from 'dotenv';
dotenv.config();
import envMemory from '../utils/envMemory.js';
import { shouldReact } from '../utils/pendingActions.js';
import { getQuotedStickerTarget } from '../utils/quotedMedia.js';
import { downloadMediaBuffer, hasValidMediaHeader } from '../utils/mediaDecode.js';

export default {
  name: 'stickerconvert',
  description: 'Convert stickers to image or video/gif',
  version: '1.0.0',
  author: 'MATDEV',
  commands: [
    {
      name: 'img',
      description: 'Convert sticker to image',
      usage: '.img (reply to sticker)',
      category: 'media',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 3,
      async execute(ctx) {
        const stickerTarget = getQuotedStickerTarget(ctx);
        if (!stickerTarget) {
          return await ctx.reply('❌ Please reply to a sticker to convert.');
        }
        let buffer;
        try {
          buffer = await ctx._adapter.downloadMedia({ raw: stickerTarget.raw });
          if (!buffer || buffer.length === 0) throw new Error('Empty buffer');
        } catch (e) {
          return await ctx.reply('❌ Failed to download sticker.');
        }
        // Try to convert to image (webp to png/jpg)
        let sharp;
        try {
          sharp = (await import('sharp')).default;
        } catch (e) {
          return await ctx.reply('❌ sharp is not installed. Please run: npm install sharp');
        }
        try {
          const imgBuffer = await sharp(buffer).png().toBuffer();
          if (shouldReact()) await ctx.react('✅');
          await ctx._adapter.sendMedia(ctx.chatId, imgBuffer, { type: 'image' });
        } catch (e) {
          if (shouldReact()) await ctx.react('❌');
          await ctx.reply('❌ Failed to convert sticker to image.');
        }
      }
    },
    {
      name: 'vid',
      description: 'Convert animated sticker to video or gif',
      usage: '.vid (reply to sticker)',
      category: 'media',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 3,
      async execute(ctx) {
        const stickerTarget = getQuotedStickerTarget(ctx);
        if (!stickerTarget) {
          return await ctx.reply('❌ Please reply to a sticker to convert.');
        }
        let buffer;
        try {
          buffer = await ctx._adapter.downloadMedia({ raw: stickerTarget.raw });
          if (!buffer || buffer.length === 0) throw new Error('Empty buffer');
        } catch (e) {
          return await ctx.reply('❌ Failed to download sticker.');
        }
        // Check if sticker is animated
        let sharp;
        try {
          sharp = (await import('sharp')).default;
        } catch (e) {
          return await ctx.reply('❌ sharp is not installed. Please run: npm install sharp');
        }
        let isAnimated = false;
        try {
          const metadata = await sharp(buffer, { animated: true }).metadata();
          isAnimated = metadata.pages && metadata.pages > 1;
        } catch (e) {
          // If sharp fails, assume not animated
          isAnimated = false;
        }
        if (!isAnimated) {
          return await ctx.reply('❌ This sticker is not animated. Only animated stickers can be converted to video.');
        }
        // Try to convert webp to gif (animated) or mp4
        let ffmpegPath, ffmpeg;
        try {
          ffmpegPath = (await import('@ffmpeg-installer/ffmpeg')).path;
          ffmpeg = (await import('fluent-ffmpeg')).default;
        } catch (e) {
          return await ctx.reply('❌ ffmpeg and fluent-ffmpeg are not installed. Please run: npm install @ffmpeg-installer/ffmpeg fluent-ffmpeg');
        }
        const tmp = await import('tmp');
        const fs = await import('fs');
        const { promisify } = await import('util');
        const writeFile = promisify(fs.writeFile);
        const readFile = promisify(fs.readFile);
        const unlink = promisify(fs.unlink);
        const tmpWebp = tmp.tmpNameSync({ postfix: '.webp' });
        const tmpOut = tmp.tmpNameSync({ postfix: '.mp4' });
        let conversionError = null;
        let gifBuffer;
        try {
          // Use sharp to extract frames and create a gif
          gifBuffer = await sharp(buffer, { animated: true }).gif().toBuffer();
        } catch (e) {
          return await ctx.reply('❌ Failed to extract frames from sticker. This sticker format may not be supported for conversion.');
        }
        // Write gifBuffer to temp file, then convert gif to mp4
        const tmpGif = tmp.tmpNameSync({ postfix: '.gif' });
        try {
          await writeFile(tmpGif, gifBuffer);
          await new Promise((resolve, reject) => {
            ffmpeg(tmpGif)
              .setFfmpegPath(ffmpegPath)
              .outputOptions('-movflags', 'faststart', '-an')
              .toFormat('mp4')
              .save(tmpOut)
              .on('end', resolve)
              .on('error', (err) => reject(err));
          });
          const vidBuffer = await readFile(tmpOut);
          if (shouldReact()) await ctx.react('✅');
          await ctx._adapter.sendMedia(ctx.chatId, vidBuffer, { type: 'video' });
        } catch (e) {
          if (shouldReact()) await ctx.react('❌');
          await ctx.reply(`❌ Failed to convert sticker to video.\nError: ${e?.message || e}`);
        } finally {
          try { await unlink(tmpWebp); } catch {}
          try { await unlink(tmpOut); } catch {}
          try { await unlink(tmpGif); } catch {}
        }
      }
    }
  ]
};
