import { reactIfEnabled } from '../utils/pendingActions.js';
import { getQuotedMediaTarget } from '../utils/quotedMedia.js';
import { downloadMediaBuffer, hasValidMediaHeader } from '../utils/mediaDecode.js';

export default {
  name: 'enhance',
  description: 'Enhance the quality of an image (upscale and sharpen)',
  version: '1.0.0',
  author: 'Are Martins',
  commands: [
    {
      name: 'enhance',
      description: 'Enhance image quality (reply to image)',
      usage: '.enhance (reply to image)',
      category: 'media',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 5,
      async execute(ctx) {
        const media = getQuotedMediaTarget(ctx, ['image', 'video']);
        if (!media) {
          return await ctx.reply('❌ Please reply to an image or video to enhance.');
        }
        let buffer;
        try {
          buffer = await downloadMediaBuffer(ctx, media);
        } catch (e) {
          return await ctx.reply('❌ Failed to download media.');
        }
        if (media.type === 'image' && !hasValidMediaHeader(buffer)) {
          return await ctx.reply('❌ The downloaded image appears corrupted or unsupported.');
        }
        if (media.type === 'image') {
          let sharp;
          try {
            sharp = (await import('sharp')).default;
          } catch (e) {
            return await ctx.reply('❌ sharp is not installed. Please run: npm install sharp');
          }
          try {
            // Upscale by 3x, sharpen, and increase contrast/brightness
            const img = sharp(buffer);
            const metadata = await img.metadata();
            const width = metadata.width ? Math.round(metadata.width * 3) : undefined;
            const height = metadata.height ? Math.round(metadata.height * 3) : undefined;
            let enhancedBuffer = await img
              .resize(width, height, { kernel: sharp.kernel.lanczos3 })
              .sharpen(3, 1.5, 0.5)
              .modulate({ brightness: 1.08, contrast: 1.15 })
              .toBuffer();
            await reactIfEnabled(ctx, '✅');
            await ctx._adapter.sendMedia(ctx.chatId, enhancedBuffer, { type: 'image' });
          } catch (e) {
            await reactIfEnabled(ctx, '❌');
            await ctx.reply('❌ Failed to enhance image.');
          }
        } else if (media.type === 'video') {
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
          const tmpIn = tmp.tmpNameSync({ postfix: '.mp4' });
          const tmpOut = tmp.tmpNameSync({ postfix: '.mp4' });
          try {
            await writeFile(tmpIn, buffer);
            await new Promise((resolve, reject) => {
              ffmpeg(tmpIn)
                .setFfmpegPath(ffmpegPath)
                .videoFilters('scale=iw*2:ih*2:flags=lanczos,unsharp=5:5:1.0:5:5:0.0')
                .outputOptions('-movflags', 'faststart', '-an')
                .save(tmpOut)
                .on('end', resolve)
                .on('error', (err) => reject(err));
            });
            const vidBuffer = await readFile(tmpOut);
            await reactIfEnabled(ctx, '✅');
            await ctx._adapter.sendMedia(ctx.chatId, vidBuffer, { type: 'video' });
          } catch (e) {
            await reactIfEnabled(ctx, '❌');
            await ctx.reply(`❌ Failed to enhance video.\nError: ${e?.message || e}`);
          } finally {
            try { await unlink(tmpIn); } catch {}
            try { await unlink(tmpOut); } catch {}
          }
        }
      }
    }
  ]
};

