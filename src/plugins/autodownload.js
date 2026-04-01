import { getAutodownloadConfig, setAutodownloadConfig } from '../state/autodownload.js';
import { normalizeDestinationJid } from '../utils/destinationRouter.js';
import logger from '../utils/logger.js';

const pluginLogger = logger.child({ component: 'autodownload' });

const SUPPORTED_SERVICES = [
  {
    service: 'pinterest',
    command: 'pinterest',
    pattern: /(?:https?:\/\/)?(?:www\.)?(?:pinterest\.com\/pin\/[^\s]+|pin\.it\/[^\s]+)/i
  },
  {
    service: 'instagram',
    command: 'ig',
    pattern: /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[A-Za-z0-9_-]+(?:\/?[^\s]*)?/i
  },
  {
    service: 'tiktok',
    command: 'tiktok',
    pattern: /(?:https?:\/\/)?(?:(?:www|vm|vt)\.)?tiktok\.com\/(?:@[\w.-]+\/video\/\d+|t\/[\w-]+|v\/\d+|[\w-]+)(?:[/?][^\s]*)?/i
  },
  {
    service: 'twitter',
    command: 'twitter',
    pattern: /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/(?:i\/web\/)?status\/\d+(?:[/?][^\s]*)?|(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/\w+\/status\/\d+(?:[/?][^\s]*)?/i
  },
  {
    service: 'facebook',
    command: 'fb',
    pattern: /(?:https?:\/\/)?(?:www\.|m\.|web\.|mobile\.)?(?:facebook|fb)\.(?:com|watch)\/[^\s]+|(?:https?:\/\/)?fb\.watch\/[\w-]+/i
  },
  {
    service: 'youtube',
    command: 'ytv',
    pattern: /(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)[^\s]+|youtu\.be\/[A-Za-z0-9_-]{11}(?:[/?][^\s]*)?)/i
  },
  {
    service: 'snapchat',
    command: 'snap',
    pattern: /(?:https?:\/\/)?(?:www\.)?snapchat\.com\/(?:@|add\/|t\/|spotlight\/)[^\s]+|(?:https?:\/\/)?(?:t\.snapchat\.com|story\.snapchat\.com)\/[^\s]+/i
  }
];

function normalizeChatJid(value, ctx) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  if (['this', 'here', 'chat', 'current'].includes(raw)) return ctx.chatId;
  return normalizeDestinationJid(raw, { allowGroup: true });
}

function isConfigEnabledForChat(ctx, config) {
  if (!ctx?.chatId) return false;
  if (config.mode === 'off') return false;
  if (config.mode === 'all') return true;
  if (config.mode === 'personal') return !ctx.isGroup;
  if (config.mode === 'group') return !!ctx.isGroup;
  if (config.mode === 'include') return config.includeJids.includes(String(ctx.chatId).trim().toLowerCase());
  return false;
}

function extractSingleSupportedUrl(text) {
  const input = String(text || '').trim();
  if (!input) return null;
  const cleanedInput = input.replace(/^[<(\["'\s]+|[>)\]"'\s]+$/g, '');

  for (const entry of SUPPORTED_SERVICES) {
    const match = cleanedInput.match(entry.pattern);
    if (!match) continue;

    const matchedUrl = match[0].replace(/[),.;!?]+$/, '');
    const leftover = cleanedInput.replace(match[0], '').trim();
    if (leftover.length > 0) continue;

    const normalizedUrl = /^https?:\/\//i.test(matchedUrl) ? matchedUrl : `https://${matchedUrl}`;
    return {
      ...entry,
      url: normalizedUrl
    };
  }

  return null;
}

async function dispatchExistingCommand(ctx, commandName, url) {
  const command = ctx.bot?.getCommandRegistry?.().get(commandName);
  if (!command || typeof command.execute !== 'function') {
    throw new Error(`Command "${commandName}" is not available`);
  }

  const originalCommand = ctx.command;
  const originalArgs = ctx.args;
  try {
    ctx.command = command.name;
    ctx.args = [url];
    await command.execute(ctx);
  } finally {
    ctx.command = originalCommand;
    ctx.args = originalArgs;
  }
}

function formatStatus(config) {
  const modeLabel = {
    off: 'OFF',
    all: 'ON for all chats',
    personal: 'ON for personal chats only',
    group: 'ON for group chats only',
    include: 'ON only for selected chats'
  }[config.mode] || config.mode;

  const lines = [`Auto-download: ${modeLabel}`];
  if (config.includeJids.length > 0) {
    lines.push('Selected chats:');
    lines.push(...config.includeJids.map(jid => `- ${jid}`));
  }
  return lines.join('\n');
}

export default {
  name: 'autodownload',
  description: 'Auto-detect supported media links and run existing downloader commands',
  version: '1.0.0',
  author: 'Are Martins',

  async onMessage(ctx) {
    if (ctx.command || !ctx.text || ctx.raw?.key?.remoteJid === 'status@broadcast') return;

    const config = getAutodownloadConfig();
    if (!isConfigEnabledForChat(ctx, config)) return;

    const match = extractSingleSupportedUrl(ctx.text);
    if (!match) return;

    try {
      await dispatchExistingCommand(ctx, match.command, match.url);
    } catch (error) {
      pluginLogger.error({ error, command: match.command, url: match.url }, 'Dispatch error');
    }
  },

  commands: [
    {
      name: 'autodownload',
      aliases: ['autodl', 'autourl'],
      description: 'Configure automatic downloader execution for plain links',
      usage: '.autodownload <on|off|p|g|all|jid,jid>',
      category: 'owner',
      ownerOnly: true,
      async execute(ctx) {
        const action = (ctx.args[0] || 'status').toLowerCase();
        const rawInput = ctx.args.join(' ').trim();
        const config = getAutodownloadConfig();

        const parseJidList = (input) => String(input || '')
          .split(',')
          .map(item => normalizeChatJid(item, ctx))
          .filter(Boolean);

        if (action === 'status') {
          return await ctx.reply(`${formatStatus(config)}\n\nUsage:\n.autodownload on\n.autodownload off\n.autodownload p\n.autodownload g\n.autodownload all\n.autodownload <jid>,<jid>`);
        }

        if (action === 'on') {
          setAutodownloadConfig({ mode: 'all' });
          return await ctx.reply('Auto-download is now ON for all chats.');
        }

        if (action === 'off') {
          setAutodownloadConfig({ mode: 'off' });
          return await ctx.reply('Auto-download is now OFF.');
        }

        if (action === 'p') {
          setAutodownloadConfig({ mode: 'personal' });
          return await ctx.reply('Auto-download is now ON for personal chats only.');
        }

        if (action === 'g') {
          setAutodownloadConfig({ mode: 'group' });
          return await ctx.reply('Auto-download is now ON for group chats only.');
        }

        if (action === 'all') {
          setAutodownloadConfig({ mode: 'all' });
          return await ctx.reply('Auto-download is now ON for both personal chats and groups.');
        }

        const jids = parseJidList(rawInput);
        if (jids.length > 0) {
          setAutodownloadConfig({ mode: 'include', includeJids: jids.map(jid => jid.toLowerCase()) });
          return await ctx.reply(`Auto-download is now ON only for:\n${jids.join('\n')}`);
        }

        await ctx.reply('Usage: .autodownload <on|off|p|g|all|jid,jid>');
      }
    }
  ]
};

