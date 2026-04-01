import { buildMentionEntry, formatMentionHandle } from '../utils/mentions.js';
import { extractJidLike } from '../utils/whatsappJid.js';
import {
  getWelcomeState,
  isWelcomeEnabledForGroup,
  patchWelcomeState
} from '../state/welcome.js';
import { resolveCanonicalJid } from '../state/knownEntities.js';
import { fetchProfilePictureBuffer } from '../domains/whatsapp/profileMedia.js';

function parseGroupTargets(args = [], ctx = null) {
  const raw = args.join(' ');
  const items = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      if (item.toLowerCase() === 'here' && ctx?.isGroup) return ctx.chatId;
      return item;
    })
    .filter((item) => String(item).endsWith('@g.us'));

  return Array.from(new Set(items));
}

function formatStateSummary(state) {
  const lines = [
    `Welcome messages: ${state.enabled ? 'on' : 'off'}`,
    `Scope: ${state.scope}`
  ];

  if (state.groups.length) {
    lines.push(`Groups: ${state.groups.join(', ')}`);
  }

  lines.push('');
  lines.push(`Welcome template: ${state.welcomeTemplate}`);
  lines.push(`Goodbye template: ${state.goodbyeTemplate}`);
  lines.push('');
  lines.push('Usage:');
  lines.push('.welcome status');
  lines.push('.welcome on');
  lines.push('.welcome off');
  lines.push('.welcome all');
  lines.push('.welcome only <groupJid,groupJid>');
  lines.push('.welcome except <groupJid,groupJid>');
  lines.push('.welcome text <message>');
  lines.push('.welcome bye <message>');
  lines.push('');
  lines.push('Template variables:');
  lines.push('@user or {user} = mentioned user');
  lines.push('{group} = group name');
  lines.push('{jid} = user JID');

  return lines.join('\n');
}

function renderTemplate(template, { mentionHandle, groupName, participantJid }) {
  return String(template || '')
    .replace(/@user\b/g, mentionHandle)
    .replace(/\{user\}/g, mentionHandle)
    .replace(/\{group\}/g, groupName)
    .replace(/\{jid\}/g, participantJid);
}

async function handleParticipantUpdate(adapter, update) {
  const groupJid = update?.id;
  if (!groupJid || !isWelcomeEnabledForGroup(groupJid)) return;

  const action = update?.action;
  if (!['add', 'remove'].includes(action)) return;

  const participants = Array.isArray(update?.participants) ? update.participants : [];
  if (!participants.length) return;

  let metadata = null;
  try {
    metadata = await adapter.client.groupMetadata(groupJid);
  } catch {}
  const groupName = metadata?.subject || groupJid;
  const state = getWelcomeState();
  const template = action === 'add' ? state.welcomeTemplate : state.goodbyeTemplate;

  for (const participant of participants) {
    const participantJid = extractJidLike(participant);
    if (!participantJid) continue;

    const mentionTarget = resolveCanonicalJid(participantJid) || participantJid;
    const mention = buildMentionEntry(mentionTarget);
    const text = renderTemplate(template, {
      mentionHandle: mention?.handle || formatMentionHandle(mentionTarget),
      groupName,
      participantJid: mentionTarget
    });
    const profilePicture = await fetchProfilePictureBuffer(adapter.client, mentionTarget);

    if (profilePicture) {
      await adapter.sendMedia(groupJid, profilePicture, 'image', {
        mimetype: 'image/jpeg',
        caption: text,
        ...(mention ? { mentions: [mention.jid] } : {})
      });
      continue;
    }

    await adapter.sendMessage(groupJid, text, mention ? { mentions: [mention.jid] } : {});
  }
}

export default {
  name: 'welcome',
  description: 'Group welcome and goodbye messages',
  version: '1.0.0',
  author: 'Are Martins',
  async onLoad(bot) {
    const whatsapp = bot.getAdapter('whatsapp');
    if (!whatsapp?.client?.ev) return null;

    const handler = async (update) => {
      try {
        await handleParticipantUpdate(whatsapp, update);
      } catch (error) {
        bot.logger?.warn?.({ error, update }, 'Welcome handler failed');
      }
    };

    whatsapp.client.ev.on('group-participants.update', handler);
    return () => {
      whatsapp.client.ev.off?.('group-participants.update', handler);
      whatsapp.client.ev.removeListener?.('group-participants.update', handler);
    };
  },
  commands: [
    {
      name: 'welcome',
      description: 'Configure welcome and goodbye messages',
      usage: '.welcome <status|on|off|all|only|except|text|bye>',
      category: 'owner',
      ownerOnly: true,
      adminOnly: false,
      groupOnly: false,
      cooldown: 3,
      async execute(ctx) {
        const action = String(ctx.args[0] || 'status').toLowerCase();
        const state = getWelcomeState();

        if (action === 'status') {
          await ctx.reply(formatStateSummary(state));
          return;
        }

        if (action === 'on' || action === 'off') {
          const next = patchWelcomeState({ enabled: action === 'on' });
          await ctx.reply(`Welcome messages ${next.enabled ? 'enabled' : 'disabled'}.`);
          return;
        }

        if (action === 'all') {
          const next = patchWelcomeState({ scope: 'all', groups: [] });
          await ctx.reply(`Welcome scope set to ${next.scope}.`);
          return;
        }

        if (action === 'only' || action === 'except') {
          const groups = parseGroupTargets(ctx.args.slice(1), ctx);
          if (!groups.length) {
            await ctx.reply(`Usage: .welcome ${action} <groupJid,groupJid>\nTip: use \`here\` inside a group.`);
            return;
          }

          const next = patchWelcomeState({ scope: action, groups });
          await ctx.reply(`Welcome scope set to ${next.scope} for:\n${groups.join('\n')}`);
          return;
        }

        if (action === 'text') {
          const message = ctx.args.slice(1).join(' ').trim();
          if (!message) {
            await ctx.reply('Usage: .welcome text <message>\nVariables: @user, {user}, {group}, {jid}');
            return;
          }

          patchWelcomeState({ welcomeTemplate: message });
          await ctx.reply(`Welcome message updated.\nPreview: ${message}`);
          return;
        }

        if (action === 'bye') {
          const message = ctx.args.slice(1).join(' ').trim();
          if (!message) {
            await ctx.reply('Usage: .welcome bye <message>\nVariables: @user, {user}, {group}, {jid}');
            return;
          }

          patchWelcomeState({ goodbyeTemplate: message });
          await ctx.reply(`Goodbye message updated.\nPreview: ${message}`);
          return;
        }

        await ctx.reply(formatStateSummary(state));
      }
    }
  ]
};
