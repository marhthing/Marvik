import youtubedl from 'youtube-dl-exec';
import fs from 'fs-extra';
import path from 'path';
import { shouldReact } from '../utils/pendingActions.js';
import { getQuotedMessageObject } from '../utils/messageUtils.js';
import { formatFileSize, promptNumericSelection, sendVideoFile } from '../utils/downloadFlow.js';

const VIDEO_SIZE_LIMIT = 100 * 1024 * 1024;
const VIDEO_MEDIA_LIMIT = 30 * 1024 * 1024;

const PROXIES = (process.env.PROXIES || '').split(',').filter(p => p.trim());
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

function getRandomProxy() {
  return PROXIES.length > 0 ? PROXIES[Math.floor(Math.random() * PROXIES.length)] : null;
}

const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

function getDownloadOptions(extra = {}) {
  const proxy = getRandomProxy();
  const options = {
    noWarnings: true,
    noCheckCertificates: true,
    retries: 3,
    socketTimeout: 30,
    addHeader: [
      'referer:https://www.facebook.com/',
      `user-agent:${getRandomUserAgent()}`,
      'accept-language:en-US,en;q=0.9'
    ],
    ...extra
  };
  if (proxy) options.proxy = proxy;
  return options;
}

function generateUniqueFilename(prefix = 'fb', extension = 'mp4') {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${random}.${extension}`;
}

function isValidFacebookUrl(url) {
  const fbPatterns = [
    /(?:https?:\/\/)?(?:www\.|m\.|web\.|mobile\.)?(?:facebook|fb)\.(?:com|watch)\/(?:watch\/?\?v=|[\w.-]+\/videos\/|video\.php\?v=|.*?\/videos\/|reel\/|share\/[rv]\/)/i,
    /fb\.watch\/[\w-]+/i
  ];
  return fbPatterns.some(pattern => pattern.test(url));
}

function extractFacebookUrlFromObject(obj) {
  const fbRegex = /https?:\/\/(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.watch|fb\.com)\/[^\s"'<>]+/i;
  if (!obj || typeof obj !== 'object') return null;

  for (const key in obj) {
    if (typeof obj[key] === 'string') {
      const match = obj[key].match(fbRegex);
      if (match) return match[0].replace(/[.,;!?"]+$/, '');
    } else if (typeof obj[key] === 'object') {
      const found = extractFacebookUrlFromObject(obj[key]);
      if (found) return found;
    }
  }
  return null;
}

async function getVideoFormatsWithYtDlp(url) {
  try {
    const info = await youtubedl(url, getDownloadOptions({ dumpSingleJson: true }));
    if (!info) return null;

    const formats = [];
    const seenQualities = new Set();

    if (info.formats) {
      for (const format of info.formats) {
        if (!format.url && !format.fragments) continue;
        if (!format.vcodec || format.vcodec === 'none') continue;

        const height = format.height || 0;
        let quality = 'SD';
        if (height >= 1080) quality = '1080p HD';
        else if (height >= 720) quality = '720p HD';
        else if (height >= 480) quality = '480p';
        else if (height >= 360) quality = '360p';

        if (seenQualities.has(quality)) continue;

        seenQualities.add(quality);
        const size = format.filesize || format.filesize_approx || 0;
        formats.push({
          quality,
          height,
          size,
          formatString: height > 0 ? `best[height<=${height}][ext=mp4]/best[ext=mp4]/best` : 'best[ext=mp4]/best'
        });
      }
    }

    formats.sort((a, b) => b.height - a.height);

    return {
      formats: formats.slice(0, 5),
      title: info.title || 'Facebook Video',
      duration: info.duration ? `${Math.floor(info.duration / 60)}:${String(Math.floor(info.duration % 60)).padStart(2, '0')}` : ''
    };
  } catch {
    return null;
  }
}

async function downloadVideoWithYtDlp(url, formatString, tempDir) {
  const outputPath = path.join(tempDir, generateUniqueFilename('fb_video', 'mp4'));

  try {
    await youtubedl(url, getDownloadOptions({
      output: outputPath,
      format: formatString || 'best[ext=mp4]/best'
    }));

    if (!(await fs.pathExists(outputPath))) {
      throw new Error('Download failed: file not created');
    }

    const stats = await fs.stat(outputPath);
    if (stats.size < 1000) {
      await fs.unlink(outputPath).catch(() => {});
      throw new Error('Downloaded file is too small, likely invalid');
    }

    return { path: outputPath, size: stats.size };
  } catch (error) {
    if (await fs.pathExists(outputPath)) {
      await fs.unlink(outputPath).catch(() => {});
    }
    throw error;
  }
}

async function deliverFacebookVideo(ctx, url, formatString, tempDir) {
  const result = await downloadVideoWithYtDlp(url, formatString, tempDir);
  try {
    await sendVideoFile(ctx, result.path, {
      size: result.size,
      sizeLimit: VIDEO_SIZE_LIMIT,
      mediaLimit: VIDEO_MEDIA_LIMIT,
      limitLabel: '100MB',
      caption: 'Facebook video'
    });
  } finally {
    await fs.unlink(result.path).catch(() => {});
  }
}

export default {
  name: 'facebook',
  description: 'Facebook video downloader with quality selection',
  version: '3.1.0',
  author: 'MATDEV',
  commands: [
    {
      name: 'fb',
      aliases: ['facebook', 'fbdl'],
      description: 'Download Facebook videos with quality selection',
      usage: '.fb <url>',
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
              url = extractFacebookUrlFromObject(quotedMessage) || '';
            }
          }

          if (!url) {
            return await ctx.reply('Please provide a Facebook video URL\n\nUsage: .fb <url>\n\nSupported: Videos, Reels, Watch');
          }

          if (!isValidFacebookUrl(url)) {
            return await ctx.reply('Invalid Facebook URL. Please provide a valid Facebook video/reel link.');
          }

          const tempDir = path.join(process.cwd(), 'tmp');
          await fs.ensureDir(tempDir);

          if (shouldReact()) await ctx.react('⏳');

          try {
            const videoData = await getVideoFormatsWithYtDlp(url);

            if (!videoData?.formats?.length) {
              await deliverFacebookVideo(ctx, url, 'best[ext=mp4]/best', tempDir);
              if (shouldReact()) await ctx.react('✅');
              return;
            }

            const qualities = videoData.formats.map((format, index) => ({
              label: `${index + 1} - ${format.quality}${format.size ? ` (${formatFileSize(format.size)})` : ''}`,
              formatString: format.formatString
            }));

            if (qualities.length === 1) {
              await deliverFacebookVideo(ctx, url, qualities[0].formatString, tempDir);
              if (shouldReact()) await ctx.react('✅');
              return;
            }

            let prompt = '*Facebook Video Found!*\n\n';
            prompt += `*Title:* ${videoData.title}\n`;
            if (videoData.duration) prompt += `*Duration:* ${videoData.duration}\n`;
            prompt += '\n*Select quality by replying with the number:*\n';
            prompt += qualities.map(choice => choice.label).join('\n');

            await promptNumericSelection(ctx, {
              type: 'facebook_quality',
              prompt,
              choices: qualities,
              data: { url, tempDir },
              handler: async (replyCtx, selected, choice, pending) => {
                if (shouldReact()) await replyCtx.react('⏳');

                try {
                  await deliverFacebookVideo(replyCtx, pending.data.url, selected.formatString, pending.data.tempDir);
                  if (shouldReact()) await replyCtx.react('✅');
                } catch (error) {
                  if (shouldReact()) await replyCtx.react('❌');
                  const message = error.message?.includes('Video too large')
                    ? error.message
                    : 'Failed to download selected quality. Please try again.';
                  await replyCtx.reply(message);
                }
                return true;
              }
            });
          } catch {
            if (shouldReact()) await ctx.react('❌');
            await ctx.reply('Could not download video. The video might be private, unavailable, or the link format is not supported.');
          }
        } catch {
          if (shouldReact()) await ctx.react('❌');
          await ctx.reply('An error occurred while processing the Facebook video. Please try again.');
        }
      }
    }
  ]
};
