import youtubedl from 'youtube-dl-exec';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import fs from 'fs-extra';
import path from 'path';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
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
import logger from '../utils/logger.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const VIDEO_SIZE_LIMIT = 2 * 1024 * 1024 * 1024;
const VIDEO_MEDIA_LIMIT = 30 * 1024 * 1024;
const AUDIO_SIZE_LIMIT = 100 * 1024 * 1024;
const MAX_VIDEO_HEIGHT = 720;
const DEFAULT_VIDEO_FORMAT = `bestvideo[height<=${MAX_VIDEO_HEIGHT}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${MAX_VIDEO_HEIGHT}][vcodec!=none][acodec!=none]/best[height<=${MAX_VIDEO_HEIGHT}]`;
const SHORTS_VIDEO_FORMAT = `best[height<=${MAX_VIDEO_HEIGHT}]/best`;
const FALLBACK_MERGE_VIDEO_FORMAT = `bestvideo*[height<=${MAX_VIDEO_HEIGHT}]+bestaudio/best[height<=${MAX_VIDEO_HEIGHT}]/best`;
const YOUTUBE_EXTRACTOR_ARGS = 'youtube:player-client=mweb,ios;formats=missing_pot';
let youtubeTaskQueue = Promise.resolve();
let youtubeQueueDepth = 0;
const pluginLogger = logger.child({ component: 'youtube' });

async function runExclusiveYouTubeTask(task) {
  const previousTask = youtubeTaskQueue.catch(() => {});
  const hadQueueAhead = youtubeQueueDepth > 0;
  youtubeQueueDepth += 1;

  let releaseQueue;
  youtubeTaskQueue = new Promise((resolve) => {
    releaseQueue = resolve;
  });

  try {
    await previousTask;
    return await task({ queued: hadQueueAhead });
  } finally {
    youtubeQueueDepth = Math.max(0, youtubeQueueDepth - 1);
    releaseQueue();
  }
}

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
const YTDLP_BINARY_PATH = youtubedl.constants?.YOUTUBE_DL_PATH || null;

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
    ignoreConfig: true,
    jsRuntimes: 'node',
    preferFreeFormats: true,
    extractorArgs: YOUTUBE_EXTRACTOR_ARGS,
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
    if (typeof youtubedl.update === 'function' && YTDLP_BINARY_PATH) {
      await youtubedl.update(YTDLP_BINARY_PATH);
      pluginLogger.info({ path: YTDLP_BINARY_PATH }, 'Updated bundled yt-dlp binary');
    }
  } catch (error) {
    pluginLogger.warn({ error, path: YTDLP_BINARY_PATH }, 'Failed to update bundled yt-dlp binary');
  }

  try {
    if (YTDLP_BINARY_PATH) {
      await execFileAsync(YTDLP_BINARY_PATH, ['-U'], { timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
    } else {
      await execAsync('yt-dlp -U 2>/dev/null || pip install --upgrade yt-dlp 2>/dev/null || true');
    }
    pluginLogger.debug('yt-dlp self-update completed');
  } catch {}
})();

(async () => {
  if (!YOUTUBE_COOKIES_CONFIG || YOUTUBE_COOKIES_CONFIG.source !== 'inline') return;
  try {
    await fs.ensureDir(path.dirname(YOUTUBE_COOKIES_CONFIG.path));
    await fs.writeFile(YOUTUBE_COOKIES_CONFIG.path, YOUTUBE_COOKIES_CONFIG.content, 'utf8');
    pluginLogger.debug({ path: YOUTUBE_COOKIES_CONFIG.path }, 'Wrote inline cookies file');
  } catch (error) {
    pluginLogger.error({ error, path: YOUTUBE_COOKIES_CONFIG.path }, 'Failed to write inline cookies file');
  }
})();

async function prepareCookiesFile() {
  if (!YOUTUBE_COOKIES_CONFIG || !YTDLP_COOKIES_FILE) return { enabled: false, exists: false };

  try {
    await fs.ensureDir(path.dirname(YTDLP_COOKIES_FILE));

    if (YOUTUBE_COOKIES_CONFIG.source === 'inline') {
      await fs.writeFile(YTDLP_COOKIES_FILE, YOUTUBE_COOKIES_CONFIG.content, 'utf8');
      return { enabled: true, exists: true, source: 'inline', path: YTDLP_COOKIES_FILE };
    }

    const exists = await fs.pathExists(YTDLP_COOKIES_FILE);
    return { enabled: true, exists, source: 'file', path: YTDLP_COOKIES_FILE };
  } catch (error) {
    pluginLogger.error({ error, path: YTDLP_COOKIES_FILE }, 'prepareCookiesFile failed');
    return { enabled: true, exists: false, source: YOUTUBE_COOKIES_CONFIG.source, path: YTDLP_COOKIES_FILE, error };
  }
}

function getYouTubeCookiesSetupHelp() {
  return [
    'YouTube blocked this host and asked to confirm it is not a bot.',
    '',
    'To fix it, add your YouTube cookies to the bot:',
    '1. Open YouTube in your browser and make sure you are logged in.',
    '2. Export your YouTube cookies in Netscape cookies.txt format.',
    '3. Put the file in the bot, for example: `cookies/youtube-cookies.txt`',
    '4. Set `.env` like this: `YOUTUBE_COOKIES_FILE=cookies/youtube-cookies.txt`',
    '5. Restart the bot.',
    '',
    'Easy way to export cookies:',
    '- Install a browser extension that exports cookies as `cookies.txt` / Netscape format.',
    '- Export while logged into youtube.com.',
    '',
    'If you already have the cookies text, you can also save it with your env command and restart the bot.'
  ].join('\n');
}

function getMissingCookiesFileHelp(filePath) {
  return [
    `YouTube cookies file is configured but missing: ${filePath}`,
    '',
    'To fix it:',
    '1. Open YouTube in your browser and make sure you are logged in.',
    '2. Export your YouTube cookies in Netscape cookies.txt format.',
    `3. Save the file here: ${filePath}`,
    '4. Restart the bot.',
    '',
    'Easy way to export cookies:',
    '- Install a browser extension that exports cookies as `cookies.txt` / Netscape format.',
    '- Export while logged into youtube.com.'
  ].join('\n');
}

function generateUniqueFilename(prefix = 'yt', extension = 'mp4') {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${random}.${extension}`;
}

function generateUniqueBasename(prefix = 'yt') {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${random}`;
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

function normalizeYouTubeUrl(url) {
  if (!url || typeof url !== 'string') return url;

  const shortsMatch = url.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/i);
  if (shortsMatch?.[1]) {
    return `https://www.youtube.com/watch?v=${shortsMatch[1]}`;
  }

  try {
    const normalized = new URL(url.trim());
    normalized.searchParams.delete('si');
    return normalized.toString();
  } catch {
    return url;
  }
}

function isYouTubeShort(url) {
  return /youtube\.com\/shorts\//i.test(url);
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

function buildPreferredMergeSelector(formatId, ext, hasAudio) {
  if (hasAudio) return formatId;

  if (ext === 'mp4') {
    return `${formatId}+bestaudio[ext=m4a]/${formatId}+bestaudio[acodec^=mp4a]/${formatId}+bestaudio/best`;
  }

  if (ext === 'webm') {
    return `${formatId}+bestaudio[ext=webm]/${formatId}+bestaudio[acodec=opus]/${formatId}+bestaudio/best`;
  }

  return `${formatId}+bestaudio/best`;
}

function buildProgressiveSelector(height, ext) {
  const progressiveBase = `best[height<=${height}][vcodec!=none][acodec!=none]`;
  if (ext === 'mp4') {
    return `${progressiveBase}[ext=mp4]/${progressiveBase}/best[ext=mp4]/best`;
  }
  return `${progressiveBase}/best[ext=${ext}]/best`;
}

function inferMergeOutputFormat(formatString) {
  const value = String(formatString || '').toLowerCase();
  if (!value) return null;
  if (value.includes('ext=mp4') || value.includes('mp4a') || value.includes('[ext=m4a]')) return 'mp4';
  if (value.includes('ext=webm') || value.includes('acodec=opus') || value.includes('[ext=webm]')) return 'webm';
  return null;
}

function getVideoMimetypeForFile(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mp4' || ext === '.m4v') return 'video/mp4';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.mkv') return 'video/x-matroska';
  return 'video/mp4';
}

function isCompletedDownloadFilename(filename, baseName) {
  if (!filename || !baseName) return false;
  if (!filename.startsWith(`${baseName}.`)) return false;
  if (filename.endsWith('.part') || filename.endsWith('.ytdl')) return false;
  if (filename.includes('.temp.')) return false;
  if (filename.includes('.f') && /\.(f\d+|f\d+-\d+)\./i.test(filename)) return false;
  return true;
}

async function resolveDownloadedOutputPath(tempDir, baseName) {
  const entries = await fs.readdir(tempDir).catch(() => []);
  const matches = entries
    .filter((filename) => isCompletedDownloadFilename(filename, baseName))
    .sort((a, b) => a.length - b.length);

  if (!matches.length) {
    throw new Error('Download failed: file not created');
  }

  return path.join(tempDir, matches[0]);
}

async function cleanupDownloadOutputs(tempDir, baseName) {
  const entries = await fs.readdir(tempDir).catch(() => []);
  await Promise.all(
    entries
      .filter((filename) => filename.startsWith(`${baseName}.`))
      .map((filename) => fs.unlink(path.join(tempDir, filename)).catch(() => {}))
  );
}

function buildYtDlpCliArgs(url, extraArgs = []) {
  const args = [
    '--no-warnings',
    '--no-check-certificates',
    '--ignore-config',
    '--prefer-free-formats',
    '--js-runtimes', 'node',
    '--no-playlist',
    '--retries', '3',
    '--socket-timeout', '30',
    '--extractor-args', YOUTUBE_EXTRACTOR_ARGS,
    '--add-header', 'referer:https://www.youtube.com/',
    '--add-header', `user-agent:${getRandomUserAgent()}`,
    '--add-header', 'accept-language:en-US,en;q=0.9'
  ];

  const proxy = getRandomProxy();
  if (proxy) args.push('--proxy', proxy);
  if (YTDLP_COOKIES_FILE) args.push('--cookies', YTDLP_COOKIES_FILE);

  args.push(...extraArgs, normalizeYouTubeUrl(url));
  return args;
}

function parseHeightFromFormatText(text) {
  if (!text) return 0;
  const resolutionMatch = text.match(/(\d{2,5})x(\d{2,5})/);
  if (resolutionMatch) return Number(resolutionMatch[2]) || 0;
  const qualityMatch = text.match(/(^|\s)(\d{3,4})p(\s|$)/i);
  if (qualityMatch) return Number(qualityMatch[2]) || 0;
  return 0;
}

async function getVideoFormatsFromList(url) {
  const binaryPath = YTDLP_BINARY_PATH || 'yt-dlp';
  const args = buildYtDlpCliArgs(url, ['--list-formats']);

  try {
    const { stdout } = await execFileAsync(binaryPath, args, {
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024
    });

    const lines = String(stdout || '')
      .split(/\r?\n/)
      .map(line => line.trimEnd())
      .filter(Boolean);

    const titleLine = lines.find(line => !line.startsWith('[info]') && !/^ID\s+EXT/i.test(line));
    const rawFormats = [];

    for (const line of lines) {
      if (/^\[info\]/i.test(line) || /^ID\s+EXT/i.test(line) || /^-+\s*-+/i.test(line)) continue;

      const match = line.match(/^(\S+)\s+(\S+)\s+(.+)$/);
      if (!match) continue;

      const [, formatId, ext, details] = match;
      if (/audio only|images|storyboard/i.test(details)) continue;
      if (!/video only|mp4a|audio/i.test(details) && !/\d{2,5}x\d{2,5}|\d{3,4}p/i.test(details)) continue;

      const height = parseHeightFromFormatText(details);
      if (!height || height > MAX_VIDEO_HEIGHT) continue;

      rawFormats.push({
        format_id: formatId,
        ext,
        height,
        acodec: /video only/i.test(details) ? 'none' : 'unknown',
        fps: Number(details.match(/(\d{2,3})fps/i)?.[1] || 0),
        tbr: Number(details.match(/(\d+(?:\.\d+)?)k\b/i)?.[1] || 0),
        filesize_approx: 0
      });
    }

    return {
      title: titleLine || 'YouTube video',
      duration: 0,
      formats: rawFormats
    };
  } catch (error) {
    pluginLogger.error({ error, url, stderr: error?.stderr || null, stdout: error?.stdout || null }, 'getVideoFormatsFromList failed');
    throw error;
  }
}

async function getVideoFormats(url) {
  url = normalizeYouTubeUrl(url);
  let info = null;
  let lastError = null;
  const metadataAttempts = [
    { dumpSingleJson: true },
    { dumpSingleJson: true, preferFreeFormats: false },
    { dumpSingleJson: true, format: 'b/bv+ba' }
  ];

  for (const attempt of metadataAttempts) {
    try {
      info = await youtubedl(url, getDownloadOptions(attempt));
      break;
    } catch (error) {
      lastError = error;
      pluginLogger.warn({ error, url, attempt, stderr: error?.stderr || null }, 'getVideoFormats metadata attempt failed');
    }
  }

  if (!info) {
    try {
      info = await getVideoFormatsFromList(url);
    } catch (fallbackError) {
      throw lastError || fallbackError || new Error('Failed to fetch YouTube metadata');
    }
  }

  const groupedFormats = new Map();

  for (const format of info.formats || []) {
    const height = format.height || 0;
    const hasVideo = format.vcodec && format.vcodec !== 'none';
    const formatId = format.format_id;
    if (!hasVideo || !height || !formatId || height > MAX_VIDEO_HEIGHT) continue;

    const normalizedHeight = [720, 480, 360, 240, 144]
      .find(item => height >= item) || height;

    const entry = groupedFormats.get(normalizedHeight) || [];
    entry.push(format);
    groupedFormats.set(normalizedHeight, entry);
  }

  const formats = [];

  for (const [normalizedHeight, candidates] of groupedFormats.entries()) {
    const sortedCandidates = [...candidates].sort((a, b) => {
      const aHasAudio = a.acodec && a.acodec !== 'none' ? 1 : 0;
      const bHasAudio = b.acodec && b.acodec !== 'none' ? 1 : 0;
      const aIsMp4 = a.ext === 'mp4' ? 1 : 0;
      const bIsMp4 = b.ext === 'mp4' ? 1 : 0;
      const aFps = a.fps || 0;
      const bFps = b.fps || 0;
      const aTbr = a.tbr || 0;
      const bTbr = b.tbr || 0;

      return (
        bHasAudio - aHasAudio ||
        bIsMp4 - aIsMp4 ||
        bFps - aFps ||
        bTbr - aTbr
      );
    });

    const bestCandidate = sortedCandidates[0];
    const directSelectors = [];
    const progressiveSelectors = [];

    for (const candidate of sortedCandidates) {
      const hasAudio = candidate.acodec && candidate.acodec !== 'none';
      if (hasAudio) {
        progressiveSelectors.push(candidate.format_id);
        progressiveSelectors.push(buildProgressiveSelector(normalizedHeight, candidate.ext));
        continue;
      }
      directSelectors.push(buildPreferredMergeSelector(candidate.format_id, candidate.ext, hasAudio));
    }

    const selectorChain = Array.from(new Set([
      ...progressiveSelectors,
      ...directSelectors,
      `bestvideo*[height<=${normalizedHeight}]+bestaudio/best[height<=${normalizedHeight}][vcodec!=none][acodec!=none]/best[height<=${normalizedHeight}]/best`
    ]));

    formats.push({
      quality: `${normalizedHeight}p`,
      height: normalizedHeight,
      size: bestCandidate.filesize || bestCandidate.filesize_approx || 0,
      formatSelectors: selectorChain,
      formatString: selectorChain[0]
    });
  }

  formats.sort((a, b) => b.height - a.height);

  return {
    title: info.title || 'YouTube video',
    duration: info.duration || 0,
    formats: formats.slice(0, 6)
  };
}

async function downloadVideoWithFormat(url, formatString, tempDir) {
  url = normalizeYouTubeUrl(url);
  const outputBase = generateUniqueBasename('yt_video');
  const outputTemplate = path.join(tempDir, `${outputBase}.%(ext)s`);
  const mergeOutputFormat = inferMergeOutputFormat(formatString);
  try {
    const downloadOptions = getDownloadOptions({
      output: outputTemplate,
      format: formatString
    });
    if (mergeOutputFormat) {
      downloadOptions.mergeOutputFormat = mergeOutputFormat;
    }

    await youtubedl(url, downloadOptions);

    const outputPath = await resolveDownloadedOutputPath(tempDir, outputBase);

    const stats = await fs.stat(outputPath);
    if (stats.size > VIDEO_SIZE_LIMIT) {
      await fs.unlink(outputPath).catch(() => {});
      throw new Error(`Video too large (${stats.size} bytes). WhatsApp limit is 2GB.`);
    }

    const size = await validateVideoFile(outputPath, { minSize: 1000 });
    return {
      path: outputPath,
      size,
      mimetype: getVideoMimetypeForFile(outputPath)
    };
  } catch (error) {
    pluginLogger.error({ error, url, formatString, outputTemplate, stderr: error?.stderr || null, stdout: error?.stdout || null }, 'downloadVideoWithFormat failed');
    await cleanupDownloadOutputs(tempDir, outputBase);
    throw error;
  }
}

async function downloadVideoWithSelectors(url, selectors, tempDir) {
  const attempts = Array.isArray(selectors) ? selectors : [selectors];
  let lastError = null;

  for (const formatString of attempts.filter(Boolean)) {
    try {
      const result = await downloadVideoWithFormat(url, formatString, tempDir);
      return { ...result, formatString };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Download failed');
}

async function downloadVideoWithFallback(url, tempDir) {
  url = normalizeYouTubeUrl(url);
  const attempts = isYouTubeShort(url)
    ? [
        SHORTS_VIDEO_FORMAT,
        `best[height<=${MAX_VIDEO_HEIGHT}]`,
        `bestvideo*[height<=${MAX_VIDEO_HEIGHT}]+bestaudio/best[height<=${MAX_VIDEO_HEIGHT}]`
      ]
    : [
        DEFAULT_VIDEO_FORMAT,
        `best[height<=${MAX_VIDEO_HEIGHT}][ext=mp4]/best[height<=${MAX_VIDEO_HEIGHT}]/best`,
        FALLBACK_MERGE_VIDEO_FORMAT,
        `bestvideo*[height<=${MAX_VIDEO_HEIGHT}]+bestaudio/best[height<=${MAX_VIDEO_HEIGHT}]`
      ];

  let lastError = null;
  for (const formatString of attempts) {
    try {
      const result = await downloadVideoWithFormat(url, formatString, tempDir);
      return { ...result, formatString };
    } catch (error) {
      pluginLogger.warn({ error, url, formatString }, 'Fallback attempt failed');
      lastError = error;
    }
  }

  throw lastError || new Error('Download failed');
}

async function downloadAudioWithYtDlp(url, tempDir) {
  url = normalizeYouTubeUrl(url);
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
    pluginLogger.error({ error, url, outputPath, stderr: error?.stderr || null, stdout: error?.stdout || null }, 'downloadAudioWithYtDlp failed');
    if (await fs.pathExists(outputPath)) {
      await fs.unlink(outputPath).catch(() => {});
    }
    throw error;
  }
}

async function deliverYouTubeVideo(ctx, url, tempDir, title, formatString = null) {
  url = normalizeYouTubeUrl(url);
  const result = formatString
    ? await downloadVideoWithSelectors(url, formatString, tempDir)
    : await downloadVideoWithFallback(url, tempDir);
  try {
    await sendVideoFile(ctx, result.path, {
      size: result.size,
      sizeLimit: VIDEO_SIZE_LIMIT,
      mediaLimit: VIDEO_MEDIA_LIMIT,
      limitLabel: '2GB',
      mimetype: result.mimetype || 'video/mp4',
      caption: title || 'YouTube video'
    });
  } finally {
    await fs.unlink(result.path).catch(() => {});
  }
}

export default {
  name: 'youtube',
  description: 'YouTube video and audio downloader',
  version: '2.5.0',
  author: 'Are Martins',
  commands: [
    {
      name: 'ytv',
      aliases: ['ytvideo', 'yt'],
      description: 'Download YouTube video with quality selection',
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

          const validatedUrl = validateYouTubeUrl(normalizeYouTubeUrl(url));
          if (!validatedUrl) {
            return await ctx.reply('Please provide a valid YouTube URL');
          }

          const tempDir = path.join(process.cwd(), 'tmp');
          await fs.ensureDir(tempDir);

          const cookiesState = await prepareCookiesFile();
          if (cookiesState.enabled && !cookiesState.exists) {
            pluginLogger.warn({ cookiesState }, 'Configured cookies file is missing');
            await ctx.reply(getMissingCookiesFileHelp(cookiesState.path));
            return;
          }

          await reactIfEnabled(ctx, '⏳');

          try {
            await withDelayedNotice(ctx, () => runExclusiveYouTubeTask(async ({ queued }) => {
              if (queued) {
                await ctx.reply('Another YouTube download is in progress. Your request is queued.');
              }

              const { title, duration, formats } = await getVideoFormats(validatedUrl.url);

            if (formats.length === 0) {
              await deliverYouTubeVideo(ctx, validatedUrl.url, tempDir, title);
              await reactIfEnabled(ctx, '✅');
              return;
            }

            const choices = formats.map((format, index) => ({
              label: `${index + 1} - ${format.quality}${format.size ? ` (${formatFileSize(format.size)})` : ''}`,
              formatString: format.formatSelectors,
              height: format.height
            }));

            if (choices.length === 0) {
              await deliverYouTubeVideo(ctx, validatedUrl.url, tempDir, title);
              await reactIfEnabled(ctx, '✅');
              return;
            }

            if (choices.length === 1) {
              await deliverYouTubeVideo(ctx, validatedUrl.url, tempDir, title, choices[0].formatString);
              await reactIfEnabled(ctx, '✅');
              return;
            }

            let prompt = `*${title}*\n`;
            if (duration) prompt += `Duration: ${formatDuration(duration)}\n\n`;
            prompt += 'Select video quality by replying with the number:\n';
            prompt += choices.map(choice => choice.label).join('\n');

            await promptNumericSelection(ctx, {
              type: 'youtube_quality',
              prompt,
              choices,
              data: { url: validatedUrl.url, tempDir, title },
              handler: async (replyCtx, selected, choice, pending) => {
                await reactIfEnabled(replyCtx, '⏳');
                try {
                  await withDelayedNotice(replyCtx, () => runExclusiveYouTubeTask(async ({ queued: selectionQueued }) => {
                    if (selectionQueued) {
                      await replyCtx.reply('Another YouTube download is in progress. Your selection is queued.');
                    }

                    await attemptChoiceWithFallback({
                      choices: pending.data.choices,
                      selectedIndex: choice - 1,
                      attempt: async (fallbackChoice) => {
                        await deliverYouTubeVideo(
                          replyCtx,
                          pending.data.url,
                          pending.data.tempDir,
                          pending.data.title,
                          fallbackChoice.formatString
                        );
                      }
                    });
                  }));
                  await reactIfEnabled(replyCtx, '✅');
                  await reactPendingOrigin(replyCtx, pending, '✅');
                } catch (error) {
                  await reactIfEnabled(replyCtx, '❌');
                  await reactPendingOrigin(replyCtx, pending, '❌');
                  const errorMsg = error.message?.includes('too large') || error.message?.includes('All quality options failed')
                    ? error.message
                    : 'Failed to download all available qualities.';
                  await replyCtx.reply(errorMsg);
                }
                return true;
              }
            });
            }));
          } catch (error) {
            pluginLogger.error({
              error,
              url: validatedUrl.url,
              chatId: ctx.chatId,
              senderId: ctx.senderId,
              isFromMe: ctx.isFromMe,
              stderr: error?.stderr || null,
              stdout: error?.stdout || null
            }, '.ytv execution failed');
            await reactIfEnabled(ctx, '❌');
            let errorMsg = 'Download failed. ';
            if (error.message?.includes('private')) {
              errorMsg += 'Video is private or unavailable.';
            } else if (error.message?.includes('age')) {
              errorMsg += 'Video is age-restricted.';
            } else if (error.message?.includes('Requested format is not available')) {
              errorMsg += 'The selected/default format was not available for this video. Try another quality.';
            } else if (error.message?.includes('Sign in to confirm') || error.message?.includes("you're not a bot")) {
              errorMsg += YTDLP_COOKIES_FILE
                ? 'YouTube blocked this host even with the configured cookies. Try refreshing the cookies or using a different IP/proxy.'
                : getYouTubeCookiesSetupHelp();
            } else if (error.message?.includes('too large')) {
              errorMsg += error.message;
            } else {
              errorMsg += 'Please try again later.';
            }
            await ctx.reply(errorMsg);
          }
        } catch {
          await reactIfEnabled(ctx, '❌');
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

          const validatedUrl = validateYouTubeUrl(normalizeYouTubeUrl(url));
          if (!validatedUrl) {
            return await ctx.reply('Please provide a valid YouTube URL');
          }

          const tempDir = path.join(process.cwd(), 'tmp');
          await fs.ensureDir(tempDir);

          const cookiesState = await prepareCookiesFile();
          if (cookiesState.enabled && !cookiesState.exists) {
            pluginLogger.warn({ cookiesState }, 'Configured cookies file is missing');
            await ctx.reply(getMissingCookiesFileHelp(cookiesState.path));
            return;
          }

          await reactIfEnabled(ctx, '⏳');

          try {
            await withDelayedNotice(ctx, () => runExclusiveYouTubeTask(async ({ queued }) => {
              if (queued) {
                await ctx.reply('Another YouTube download is in progress. Your request is queued.');
              }

              const result = await downloadAudioWithYtDlp(validatedUrl.url, tempDir);
            const audioBuffer = await fs.readFile(result.path);
            await ctx._adapter.sendMedia(ctx.chatId, audioBuffer, {
              type: 'audio',
              mimetype: 'audio/mp4'
            });
            await reactIfEnabled(ctx, '✅');
            await fs.unlink(result.path).catch(() => {});
            }));
          } catch (error) {
            pluginLogger.error({
              error,
              url: validatedUrl.url,
              chatId: ctx.chatId,
              senderId: ctx.senderId,
              isFromMe: ctx.isFromMe,
              stderr: error?.stderr || null,
              stdout: error?.stdout || null
            }, '.yta execution failed');
            await reactIfEnabled(ctx, '❌');
            if (error.message?.includes('Sign in to confirm') || error.message?.includes("you're not a bot")) {
              await ctx.reply(
                YTDLP_COOKIES_FILE
                  ? 'Failed to download audio: YouTube blocked this host even with the configured cookies. Try refreshing the cookies or using a different IP/proxy.'
                  : getYouTubeCookiesSetupHelp()
              );
              return;
            }
            await ctx.reply(`Failed to download audio: ${error.message}`);
          }
        } catch {
          await reactIfEnabled(ctx, '❌');
          await ctx.reply('An error occurred while processing the audio');
        }
      }
    },
    {
      name: 'play',
      aliases: ['song', 'music'],
      description: 'Search YouTube for a song and send it as audio with selection',
      usage: '.play <song name>',
      category: 'download',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 15,
      async execute(ctx) {
        try {
          const query = ctx.args.join(' ').trim();
          if (!query) {
            return await ctx.reply('Please provide a song name\n\nUsage: .play <song name>');
          }

          const tempDir = path.join(process.cwd(), 'tmp');
          await fs.ensureDir(tempDir);

          const cookiesState = await prepareCookiesFile();
          if (cookiesState.enabled && !cookiesState.exists) {
            pluginLogger.warn({ cookiesState }, 'Configured cookies file is missing');
            await ctx.reply(getMissingCookiesFileHelp(cookiesState.path));
            return;
          }

          await reactIfEnabled(ctx, '⏳');

          try {
            await withDelayedNotice(ctx, () => runExclusiveYouTubeTask(async ({ queued }) => {
              if (queued) {
                await ctx.reply('Another YouTube download is in progress. Your request is queued.');
              }

              const results = await youtubedl(`ytsearch5:${query}`, {
                dumpSingleJson: true,
                noWarnings: true,
                flatPlaylist: true
              });

              const entries = Array.isArray(results?.entries)
                ? results.entries.filter((entry) => entry?.id)
                : [];

              if (!entries.length) {
                throw new Error('No matching song found on YouTube.');
              }

              const choices = entries.slice(0, 5).map((entry, index) => ({
                index: index + 1,
                id: entry.id,
                title: entry.title || 'Unknown title',
                uploader: entry.uploader || 'Unknown uploader',
                duration: entry.duration || 0,
                url: `https://www.youtube.com/watch?v=${entry.id}`
              }));

              if (choices.length === 1) {
                const result = await downloadAudioWithYtDlp(choices[0].url, tempDir);
                const audioBuffer = await fs.readFile(result.path);
                await ctx._adapter.sendMedia(ctx.chatId, audioBuffer, 'audio', {
                  mimetype: 'audio/mp4'
                });
                await reactIfEnabled(ctx, '✅');
                await fs.unlink(result.path).catch(() => {});
                return;
              }

              let prompt = `*Search results for:* ${query}\n\nReply with a number to choose a song:\n`;
              prompt += choices.map((choice) => {
                const duration = choice.duration ? formatDuration(choice.duration) : 'Unknown';
                return `${choice.index} - ${choice.title}\n${choice.uploader} | ${duration}`;
              }).join('\n\n');

              await promptNumericSelection(ctx, {
                type: 'youtube_play_selection',
                prompt,
                choices,
                data: { tempDir },
                handler: async (replyCtx, selected, choice, pending) => {
                  await reactIfEnabled(replyCtx, '⏳');
                  try {
                    await withDelayedNotice(replyCtx, () => runExclusiveYouTubeTask(async ({ queued: selectionQueued }) => {
                      if (selectionQueued) {
                        await replyCtx.reply('Another YouTube download is in progress. Your selection is queued.');
                      }

                      const result = await downloadAudioWithYtDlp(selected.url, pending.data.tempDir);
                      const audioBuffer = await fs.readFile(result.path);
                      await replyCtx._adapter.sendMedia(replyCtx.chatId, audioBuffer, 'audio', {
                        mimetype: 'audio/mp4'
                      });
                      await fs.unlink(result.path).catch(() => {});
                    }));
                    await reactIfEnabled(replyCtx, '✅');
                    await reactPendingOrigin(replyCtx, pending, '✅');
                  } catch (error) {
                    await reactIfEnabled(replyCtx, '❌');
                    await reactPendingOrigin(replyCtx, pending, '❌');
                    if (error.message?.includes('Sign in to confirm') || error.message?.includes("you're not a bot")) {
                      await replyCtx.reply(
                        YTDLP_COOKIES_FILE
                          ? 'Failed to download audio: YouTube blocked this host even with the configured cookies. Try refreshing the cookies or using a different IP/proxy.'
                          : getYouTubeCookiesSetupHelp()
                      );
                      return true;
                    }
                    await replyCtx.reply(error.message || 'Failed to download the selected song.');
                  }
                  return true;
                }
              });
            }));
          } catch (error) {
            pluginLogger.error({
              error,
              query,
              chatId: ctx.chatId,
              senderId: ctx.senderId,
              stderr: error?.stderr || null,
              stdout: error?.stdout || null
            }, '.play execution failed');
            await reactIfEnabled(ctx, '❌');
            if (error.message?.includes('Sign in to confirm') || error.message?.includes("you're not a bot")) {
              await ctx.reply(
                YTDLP_COOKIES_FILE
                  ? 'Failed to download audio: YouTube blocked this host even with the configured cookies. Try refreshing the cookies or using a different IP/proxy.'
                  : getYouTubeCookiesSetupHelp()
              );
              return;
            }
            await ctx.reply(error.message || 'Failed to search and download the song.');
          }
        } catch {
          await reactIfEnabled(ctx, '❌');
          await ctx.reply('An error occurred while processing the song request');
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

          await reactIfEnabled(ctx, '🔍');

          try {
            const results = await youtubedl(`ytsearch5:${query}`, {
              dumpSingleJson: true,
              noWarnings: true,
              flatPlaylist: true
            });

            if (!results?.entries?.length) {
              await reactIfEnabled(ctx, '❌');
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
            await reactIfEnabled(ctx, '❌');
            await ctx.reply('Search failed. Please try again later.');
          }
        } catch {
          await reactIfEnabled(ctx, '❌');
          await ctx.reply('An error occurred while searching');
        }
      }
    }
  ]
};

