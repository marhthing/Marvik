import { instagramGetUrl } from 'instagram-url-direct';
import axios from 'axios';
import { shouldReact } from '../utils/pendingActions.js';
import { getQuotedMessageObject } from '../utils/messageUtils.js';
import { formatFileSize, promptNumericSelection, sendImageBuffer, sendVideoBuffer } from '../utils/downloadFlow.js';

const VIDEO_SIZE_LIMIT = 2 * 1024 * 1024 * 1024;
const VIDEO_MEDIA_LIMIT = 30 * 1024 * 1024;

function validateInstagramUrl(url) {
  const igUrlRegex = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/;
  if (!url || typeof url !== 'string') return null;

  const cleanUrl = url.trim();
  const match = igUrlRegex.exec(cleanUrl);

  if (!match) return null;

  return {
    url: cleanUrl.startsWith('http') ? cleanUrl : `https://${cleanUrl}`,
    shortcode: match[1]
  };
}

function extractInstagramUrlFromObject(obj) {
  const igUrlRegex = /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[a-zA-Z0-9_-]+/i;
  if (!obj || typeof obj !== 'object') return null;

  for (const key in obj) {
    if (typeof obj[key] === 'string') {
      const match = obj[key].match(igUrlRegex);
      if (match) return match[0].replace(/[.,;!?"]+$/, '');
    } else if (typeof obj[key] === 'object') {
      const found = extractInstagramUrlFromObject(obj[key]);
      if (found) return found;
    }
  }
  return null;
}

async function getFileSize(url) {
  try {
    const head = await axios.head(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    return head.headers['content-length'] ? parseInt(head.headers['content-length'], 10) : 0;
  } catch {
    return 0;
  }
}

async function downloadMediaToBuffer(mediaUrl) {
  const response = await axios.get(mediaUrl, {
    responseType: 'arraybuffer',
    timeout: 120000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    }
  });
  return Buffer.from(response.data);
}

async function sendInstagramItem(ctx, item) {
  const mediaBuffer = await downloadMediaToBuffer(item.url);
  if (item.isVideo) {
    await sendVideoBuffer(ctx, mediaBuffer, {
      sizeLimit: VIDEO_SIZE_LIMIT,
      mediaLimit: VIDEO_MEDIA_LIMIT,
      limitLabel: '2GB',
      caption: item.caption
    });
    return;
  }

  await sendImageBuffer(ctx, mediaBuffer);
}

export default {
  name: 'instagram',
  description: 'Instagram media downloader with quality selection',
  version: '2.1.0',
  author: 'MATDEV',
  commands: [
    {
      name: 'ig',
      aliases: ['instagram', 'insta'],
      description: 'Download Instagram media (post/reel/video)',
      usage: '.ig <url>',
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
              url = extractInstagramUrlFromObject(quotedMessage) || '';
            }
          }

          if (!url) {
            return await ctx.reply('Please provide an Instagram URL\n\nUsage: .ig <url>\n\nSupported: Posts, Reels, Videos');
          }

          const validatedUrl = validateInstagramUrl(url);
          if (!validatedUrl) {
            return await ctx.reply('Please provide a valid Instagram URL (post/reel/video)');
          }

          if (shouldReact()) await ctx.react('⏳');

          try {
            const data = await instagramGetUrl(validatedUrl.url);
            if (!data?.url_list?.length) {
              if (shouldReact()) await ctx.react('❌');
              return await ctx.reply('Could not fetch media. The post may be private or unavailable.');
            }

            const mediaItems = data.url_list.slice(0, 10).map((mediaUrl, index) => {
              const mediaDetail = data.media_details?.[index];
              const isVideo = mediaDetail?.type === 'video';
              return {
                url: mediaUrl,
                isVideo,
                caption: isVideo ? 'Instagram video' : undefined
              };
            });

            if (mediaItems.length === 1) {
              const single = mediaItems[0];
              const size = await getFileSize(single.url);
              single.caption = single.isVideo && size ? `Instagram video (${formatFileSize(size)})` : single.caption;
              await sendInstagramItem(ctx, single);
              if (shouldReact()) await ctx.react('✅');
              return;
            }

            const choices = [];
            for (let index = 0; index < mediaItems.length; index += 1) {
              const item = mediaItems[index];
              const size = await getFileSize(item.url);
              choices.push({
                label: `${index + 1} - ${item.isVideo ? 'Video' : 'Image'} #${index + 1}${size ? ` (${formatFileSize(size)})` : ''}`,
                ...item
              });
            }

            choices.push({
              label: `${choices.length + 1} - Download All`,
              downloadAll: true
            });

            let prompt = `Found ${data.results_number || data.url_list.length} media items. Select option:\n`;
            prompt += choices.map(choice => choice.label).join('\n');

            await promptNumericSelection(ctx, {
              type: 'instagram_quality',
              prompt,
              choices,
              handler: async (replyCtx, selected) => {
                if (shouldReact()) await replyCtx.react('⏳');
                try {
                  if (selected.downloadAll) {
                    for (const item of mediaItems) {
                      await sendInstagramItem(replyCtx, item);
                      await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                  } else {
                    await sendInstagramItem(replyCtx, selected);
                  }
                  if (shouldReact()) await replyCtx.react('✅');
                } catch (error) {
                  if (shouldReact()) await replyCtx.react('❌');
                  const message = error.message?.includes('Video too large')
                    ? error.message
                    : 'Failed to download selected media.';
                  await replyCtx.reply(message);
                }
                return true;
              }
            });
          } catch (error) {
            if (shouldReact()) await ctx.react('❌');

            let errorMsg = 'Download failed. ';
            if (error.message?.includes('private')) {
              errorMsg += 'This post may be private.';
            } else if (error.message?.includes('not found')) {
              errorMsg += 'Post not found or deleted.';
            } else {
              errorMsg += 'Please try again later or check if the post is available.';
            }
            await ctx.reply(errorMsg);
          }
        } catch {
          if (shouldReact()) await ctx.react('❌');
          await ctx.reply('An error occurred while processing the Instagram media');
        }
      }
    }
  ]
};
