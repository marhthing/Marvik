import { shouldReact } from '../utils/pendingActions.js';
import { getQuotedMessageObject } from '../utils/messageUtils.js';
import { formatFileSize, promptNumericSelection, sendImageBuffer, sendVideoBuffer } from '../utils/downloadFlow.js';
import {
  downloadPinterestMediaToBuffer,
  extractPinterestUrlFromObject,
  getPinterestFileSize,
  getPinterestMediaInfo,
  validatePinterestUrl
} from '../utils/pinterest.js';

const VIDEO_SIZE_LIMIT = 2 * 1024 * 1024 * 1024;
const VIDEO_MEDIA_LIMIT = 16 * 1024 * 1024;

async function sendPinterestVideo(ctx, url) {
  const buffer = await downloadPinterestMediaToBuffer(url);
  await sendVideoBuffer(ctx, buffer, {
    sizeLimit: VIDEO_SIZE_LIMIT,
    mediaLimit: VIDEO_MEDIA_LIMIT,
    limitLabel: '2GB',
    caption: 'Pinterest video'
  });
}

async function sendPinterestImage(ctx, url) {
  const buffer = await downloadPinterestMediaToBuffer(url);
  await sendImageBuffer(ctx, buffer);
}

export default {
  name: 'pinterest',
  description: 'Pinterest media downloader with quality selection',
  version: '2.2.0',
  author: 'MATDEV',
  commands: [
    {
      name: 'pin',
      aliases: ['pinterest'],
      description: 'Download Pinterest media (image/video) with quality selection',
      usage: '.pin <url>',
      category: 'download',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 10,
      async execute(ctx) {
        try {
          let url = ctx.args.join(' ').trim();
          if (!url) {
            const quotedMessage = getQuotedMessageObject(ctx);
            if (quotedMessage) {
              url = extractPinterestUrlFromObject(quotedMessage) || '';
            }
          }

          if (!url) {
            return await ctx.reply('Please provide a Pinterest URL\n\nUsage: .pin <url>');
          }

          const validatedUrl = await validatePinterestUrl(url);
          if (!validatedUrl) {
            return await ctx.reply('Please provide a valid Pinterest URL (pin.it or pinterest.com/pin/)');
          }

          if (shouldReact()) await ctx.react('⏳');

          try {
            const mediaInfo = await getPinterestMediaInfo(validatedUrl.url);

            if (mediaInfo.isVideo) {
              const videoQualities = mediaInfo.videoQualities.filter(item => !item.url.includes('.m3u8'));
              if (videoQualities.length === 0) {
                if (shouldReact()) await ctx.react('❌');
                return await ctx.reply('No downloadable video found (only streaming formats available).');
              }

              if (videoQualities.length === 1) {
                await sendPinterestVideo(ctx, videoQualities[0].url);
                if (shouldReact()) await ctx.react('✅');
                return;
              }

              const choices = [];
              for (let index = 0; index < videoQualities.length; index += 1) {
                const quality = videoQualities[index];
                const size = await getPinterestFileSize(quality.url);
                let label = quality.quality;
                if (quality.height > 0) label = `${quality.height}p`;
                choices.push({
                  label: `${index + 1} - ${label}${size ? ` (${formatFileSize(size)})` : ''}`,
                  url: quality.url
                });
              }

              let prompt = '*Pinterest Video Found!*\n\nSelect quality by replying with the number:\n';
              prompt += choices.map(choice => choice.label).join('\n');

              await promptNumericSelection(ctx, {
                type: 'pinterest_quality',
                prompt,
                choices,
                handler: async (replyCtx, selected) => {
                  if (shouldReact()) await replyCtx.react('⏳');
                  try {
                    await sendPinterestVideo(replyCtx, selected.url);
                    if (shouldReact()) await replyCtx.react('✅');
                  } catch (error) {
                    if (shouldReact()) await replyCtx.react('❌');
                    const message = error.message?.includes('Video too large')
                      ? error.message
                      : 'Failed to download selected quality.';
                    await replyCtx.reply(message);
                  }
                  return true;
                }
              });
              return;
            }

            const imageQualities = mediaInfo.imageQualities;
            if (imageQualities.length === 0) {
              if (shouldReact()) await ctx.react('❌');
              return await ctx.reply('No downloadable image found.');
            }

            if (imageQualities.length === 1) {
              await sendPinterestImage(ctx, imageQualities[0].url);
              if (shouldReact()) await ctx.react('✅');
              return;
            }

            const choices = [];
            for (let index = 0; index < imageQualities.slice(0, 5).length; index += 1) {
              const quality = imageQualities[index];
              const size = await getPinterestFileSize(quality.url);
              let label = quality.quality;
              if (quality.width > 0 && quality.height > 0) label = `${quality.width}x${quality.height}`;
              else if (quality.width > 0) label = `${quality.width}px wide`;
              choices.push({
                label: `${index + 1} - ${label}${size ? ` (${formatFileSize(size)})` : ''}`,
                url: quality.url
              });
            }

            let prompt = '*Pinterest Image Found!*\n\nSelect quality by replying with the number:\n';
            prompt += choices.map(choice => choice.label).join('\n');

            await promptNumericSelection(ctx, {
              type: 'pinterest_quality',
              prompt,
              choices,
              handler: async (replyCtx, selected) => {
                if (shouldReact()) await replyCtx.react('⏳');
                try {
                  await sendPinterestImage(replyCtx, selected.url);
                  if (shouldReact()) await replyCtx.react('✅');
                } catch {
                  if (shouldReact()) await replyCtx.react('❌');
                  await replyCtx.reply('Failed to download selected quality.');
                }
                return true;
              }
            });
          } catch (error) {
            if (shouldReact()) await ctx.react('❌');
            let errorMsg = 'Download failed. ';
            if (error.message?.includes('private')) {
              errorMsg += 'This pin may be private.';
            } else if (error.message?.includes('not found')) {
              errorMsg += 'Pin not found or deleted.';
            } else if (error.message?.includes('extract')) {
              errorMsg += 'Could not extract media from Pinterest.';
            } else {
              errorMsg += 'Please try again later.';
            }
            await ctx.reply(errorMsg);
          }
        } catch {
          if (shouldReact()) await ctx.react('❌');
          await ctx.reply('An error occurred while processing the Pinterest media');
        }
      }
    }
  ]
};
