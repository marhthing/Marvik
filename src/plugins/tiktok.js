import TiktokDL from '@tobyg74/tiktok-api-dl';
import axios from 'axios';
import { shouldReact } from '../utils/pendingActions.js';
import { getQuotedMessageObject } from '../utils/messageUtils.js';
import { formatFileSize, promptNumericSelection, sendVideoBuffer } from '../utils/downloadFlow.js';

const VIDEO_SIZE_LIMIT = 100 * 1024 * 1024;
const VIDEO_MEDIA_LIMIT = 30 * 1024 * 1024;

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0'
];

const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
const humanDelay = (min = 1000, max = 3000) => {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, delay));
};

function isValidTikTokUrl(url) {
  const tiktokPatterns = [
    /tiktok\.com\/@[\w.-]+\/video\/\d+/,
    /vm\.tiktok\.com\/[\w-]+/,
    /vt\.tiktok\.com\/[\w-]+/,
    /tiktok\.com\/t\/[\w-]+/,
    /tiktok\.com\/v\/\d+/
  ];
  return tiktokPatterns.some(pattern => pattern.test(url));
}

function extractTikTokUrlFromObject(obj) {
  const tiktokRegex = /https?:\/\/(?:vm\.|vt\.|www\.)?tiktok\.com\/(?:@[\w.-]+\/video\/\d+|t\/[\w-]+|v\/\d+|[\w-]+)/i;
  if (!obj || typeof obj !== 'object') return null;

  for (const key in obj) {
    if (typeof obj[key] === 'string') {
      const match = obj[key].match(tiktokRegex);
      if (match) return match[0];
    } else if (typeof obj[key] === 'object') {
      const found = extractTikTokUrlFromObject(obj[key]);
      if (found) return found;
    }
  }
  return null;
}

async function getFileSize(url) {
  try {
    const head = await axios.head(url, {
      timeout: 10000,
      headers: { 'User-Agent': getRandomUserAgent() }
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
      'User-Agent': getRandomUserAgent(),
      Referer: 'https://www.tiktok.com/'
    }
  });
  return Buffer.from(response.data);
}

async function deliverTikTokVideo(ctx, url) {
  const videoBuffer = await downloadMediaToBuffer(url);
  await sendVideoBuffer(ctx, videoBuffer, {
    sizeLimit: VIDEO_SIZE_LIMIT,
    mediaLimit: VIDEO_MEDIA_LIMIT,
    limitLabel: '100MB',
    caption: 'TikTok video'
  });
}

function buildQualityOptions(videoData) {
  const qualities = [];
  let index = 1;

  const pushQuality = async (label, url) => {
    const size = await getFileSize(url);
    qualities.push({
      label: `${index} - ${label}${size ? ` (${formatFileSize(size)})` : ''}`,
      url
    });
    index += 1;
  };

  return (async () => {
    if (videoData.video) {
      if (videoData.video.noWatermark) {
        await pushQuality('HD No Watermark', videoData.video.noWatermark);
      }
      if (Array.isArray(videoData.video.playAddr)) {
        for (const addr of videoData.video.playAddr) {
          await pushQuality(`Quality ${index}`, addr);
        }
      }
      if (videoData.video.watermark && qualities.length === 0) {
        await pushQuality('With Watermark', videoData.video.watermark);
      }
    }

    if (videoData.video_data) {
      if (videoData.video_data.nwm_video_url_HQ) {
        await pushQuality('HD No Watermark', videoData.video_data.nwm_video_url_HQ);
      }
      if (videoData.video_data.nwm_video_url) {
        await pushQuality('SD No Watermark', videoData.video_data.nwm_video_url);
      }
      if (videoData.video_data.wm_video_url && qualities.length === 0) {
        await pushQuality('With Watermark', videoData.video_data.wm_video_url);
      }
    }

    if (videoData.play) {
      await pushQuality('Standard', videoData.play);
    }

    return qualities;
  })();
}

export default {
  name: 'tiktok',
  description: 'TikTok video downloader with quality selection',
  version: '2.1.0',
  author: 'MATDEV',
  commands: [
    {
      name: 'tiktok',
      aliases: ['tt', 'tik'],
      description: 'Download TikTok video without watermark',
      usage: '.tiktok <url>',
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
              url = extractTikTokUrlFromObject(quotedMessage) || '';
            }
          }

          if (!url) {
            return await ctx.reply('Please provide a TikTok URL or reply to a message containing one\n\nUsage: .tiktok <url>');
          }

          if (!isValidTikTokUrl(url)) {
            return await ctx.reply('Invalid TikTok URL. Please provide a valid TikTok video link.');
          }

          if (shouldReact()) await ctx.react('⏳');
          await humanDelay(800, 1500);

          let videoData = null;
          for (const version of ['v2', 'v1', 'v3']) {
            try {
              await humanDelay(500, 1000);
              const result = await TiktokDL.Downloader(url, { version });
              if (result?.status === 'success' && result.result) {
                videoData = result.result;
                break;
              }
            } catch {}
          }

          if (!videoData) {
            if (shouldReact()) await ctx.react('❌');
            return await ctx.reply('Failed to fetch TikTok video. Please try again later.');
          }

          const qualities = await buildQualityOptions(videoData);
          if (qualities.length === 0) {
            if (shouldReact()) await ctx.react('❌');
            return await ctx.reply('No downloadable video found.');
          }

          if (qualities.length === 1) {
            await deliverTikTokVideo(ctx, qualities[0].url);
            if (shouldReact()) await ctx.react('✅');
            return;
          }

          let prompt = 'Select video quality by replying with the number:\n';
          prompt += qualities.map(choice => choice.label).join('\n');

          await promptNumericSelection(ctx, {
            type: 'tiktok_quality',
            prompt,
            choices: qualities,
            handler: async (replyCtx, selected) => {
              if (shouldReact()) await replyCtx.react('⏳');
              try {
                await deliverTikTokVideo(replyCtx, selected.url);
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
        } catch (error) {
          console.error('TikTok error:', error);
          if (shouldReact()) await ctx.react('❌');
          await ctx.reply('An error occurred while processing the TikTok video. Please try again.\n' + (error && error.message ? error.message : error));
        }
      }
    }
  ]
};
