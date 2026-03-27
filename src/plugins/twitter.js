import { TwitterDL } from 'twitter-downloader';
import axios from 'axios';
import { shouldReact } from '../utils/pendingActions.js';
import { getQuotedMessageObject } from '../utils/messageUtils.js';
import { formatFileSize, promptNumericSelection, sendImageBuffer, sendVideoBuffer } from '../utils/downloadFlow.js';

const VIDEO_SIZE_LIMIT = 100 * 1024 * 1024;
const VIDEO_MEDIA_LIMIT = 30 * 1024 * 1024;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://twitter.com/'
};

function validateTwitterUrl(url) {
  const twitterUrlRegex = /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/(?:\w+)\/status\/(\d+)/;
  if (!url || typeof url !== 'string') return null;
  const cleanUrl = url.trim();
  const match = twitterUrlRegex.exec(cleanUrl);
  if (!match) return null;
  const normalizedUrl = (cleanUrl.startsWith('http') ? cleanUrl : `https://${cleanUrl}`).replace('x.com', 'twitter.com');
  return { url: normalizedUrl, tweetId: match[1] };
}

function extractTwitterUrlFromObject(obj) {
  const twitterUrlRegex = /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/\w+\/status\/\d+/i;
  if (!obj || typeof obj !== 'object') return null;
  for (const key in obj) {
    if (typeof obj[key] === 'string') {
      const match = obj[key].match(twitterUrlRegex);
      if (match) return match[0].replace(/[.,;!?"]+$/, '');
    } else if (typeof obj[key] === 'object') {
      const found = extractTwitterUrlFromObject(obj[key]);
      if (found) return found;
    }
  }
  return null;
}

async function getFileSize(url) {
  try {
    const head = await axios.head(url, { timeout: 10000, headers: HEADERS });
    return head.headers['content-length'] ? parseInt(head.headers['content-length'], 10) : 0;
  } catch {
    return 0;
  }
}

async function downloadMediaToBuffer(mediaUrl) {
  const response = await axios.get(mediaUrl, {
    responseType: 'arraybuffer',
    timeout: 120000,
    headers: HEADERS
  });
  return Buffer.from(response.data);
}

async function sendTwitterVideo(ctx, url) {
  const buffer = await downloadMediaToBuffer(url);
  await sendVideoBuffer(ctx, buffer, {
    sizeLimit: VIDEO_SIZE_LIMIT,
    mediaLimit: VIDEO_MEDIA_LIMIT,
    limitLabel: '100MB',
    caption: 'Twitter video'
  });
}

async function sendTwitterImage(ctx, url) {
  const buffer = await downloadMediaToBuffer(url);
  await sendImageBuffer(ctx, buffer);
}

export default {
  name: 'twitter',
  description: 'Twitter/X video and image downloader with quality selection',
  version: '1.1.0',
  author: 'MATDEV',
  commands: [
    {
      name: 'twitter',
      aliases: ['tw', 'x', 'tweet'],
      description: 'Download Twitter/X media',
      usage: '.twitter <url>',
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
              url = extractTwitterUrlFromObject(quotedMessage) || '';
            }
          }

          if (!url) {
            return await ctx.reply('Please provide a Twitter/X URL\n\nUsage: .twitter <url> or .x <url>');
          }

          const validatedUrl = validateTwitterUrl(url);
          if (!validatedUrl) {
            return await ctx.reply('Please provide a valid Twitter/X URL');
          }

          if (shouldReact()) await ctx.react('⏳');

          try {
            const result = await TwitterDL(validatedUrl.url);
            if (!result || result.status !== 'success' || !result.result) {
              if (shouldReact()) await ctx.react('❌');
              return await ctx.reply('Could not fetch media. The tweet may be private or unavailable.');
            }

            const data = result.result;
            const media = data.media || [];
            if (media.length === 0) {
              if (shouldReact()) await ctx.react('❌');
              return await ctx.reply('No media found in this tweet.');
            }

            const videos = media.filter(item => item.type === 'video' || item.type === 'gif');
            const images = media.filter(item => item.type === 'photo');

            if (videos.length > 0) {
              const variants = (videos[0].videos || []).filter(variant => variant.url);
              if (variants.length === 0) {
                if (shouldReact()) await ctx.react('❌');
                return await ctx.reply('No downloadable video found.');
              }

              const sortedVariants = variants
                .filter(variant => variant.bitrate !== undefined)
                .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

              if (sortedVariants.length === 0) {
                await sendTwitterVideo(ctx, variants[0].url);
                if (shouldReact()) await ctx.react('✅');
                return;
              }

              const choices = [];
              for (let index = 0; index < sortedVariants.length; index += 1) {
                const variant = sortedVariants[index];
                const size = await getFileSize(variant.url);
                let qualityLabel = 'Standard';
                if ((variant.bitrate || 0) >= 2000000) qualityLabel = '1080p HD';
                else if ((variant.bitrate || 0) >= 1000000) qualityLabel = '720p HD';
                else if ((variant.bitrate || 0) >= 500000) qualityLabel = '480p';
                else if ((variant.bitrate || 0) >= 200000) qualityLabel = '360p';
                else qualityLabel = 'Low';
                choices.push({
                  label: `${index + 1} - ${qualityLabel}${size ? ` (${formatFileSize(size)})` : ''}`,
                  url: variant.url
                });
              }

              if (choices.length === 1) {
                await sendTwitterVideo(ctx, choices[0].url);
                if (shouldReact()) await ctx.react('✅');
                return;
              }

              let prompt = '';
              if (data.description) {
                prompt += `*${data.description.substring(0, 100)}${data.description.length > 100 ? '...' : ''}*\n\n`;
              }
              prompt += 'Select video quality by replying with the number:\n';
              prompt += choices.map(choice => choice.label).join('\n');

              await promptNumericSelection(ctx, {
                type: 'twitter_quality',
                prompt,
                choices,
                handler: async (replyCtx, selected) => {
                  if (shouldReact()) await replyCtx.react('⏳');
                  try {
                    await sendTwitterVideo(replyCtx, selected.url);
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

            if (images.length > 0) {
              if (images.length === 1) {
                await sendTwitterImage(ctx, images[0].url);
                if (shouldReact()) await ctx.react('✅');
                return;
              }

              const choices = images.map((image, index) => ({
                label: `${index + 1} - Image #${index + 1}`,
                url: image.url
              }));
              choices.push({
                label: `${images.length + 1} - Download All`,
                downloadAll: true
              });

              let prompt = `Found ${images.length} images. Select option:\n`;
              prompt += choices.map(choice => choice.label).join('\n');

              await promptNumericSelection(ctx, {
                type: 'twitter_images',
                prompt,
                choices,
                handler: async (replyCtx, selected) => {
                  if (shouldReact()) await replyCtx.react('⏳');
                  try {
                    if (selected.downloadAll) {
                      for (const image of images) {
                        await sendTwitterImage(replyCtx, image.url);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                      }
                    } else {
                      await sendTwitterImage(replyCtx, selected.url);
                    }
                    if (shouldReact()) await replyCtx.react('✅');
                  } catch {
                    if (shouldReact()) await replyCtx.react('❌');
                    await replyCtx.reply('Failed to download selected media.');
                  }
                  return true;
                }
              });
              return;
            }

            if (shouldReact()) await ctx.react('❌');
            await ctx.reply('No downloadable media found in this tweet.');
          } catch (error) {
            if (shouldReact()) await ctx.react('❌');
            let errorMsg = 'Download failed. ';
            if (error.message?.includes('private')) {
              errorMsg += 'This tweet may be private.';
            } else if (error.message?.includes('not found')) {
              errorMsg += 'Tweet not found or deleted.';
            } else {
              errorMsg += 'Please try again later.';
            }
            await ctx.reply(errorMsg);
          }
        } catch {
          if (shouldReact()) await ctx.react('❌');
          await ctx.reply('An error occurred while processing Twitter media');
        }
      }
    }
  ]
};
