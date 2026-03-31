import youtubedl from 'youtube-dl-exec';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import fs from 'fs-extra';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { shouldReact } from '../utils/pendingActions.js';
import { getQuotedMessageObject } from '../utils/messageUtils.js';
import { sendVideoFile } from '../utils/downloadFlow.js';

const execAsync = promisify(exec);
const VIDEO_SIZE_LIMIT = 2 * 1024 * 1024 * 1024;
const VIDEO_MEDIA_LIMIT = 30 * 1024 * 1024;
const AUDIO_SIZE_LIMIT = 100 * 1024 * 1024;
const DEFAULT_PROGRESSIVE_VIDEO_FORMAT = '18/b[height<=360][ext=mp4]/b[ext=mp4]/b[height<=480]/best';
const FALLBACK_MERGE_VIDEO_FORMAT = 'bv*[height<=480]+ba/b[height<=480]/best';

function resolveCookiesConfig() {
  const inlineCookies = process.env.YOUTUBE_COOKIES?.trim();
  const rawPath = process.env.YOUTUBE_COOKIES_FILE?.trim() || process.env.YTDLP_COOKIES_FILE?.trim();
  const filePath = rawPath
    ? (path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath))
    : null;

  if (inlineCookies) {
    const resolvedInline = inlineCookies
      .replace(/\\r/g, '\r')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t');
    const envCookiesPath = path.resolve(process.cwd(), 'storage', 'youtube-cookies.env.txt');
    return {
      source: 'inline',
      path: envCookiesPath,
      content: resolvedInline
    };
  }

  if (filePath) {
    return {
      source: 'file',
      path: filePath,
      content: null
    };
  }

  return null;
}

const YOUTUBE_COOKIES_CONFIG = resolveCookiesConfig();
const YTDLP_COOKIES_FILE = YOUTUBE_COOKIES_CONFIG?.path || null;

const PROXIES = (process.env.PROXIES || '').split(',').filter(p => p.trim());
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

function getRandomProxy() {
  return PROXIES.length > 0 ? PROXIES[Math.floor(Math.random() * PROXIES.length)] : null;
}

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getDownloadOptions(extra = {}) {
  const proxy = getRandomProxy();
  const options = {
    noWarnings: true,
    noCheckCertificates: true,
    preferFreeFormats: true,
    noPlaylist: true,
    retries: 3,
    socketTimeout: 30,
    ffmpegLocation: ffmpegInstaller.path,
    addHeader: [
      'referer:https://www.youtube.com/',
      `user-agent:${getRandomUserAgent()}`,
      'accept-language:en-US,en;q=0.9'
    ],
    ...extra
  };
  if (proxy) options.proxy = proxy;
  if (YTDLP_COOKIES_FILE) options.cookies = YTDLP_COOKIES_FILE;
  return options;
}

(async () => {
  try {
    await execAsync('yt-dlp -U 2>/dev/null || pip install --upgrade yt-dlp 2>/dev/null || true');
  } catch {}
})();

(async () => {
  if (!YOUTUBE_COOKIES_CONFIG || YOUTUBE_COOKIES_CONFIG.source !== 'inline') return;
  try {
    await fs.ensureDir(path.dirname(YOUTUBE_COOKIES_CONFIG.path));
    await fs.writeFile(YOUTUBE_COOKIES_CONFIG.path, YOUTUBE_COOKIES_CONFIG.content, 'utf8');
    console.log(`[youtube] Wrote inline cookies to ${YOUTUBE_COOKIES_CONFIG.path}`);
  } catch (error) {
    console.error('[youtube] Failed to write inline cookies file', {
      path: YOUTUBE_COOKIES_CONFIG.path,
      message: error?.message || String(error)
    });
  }
})();

function generateUniqueFilename(prefix = 'yt', extension = 'mp4') {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${random}.${extension}`;
}

function validateYouTubeUrl(url) {
  const ytIdExtractRegex = /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  if (!url || typeof url !== 'string') return null;
  const cleanUrl = url.trim().replace(/[;&|`$(){}\[\]"'\\]/g, '');

  try {
    const urlObj = new URL(cleanUrl);
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(urlObj.hostname)) {
      return null;
    }
    const match = ytIdExtractRegex.exec(cleanUrl);
    if (match?.[1]) return { url: cleanUrl, videoId: match[1] };
  } catch {
    return null;
  }
  return null;
}

function extractYouTubeUrlFromObject(obj) {
  const ytUrlRegex = /https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)[a-zA-Z0-9_-]{11}/i;
  if (!obj || typeof obj !== 'object') return null;
  for (const key in obj) {
    if (typeof obj[key] === 'string') {
      const match = obj[key].match(ytUrlRegex);
      if (match) return match[0];
    } else if (typeof obj[key] === 'object') {
      const found = extractYouTubeUrlFromObject(obj[key]);
      if (found) return found;
    }
  }
  return null;
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function formatViews(count) {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M views`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K views`;
  return `${count} views`;
}

async function getVideoInfo(url) {
  const info = await youtubedl(url, getDownloadOptions({ dumpSingleJson: true }));
  return {
    title: info.title || 'YouTube video',
    duration: info.duration || 0
  };
}

async function downloadVideoWithFormat(url, formatString, tempDir) {
  const outputPath = path.join(tempDir, generateUniqueFilename('yt_video', 'mp4'));
  try {
    await youtubedl(url, getDownloadOptions({
      output: outputPath,
      format: formatString,
      mergeOutputFormat: 'mp4'
    }));

    if (!(await fs.pathExists(outputPath))) {
      throw new Error('Download failed: file not created');
    }

    const stats = await fs.stat(outputPath);
    if (stats.size > VIDEO_SIZE_LIMIT) {
      await fs.unlink(outputPath).catch(() => {});
      throw new Error(`Video too large (${stats.size} bytes). WhatsApp limit is 2GB.`);
    }

    return { path: outputPath, size: stats.size };
  } catch (error) {
    console.error('[youtube] downloadVideoWithFormat failed', {
      url,
      formatString,
      outputPath,
      message: error?.message || String(error),
      stderr: error?.stderr || null,
      stdout: error?.stdout || null
    });
    if (await fs.pathExists(outputPath)) {
      await fs.unlink(outputPath).catch(() => {});
    }
    throw error;
  }
}

async function downloadVideoWithFallback(url, tempDir) {
  const attempts = [
    DEFAULT_PROGRESSIVE_VIDEO_FORMAT,
    'b[ext=mp4]/b/best',
    FALLBACK_MERGE_VIDEO_FORMAT
  ];

  let lastError = null;
  for (const formatString of attempts) {
    try {
      const result = await downloadVideoWithFormat(url, formatString, tempDir);
      return { ...result, formatString };
    } catch (error) {
      console.error('[youtube] fallback attempt failed', {
        url,
        formatString,
        message: error?.message || String(error)
      });
      lastError = error;
    }
  }

  throw lastError || new Error('Download failed');
}

async function downloadAudioWithYtDlp(url, tempDir) {
  const outputPath = path.join(tempDir, generateUniqueFilename('yt_audio', 'm4a'));
  try {
    const info = await youtubedl(url, getDownloadOptions({ dumpSingleJson: true }));
    await youtubedl(url, getDownloadOptions({
      output: outputPath,
      extractAudio: true,
      audioFormat: 'm4a',
      audioQuality: 0
    }));

    if (!(await fs.pathExists(outputPath))) {
      throw new Error('Download failed: file not created');
    }

    const stats = await fs.stat(outputPath);
    if (stats.size > AUDIO_SIZE_LIMIT) {
      await fs.unlink(outputPath).catch(() => {});
      throw new Error(`Audio too large (${stats.size} bytes). WhatsApp limit is 100MB.`);
    }

    return { path: outputPath, size: stats.size, title: info.title || 'audio' };
  } catch (error) {
    console.error('[youtube] downloadAudioWithYtDlp failed', {
      url,
      outputPath,
      message: error?.message || String(error),
      stderr: error?.stderr || null,
      stdout: error?.stdout || null
    });
    if (await fs.pathExists(outputPath)) {
      await fs.unlink(outputPath).catch(() => {});
    }
    throw error;
  }
}

async function deliverYouTubeVideo(ctx, url, tempDir, title) {
  const result = await downloadVideoWithFallback(url, tempDir);
  try {
    await sendVideoFile(ctx, result.path, {
      size: result.size,
      sizeLimit: VIDEO_SIZE_LIMIT,
      mediaLimit: VIDEO_MEDIA_LIMIT,
      limitLabel: '2GB',
      caption: title || 'YouTube video'
    });
  } finally {
    await fs.unlink(result.path).catch(() => {});
  }
}

export default {
  name: 'youtube',
  description: 'YouTube video and audio downloader',
  version: '2.4.0',
  author: 'MATDEV',
  commands: [
    {
      name: 'ytv',
      aliases: ['ytvideo', 'yt'],
      description: 'Download YouTube video with lightweight hosted-friendly fallback',
      usage: '.ytv <url>',
      category: 'download',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 15,
      async execute(ctx) {
        try {
          let url = ctx.args.join(' ').trim();
          if (!url) {
            const quotedMessage = getQuotedMessageObject(ctx);
            if (quotedMessage) url = extractYouTubeUrlFromObject(quotedMessage) || '';
          }

          if (!url) {
            return await ctx.reply('Please provide a YouTube URL\n\nUsage: .ytv <url>');
          }

          const validatedUrl = validateYouTubeUrl(url);
          if (!validatedUrl) {
            return await ctx.reply('Please provide a valid YouTube URL');
          }

          const tempDir = path.join(process.cwd(), 'tmp');
          await fs.ensureDir(tempDir);

          if (shouldReact()) await ctx.react('⏳');

          try {
            const { title } = await getVideoInfo(validatedUrl.url);
            await deliverYouTubeVideo(ctx, validatedUrl.url, tempDir, title);
            if (shouldReact()) await ctx.react('✅');
          } catch (error) {
            console.error('[youtube] .ytv execute failed', {
              url: validatedUrl.url,
              chatId: ctx.chatId,
              senderId: ctx.senderId,
              isFromMe: ctx.isFromMe,
              message: error?.message || String(error),
              stderr: error?.stderr || null,
              stdout: error?.stdout || null,
              stack: error?.stack || null
            });
            if (shouldReact()) await ctx.react('❌');
            let errorMsg = 'Download failed. ';
            if (error.message?.includes('private')) {
              errorMsg += 'Video is private or unavailable.';
            } else if (error.message?.includes('age')) {
              errorMsg += 'Video is age-restricted.';
            } else if (error.message?.includes('Sign in to confirm you’re not a bot') || error.message?.includes("Sign in to confirm you're not a bot")) {
              errorMsg += YTDLP_COOKIES_FILE
                ? 'YouTube blocked this host even with the configured cookies. Try refreshing the cookies or using a different IP/proxy.'
                : 'YouTube blocked this host IP. Configure YTDLP_COOKIES_FILE with exported YouTube cookies.';
            } else if (error.message?.includes('too large')) {
              errorMsg += error.message;
            } else {
              errorMsg += 'Please try again later.';
            }
            await ctx.reply(errorMsg);
          }
        } catch {
          if (shouldReact()) await ctx.react('❌');
          await ctx.reply('An error occurred while processing the video');
        }
      }
    },
    {
      name: 'yta',
      aliases: ['ytaudio', 'ytmp3'],
      description: 'Download YouTube audio',
      usage: '.yta <url>',
      category: 'download',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 15,
      async execute(ctx) {
        try {
          let url = ctx.args.join(' ').trim();
          if (!url) {
            const quotedMessage = getQuotedMessageObject(ctx);
            if (quotedMessage) url = extractYouTubeUrlFromObject(quotedMessage) || '';
          }

          if (!url) {
            return await ctx.reply('Please provide a YouTube URL\n\nUsage: .yta <url>');
          }

          const validatedUrl = validateYouTubeUrl(url);
          if (!validatedUrl) {
            return await ctx.reply('Please provide a valid YouTube URL');
          }

          const tempDir = path.join(process.cwd(), 'tmp');
          await fs.ensureDir(tempDir);

          if (shouldReact()) await ctx.react('⏳');

          try {
            const result = await downloadAudioWithYtDlp(validatedUrl.url, tempDir);
            const audioBuffer = await fs.readFile(result.path);
            await ctx._adapter.sendMedia(ctx.chatId, audioBuffer, {
              type: 'audio',
              mimetype: 'audio/mp4'
            });
            if (shouldReact()) await ctx.react('✅');
            await fs.unlink(result.path).catch(() => {});
          } catch (error) {
            console.error('[youtube] .yta execute failed', {
              url: validatedUrl.url,
              chatId: ctx.chatId,
              senderId: ctx.senderId,
              isFromMe: ctx.isFromMe,
              message: error?.message || String(error),
              stderr: error?.stderr || null,
              stdout: error?.stdout || null,
              stack: error?.stack || null
            });
            if (shouldReact()) await ctx.react('❌');
            if (error.message?.includes('Sign in to confirm you’re not a bot') || error.message?.includes("Sign in to confirm you're not a bot")) {
              await ctx.reply(
                YTDLP_COOKIES_FILE
                  ? 'Failed to download audio: YouTube blocked this host even with the configured cookies. Try refreshing the cookies or using a different IP/proxy.'
                  : 'Failed to download audio: YouTube blocked this host IP. Configure YTDLP_COOKIES_FILE with exported YouTube cookies.'
              );
              return;
            }
            await ctx.reply(`Failed to download audio: ${error.message}`);
          }
        } catch {
          if (shouldReact()) await ctx.react('❌');
          await ctx.reply('An error occurred while processing the audio');
        }
      }
    },
    {
      name: 'yts',
      aliases: ['ytsearch'],
      description: 'Search YouTube videos',
      usage: '.yts <search term>',
      category: 'download',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 10,
      async execute(ctx) {
        try {
          const query = ctx.args.join(' ').trim();
          if (!query) {
            return await ctx.reply('Please provide a search term\n\nUsage: .yts <search term>');
          }

          if (shouldReact()) await ctx.react('🔍');

          try {
            const results = await youtubedl(`ytsearch5:${query}`, {
              dumpSingleJson: true,
              noWarnings: true,
              flatPlaylist: true
            });

            if (!results?.entries?.length) {
              if (shouldReact()) await ctx.react('❌');
              return await ctx.reply('No videos found for your search');
            }

            let resultText = `*Search Results for "${query}":*\n\n`;
            results.entries.slice(0, 5).forEach((video, index) => {
              const duration = video.duration ? formatDuration(video.duration) : 'Unknown';
              const views = video.view_count ? formatViews(video.view_count) : 'No views';
              const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
              resultText += `*${index + 1}.* ${video.title}\n`;
              resultText += `${video.uploader || 'Unknown'}\n`;
              resultText += `${duration} | ${views}\n`;
              resultText += `${videoUrl}\n\n`;
            });
            resultText += 'Use .ytv <url> to download video\n';
            resultText += 'Use .yta <url> to download audio';
            await ctx.reply(resultText);
          } catch {
            if (shouldReact()) await ctx.react('❌');
            await ctx.reply('Search failed. Please try again later.');
          }
        } catch {
          if (shouldReact()) await ctx.react('❌');
          await ctx.reply('An error occurred while searching');
        }
      }
    }
  ]
};
