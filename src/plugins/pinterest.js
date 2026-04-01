import { reactIfEnabled } from '../utils/pendingActions.js';
import { getQuotedMessageObject } from '../utils/messageUtils.js';
import {
  attemptChoiceWithFallback,
  formatFileSize,
  promptNumericSelection,
  reactPendingOrigin,
  sendImageBuffer,
  sendVideoBuffer,
  validateVideoBuffer,
  withDelayedNotice
} from '../utils/downloadFlow.js';
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
  await validateVideoBuffer(buffer);
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
  version: '2.3.1',
  author: 'Are Martins',
  commands: [
    {
      name: 'pinterest',
      aliases: ['pinsrc', 'pint'],
      description: 'Download Pinterest media (image/video) with quality selection',
      usage: '.pinterest <pin url>',
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
            return await ctx.reply('Please provide a Pinterest URL\n\nUsage: .pinterest <pin url>');
          }

          const validatedUrl = await validatePinterestUrl(url);
          if (validatedUrl?.failedShortLink) {
            return await ctx.reply('This Pinterest short link could not be resolved by Pinterest. Open it in your browser and copy the full pin URL, then send that instead.');
          }
          if (!validatedUrl) {
            return await ctx.reply('Please provide a valid Pinterest URL (pin.it or pinterest.com/pin/).');
          }

          await reactIfEnabled(ctx, '⏳');

          try {
            const mediaInfo = await withDelayedNotice(ctx, () => getPinterestMediaInfo(validatedUrl.url));

            if (mediaInfo.isVideo) {
              const videoQualities = mediaInfo.videoQualities.filter((item) => !item.url.includes('.m3u8'));
              if (videoQualities.length === 0) {
                await reactIfEnabled(ctx, '❌');
                return await ctx.reply('No downloadable video found (only streaming formats available).');
              }

              const choices = [];
              for (let index = 0; index < videoQualities.length; index += 1) {
                const quality = videoQualities[index];
                const size = await getPinterestFileSize(quality.url);
                let label = quality.quality;
                if (quality.height > 0) label = `${quality.height}p`;
                choices.push({
                  label: `${index + 1} - ${label}${size ? ` (${formatFileSize(size)})` : ''}`,
                  url: quality.url,
                  height: quality.height || 0
                });
              }

              if (choices.length === 0) {
                await reactIfEnabled(ctx, '❌');
                return await ctx.reply('No working downloadable video quality was found.');
              }

              if (choices.length === 1) {
                await sendPinterestVideo(ctx, choices[0].url);
                await reactIfEnabled(ctx, '✅');
                return;
              }

              let prompt = '*Pinterest Video Found!*\n\nSelect quality by replying with the number:\n';
              prompt += choices.map((choice) => choice.label).join('\n');

              await promptNumericSelection(ctx, {
                type: 'pinterest_quality',
                prompt,
                choices,
                handler: async (replyCtx, selected, choice, pending) => {
                  await reactIfEnabled(replyCtx, '⏳');
                  try {
                    await withDelayedNotice(replyCtx, () => attemptChoiceWithFallback({
                      choices: pending.data.choices,
                      selectedIndex: choice - 1,
                      attempt: async (fallbackChoice) => {
                        await sendPinterestVideo(replyCtx, fallbackChoice.url);
                      }
                    }));
                    await reactIfEnabled(replyCtx, '✅');
                    await reactPendingOrigin(replyCtx, pending, '✅');
                  } catch (error) {
                    await reactIfEnabled(replyCtx, '❌');
                    await reactPendingOrigin(replyCtx, pending, '❌');
                    const message = error.message?.includes('Video too large') || error.message?.includes('All quality options failed')
                      ? error.message
                      : 'Failed to download all available qualities.';
                    await replyCtx.reply(message);
                  }
                  return true;
                }
              });
              return;
            }

            const imageQualities = mediaInfo.imageQualities;
            if (imageQualities.length === 0) {
              await reactIfEnabled(ctx, '❌');
              return await ctx.reply('No downloadable image found.');
            }

            if (imageQualities.length === 1) {
              await sendPinterestImage(ctx, imageQualities[0].url);
              await reactIfEnabled(ctx, '✅');
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
            prompt += choices.map((choice) => choice.label).join('\n');

            await promptNumericSelection(ctx, {
              type: 'pinterest_quality',
              prompt,
              choices,
              handler: async (replyCtx, selected, _choice, pending) => {
                await reactIfEnabled(replyCtx, '⏳');
                try {
                  await sendPinterestImage(replyCtx, selected.url);
                  await reactIfEnabled(replyCtx, '✅');
                  await reactPendingOrigin(replyCtx, pending, '✅');
                } catch {
                  await reactIfEnabled(replyCtx, '❌');
                  await reactPendingOrigin(replyCtx, pending, '❌');
                  await replyCtx.reply('Failed to download selected quality.');
                }
                return true;
              }
            });
          } catch (error) {
            await reactIfEnabled(ctx, '❌');
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
          await reactIfEnabled(ctx, '❌');
          await ctx.reply('An error occurred while processing the Pinterest media');
        }
      }
    }
  ]
};
