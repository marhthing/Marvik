import youtubedl from 'youtube-dl-exec';
import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import { reactIfEnabled } from '../utils/pendingActions.js';
import { getQuotedMessageObject } from '../utils/messageUtils.js';
import {
  attemptChoiceWithFallback,
  formatFileSize,
  promptNumericSelection,
  reactPendingOrigin,
  sendVideoFile,
  validateVideoFile,
  withDelayedNotice
} from '../utils/downloadFlow.js';

const VIDEO_SIZE_LIMIT = 100 * 1024 * 1024;
const VIDEO_MEDIA_LIMIT = 30 * 1024 * 1024;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.snapchat.com/',
  DNT: '1',
  Connection: 'keep-alive'
};

function generateUniqueFilename(username, extension = 'mp4') {
  const sanitize = (str) => str.replace(/[^a-z0-9]/gi, '_').substring(0, 30);
  const timestamp = Date.now();
  return `snap_${sanitize(username)}_${timestamp}.${extension}`;
}

async function validateSnapchatUrl(url) {
  const snapchatUrlRegex = /(?:https?:\/\/)?(?:www\.)?snapchat\.com\/(?:@|add\/|t\/|spotlight\/)([a-zA-Z0-9._-]+)(?:\/spotlight\/([a-zA-Z0-9_-]+))?/;
  const shortSnapRegex = /(?:https?:\/\/)?(?:t\.snapchat\.com|story\.snapchat\.com|snapchat\.com\/t\/)\/([a-zA-Z0-9_-]+)/;
  if (!url || typeof url !== 'string') return null;

  let cleanUrl = url.trim();
  try {
    if (shortSnapRegex.test(cleanUrl) || cleanUrl.includes('/t/')) {
      if (!cleanUrl.startsWith('http')) cleanUrl = `https://${cleanUrl}`;
      try {
        const response = await axios.get(cleanUrl, {
          headers: HEADERS,
          maxRedirects: 5,
          validateStatus: () => true
        });
        cleanUrl = response.request.res.responseUrl || cleanUrl;
      } catch {}
    }

    const match = snapchatUrlRegex.exec(cleanUrl);
    if (match) {
      return {
        url: cleanUrl.startsWith('http') ? cleanUrl : `https://www.snapchat.com/@${match[1]}`,
        username: match[1],
        spotlightId: match[2] || null
      };
    }

    if (cleanUrl.includes('snapchat.com')) {
      return { url: cleanUrl, username: 'snap', spotlightId: null };
    }
  } catch {}

  return null;
}

function extractSnapchatUrlFromObject(obj) {
  const snapUrlRegex = /https?:\/\/(?:www\.)?snapchat\.com\/(?:@|add\/|t\/|spotlight\/)[a-zA-Z0-9._-]+(?:\/spotlight\/[a-zA-Z0-9_-]+)?|https?:\/\/(?:t\.snapchat\.com|story\.snapchat\.com|snapchat\.com\/t\/)[a-zA-Z0-9_-]+/i;
  if (!obj || typeof obj !== 'object') return null;

  for (const key in obj) {
    if (typeof obj[key] === 'string') {
      const match = obj[key].match(snapUrlRegex);
      if (match) return match[0].replace(/[.,;!?"]+$/, '');
    } else if (typeof obj[key] === 'object') {
      const found = extractSnapchatUrlFromObject(obj[key]);
      if (found) return found;
    }
  }
  return null;
}

async function downloadWithYtDlp(url) {
  const info = await youtubedl(url, {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificates: true
  });

  const formats = [];
  const seenQualities = new Set();
  for (const format of info.formats || []) {
    if (format.ext !== 'mp4' && format.vcodec === 'none') continue;
    const height = format.height || 0;
    let quality = 'Standard';
    if (height >= 1080) quality = '1080p HD';
    else if (height >= 720) quality = '720p HD';
    else if (height >= 480) quality = '480p';
    else if (height >= 360) quality = '360p';
    else if (height > 0) quality = `${height}p`;

    if (seenQualities.has(quality)) continue;
    seenQualities.add(quality);
    formats.push({
      quality,
      height,
      formatId: format.format_id,
      size: format.filesize || format.filesize_approx || 0
    });
  }

  formats.sort((a, b) => b.height - a.height);

  return {
    formats: formats.slice(0, 5),
    title: info.title || 'Snapchat Video',
    url
  };
}

async function downloadVideoWithFormat(url, formatId, outputPath) {
  try {
    await youtubedl(url, {
      output: outputPath,
      noWarnings: true,
      noCheckCertificates: true,
      format: formatId && formatId !== 'best' ? formatId : 'best[ext=mp4]/best'
    });

    if (!(await fs.pathExists(outputPath))) {
      throw new Error('Download failed: file not created');
    }

    const size = await validateVideoFile(outputPath, { minSize: 1000 });
    return { path: outputPath, size };
  } catch (error) {
    if (await fs.pathExists(outputPath)) {
      await fs.unlink(outputPath).catch(() => {});
    }
    throw error;
  }
}

async function deliverSnapchatVideo(ctx, url, formatId, tempDir) {
  const outputPath = path.join(tempDir, generateUniqueFilename('snap', 'mp4'));
  const result = await downloadVideoWithFormat(url, formatId, outputPath);
  try {
    await sendVideoFile(ctx, result.path, {
      size: result.size,
      sizeLimit: VIDEO_SIZE_LIMIT,
      mediaLimit: VIDEO_MEDIA_LIMIT,
      limitLabel: '100MB',
      caption: path.basename(result.path)
    });
  } finally {
    await fs.unlink(result.path).catch(() => {});
  }
}

export default {
  name: 'snapchat',
  description: 'Snapchat story/spotlight downloader without watermark',
  version: '2.2.0',
  author: 'Are Martins',
  commands: [
    {
      name: 'snap',
      aliases: ['snapchat', 'sc'],
      description: 'Download Snapchat story/spotlight without watermark',
      usage: '.snap <url>',
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
              url = extractSnapchatUrlFromObject(quotedMessage) || '';
            }
          }

          if (!url) {
            return await ctx.reply('Please provide a Snapchat URL\n\nUsage: .snap <url>');
          }

          const validatedUrl = await validateSnapchatUrl(url);
          if (!validatedUrl) {
            return await ctx.reply('Please provide a valid Snapchat URL');
          }

          const tempDir = path.join(process.cwd(), 'tmp');
          await fs.ensureDir(tempDir);

          await reactIfEnabled(ctx, '⏳');

          try {
            const { formats, title, url: videoUrl } = await withDelayedNotice(ctx, () => downloadWithYtDlp(validatedUrl.url));

            const choices = formats.map((format, index) => ({
              label: `${index + 1} - ${format.quality}${format.size ? ` (${formatFileSize(format.size)})` : ''}`,
              formatId: format.formatId,
              height: format.height
            }));

            if (choices.length === 0) {
              await deliverSnapchatVideo(ctx, videoUrl, 'best', tempDir);
              await reactIfEnabled(ctx, '✅');
              return;
            }

            if (choices.length === 1) {
              await deliverSnapchatVideo(ctx, videoUrl, choices[0].formatId, tempDir);
              await reactIfEnabled(ctx, '✅');
              return;
            }

            let prompt = `*${title}*\n\nSelect video quality by replying with the number:\n`;
            prompt += choices.map((choice) => choice.label).join('\n');

            await promptNumericSelection(ctx, {
              type: 'snapchat_quality',
              prompt,
              choices,
              data: { url: videoUrl, tempDir },
              handler: async (replyCtx, selected, choice, pending) => {
                await reactIfEnabled(replyCtx, '⏳');
                try {
                  await withDelayedNotice(replyCtx, () => attemptChoiceWithFallback({
                    choices: pending.data.choices,
                    selectedIndex: choice - 1,
                    attempt: async (fallbackChoice) => {
                      await deliverSnapchatVideo(replyCtx, pending.data.url, fallbackChoice.formatId, pending.data.tempDir);
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
          } catch (error) {
            await reactIfEnabled(ctx, '❌');
            let errorMsg = 'Download failed. ';
            if (error.message?.includes('extract')) {
              errorMsg += 'Could not find media. Make sure the story/spotlight is public.';
            } else if (error.message?.includes('not found')) {
              errorMsg += 'Content not found or deleted.';
            } else {
              errorMsg += 'Please try again later.';
            }
            await ctx.reply(errorMsg);
          }
        } catch {
          await reactIfEnabled(ctx, '❌');
          await ctx.reply('An error occurred while processing Snapchat media');
        }
      }
    }
  ]
};

