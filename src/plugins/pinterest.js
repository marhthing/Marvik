import axios from 'axios';
import { shouldReact } from '../utils/pendingActions.js';
import { getQuotedMessageObject } from '../utils/messageUtils.js';
import { formatFileSize, promptNumericSelection, sendImageBuffer, sendVideoBuffer } from '../utils/downloadFlow.js';

const VIDEO_SIZE_LIMIT = 2 * 1024 * 1024 * 1024;
const VIDEO_MEDIA_LIMIT = 16 * 1024 * 1024;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  Referer: 'https://www.pinterest.com/',
  DNT: '1',
  Connection: 'keep-alive'
};

async function getFileSize(url) {
  try {
    const head = await axios.head(url, {
      timeout: 10000,
      headers: HEADERS
    });
    return head.headers['content-length'] ? parseInt(head.headers['content-length'], 10) : 0;
  } catch {
    return 0;
  }
}

async function validatePinterestUrl(url) {
  const pinterestUrlRegex = /(?:https?:\/\/)?(?:www\.)?(?:pinterest\.com\/pin\/|pin\.it\/)([a-zA-Z0-9_-]+)/;
  if (!url || typeof url !== 'string') return null;

  let cleanUrl = url.trim();
  try {
    if (cleanUrl.includes('pin.it')) {
      if (!cleanUrl.startsWith('http')) cleanUrl = `https://${cleanUrl}`;
      const response = await axios.get(cleanUrl, {
        headers: HEADERS,
        maxRedirects: 5,
        validateStatus: () => true
      });
      cleanUrl = response.request.res.responseUrl || cleanUrl;
    }

    const match = pinterestUrlRegex.exec(cleanUrl);
    if (!match) return null;

    return {
      url: cleanUrl.startsWith('http') ? cleanUrl : `https://${cleanUrl}`,
      pinId: match[1]
    };
  } catch {
    return null;
  }
}

function extractAllJsonData(html) {
  const jsonBlocks = [];
  const pwsMatch = html.match(/<script[^>]*id="__PWS_DATA__"[^>]*>(.*?)<\/script>/s);
  if (pwsMatch?.[1]) {
    try { jsonBlocks.push(JSON.parse(pwsMatch[1])); } catch {}
  }

  const scriptMatches = html.matchAll(/<script[^>]*type="application\/json"[^>]*>(.*?)<\/script>/gs);
  for (const match of scriptMatches) {
    try { jsonBlocks.push(JSON.parse(match[1])); } catch {}
  }
  return jsonBlocks;
}

function findVideoQualities(obj, depth = 0) {
  if (depth > 10 || !obj || typeof obj !== 'object') return [];
  const qualities = [];

  if (obj.video_list && typeof obj.video_list === 'object') {
    const qualityOrder = ['V_720P', 'V_480P', 'V_360P', 'V_HLSV4', 'V_HLSV3_MOBILE', 'V_EXP7', 'V_EXP6', 'V_EXP5'];
    for (const quality of qualityOrder) {
      if (obj.video_list[quality]?.url) {
        let label = quality.replace('V_', '').replace('P', 'p');
        if (label.includes('HLS')) label = 'HLS Stream';
        if (label.includes('EXP')) label = 'Standard';
        qualities.push({
          quality: label,
          url: obj.video_list[quality].url,
          width: obj.video_list[quality].width || 0,
          height: obj.video_list[quality].height || 0
        });
      }
    }

    if (qualities.length === 0) {
      for (const key in obj.video_list) {
        if (obj.video_list[key]?.url) {
          qualities.push({
            quality: key.replace('V_', '').replace('P', 'p'),
            url: obj.video_list[key].url,
            width: obj.video_list[key].width || 0,
            height: obj.video_list[key].height || 0
          });
        }
      }
    }
  }

  if (qualities.length > 0) return qualities;
  for (const key in obj) {
    if (typeof obj[key] === 'object') {
      const result = findVideoQualities(obj[key], depth + 1);
      if (result.length > 0) return result;
    }
  }
  return [];
}

function findImageQualities(obj, depth = 0) {
  if (depth > 10 || !obj || typeof obj !== 'object') return [];
  const qualities = [];

  if (obj.images && typeof obj.images === 'object') {
    const qualityOrder = ['orig', '1200x', '736x', '564x', '474x', '236x', '170x'];
    for (const quality of qualityOrder) {
      if (obj.images[quality]?.url) {
        qualities.push({
          quality: quality === 'orig' ? 'Original' : quality,
          url: obj.images[quality].url,
          width: obj.images[quality].width || 0,
          height: obj.images[quality].height || 0
        });
      }
    }
  }

  if (qualities.length > 0) return qualities;
  for (const key in obj) {
    if (typeof obj[key] === 'object') {
      const result = findImageQualities(obj[key], depth + 1);
      if (result.length > 0) return result;
    }
  }
  return [];
}

function extractPinterestUrlFromObject(obj) {
  const urlRegex = /https?:\/\/(?:www\.)?(?:pinterest\.com\/pin\/|pin\.it\/)[a-zA-Z0-9_-]+/i;
  if (!obj || typeof obj !== 'object') return null;
  for (const key in obj) {
    if (typeof obj[key] === 'string') {
      const match = obj[key].match(urlRegex);
      if (match) return match[0];
    } else if (typeof obj[key] === 'object') {
      const found = extractPinterestUrlFromObject(obj[key]);
      if (found) return found;
    }
  }
  return null;
}

async function getPinterestMediaInfo(url) {
  const response = await axios.get(url, { headers: HEADERS, timeout: 30000 });
  const html = response.data;
  const jsonBlocks = extractAllJsonData(html);

  let videoQualities = [];
  let imageQualities = [];

  for (const jsonData of jsonBlocks) {
    videoQualities = findVideoQualities(jsonData);
    if (videoQualities.length > 0) break;
  }

  if (videoQualities.length === 0) {
    for (const jsonData of jsonBlocks) {
      imageQualities = findImageQualities(jsonData);
      if (imageQualities.length > 0) break;
    }
  }

  if (videoQualities.length === 0 && imageQualities.length === 0) {
    const videoPatterns = [
      /"url":"(https:\/\/[^"]*\.mp4[^"]*)"/,
      /"V_720P":\{"url":"([^"]+)"/,
      /"video_list":[^}]*"url":"([^"]+\.mp4[^"]*)"/
    ];
    for (const pattern of videoPatterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        const videoUrl = match[1].replace(/\\u002F/g, '/').replace(/\\/g, '');
        videoQualities.push({ quality: 'Standard', url: videoUrl, width: 0, height: 0 });
        break;
      }
    }

    if (videoQualities.length === 0) {
      const imagePatterns = [
        /"url":"(https:\/\/i\.pinimg\.com\/originals\/[^"]+)"/,
        /"orig":\{"url":"([^"]+)"/
      ];
      for (const pattern of imagePatterns) {
        const match = html.match(pattern);
        if (match?.[1]) {
          const imageUrl = match[1].replace(/\\u002F/g, '/').replace(/\\/g, '');
          imageQualities.push({ quality: 'Original', url: imageUrl, width: 0, height: 0 });
          break;
        }
      }
    }
  }

  if (videoQualities.length === 0 && imageQualities.length === 0) {
    throw new Error('Could not extract media URL from Pinterest page');
  }

  return {
    isVideo: videoQualities.length > 0,
    videoQualities,
    imageQualities
  };
}

async function downloadMediaToBuffer(mediaUrl) {
  const response = await axios.get(mediaUrl, {
    responseType: 'arraybuffer',
    timeout: 120000,
    headers: HEADERS
  });
  return Buffer.from(response.data);
}

async function sendPinterestVideo(ctx, url) {
  const buffer = await downloadMediaToBuffer(url);
  await sendVideoBuffer(ctx, buffer, {
    sizeLimit: VIDEO_SIZE_LIMIT,
    mediaLimit: VIDEO_MEDIA_LIMIT,
    limitLabel: '2GB',
    caption: 'Pinterest video'
  });
}

async function sendPinterestImage(ctx, url) {
  const buffer = await downloadMediaToBuffer(url);
  await sendImageBuffer(ctx, buffer);
}

export default {
  name: 'pinterest',
  description: 'Pinterest media downloader with quality selection',
  version: '2.1.0',
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
                const size = await getFileSize(quality.url);
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
              const size = await getFileSize(quality.url);
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
