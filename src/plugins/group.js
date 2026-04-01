/**
 * Group management plugin
 */
import { getQuotedMediaTarget } from '../utils/quotedMedia.js';
import { downloadMediaBuffer, hasValidMediaHeader } from '../utils/mediaDecode.js';
import { normalizeWhatsAppJid } from '../utils/whatsappJid.js';
import { getGroupActionContext, isGroupAdminParticipant } from '../domains/whatsapp/groupContext.js';
import {
  addGroupParticipant,
  approveGroupJoinRequests,
  demoteGroupParticipant,
  getGroupInviteLink,
  listGroupJoinRequests,
  promoteGroupParticipant,
  rejectGroupJoinRequests,
  removeGroupParticipant,
  setGroupChatMode,
  setGroupEphemeralDuration,
  setGroupJoinApprovalMode
} from '../domains/whatsapp/groupActions.js';
import { getGroupSettings, setGroupSetting } from '../state/groupSettings.js';
import { buildMentionEntry } from '../utils/mentions.js';

const EPHEMERAL_PRESETS = {
  off: 0,
  '0': 0,
  none: 0,
  '24h': 24 * 60 * 60,
  '1d': 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
  '90d': 90 * 24 * 60 * 60
};

function formatEphemeralDuration(seconds) {
  if (!seconds) return 'off';
  if (seconds === 24 * 60 * 60) return '24h';
  if (seconds === 7 * 24 * 60 * 60) return '7d';
  if (seconds === 90 * 24 * 60 * 60) return '90d';
  return `${seconds}s`;
}

function parseEphemeralDuration(input) {
  const value = String(input || '').trim().toLowerCase();
  if (!value) return null;
  if (Object.prototype.hasOwnProperty.call(EPHEMERAL_PRESETS, value)) {
    return EPHEMERAL_PRESETS[value];
  }
  return null;
}

function formatJoinRequestTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString('en-US');
}

function resolveJoinRequestTargets(requests, input) {
  const value = String(input || '').trim().toLowerCase();
  if (!value) return [];
  if (value === 'all') {
    return requests
      .map((request) => request?.jid)
      .filter((jid) => typeof jid === 'string' && jid);
  }

  const index = Number(value);
  if (Number.isInteger(index) && index >= 1 && index <= requests.length) {
    const targetJid = requests[index - 1]?.jid;
    return targetJid ? [targetJid] : [];
  }

  const normalizedJid = normalizeWhatsAppJid(value);
  if (!normalizedJid) return [];

  return requests
    .filter((request) => request?.jid === normalizedJid)
    .map((request) => request.jid);
}

function formatMentionList(values = []) {
  const mentions = [];
  const handles = values
    .map((value) => buildMentionEntry(value))
    .filter(Boolean)
    .map((entry) => {
      mentions.push(entry.jid);
      return entry.handle;
    });

  return { handles, mentions };
}

export default {
  name: 'group',
  description: 'Group management commands',
  version: '1.1.0',
  author: 'Are Martins',
  commands: [
    {
      name: 'joinapproval',
      aliases: ['approvalmode', 'reqmode'],
      description: 'Manage group join approval mode',
      usage: '.joinapproval <on|off>',
      category: 'group',
      ownerOnly: false,
      groupOnly: true,
      adminOnly: true,
      cooldown: 3,
      async execute(ctx) {
        const action = ctx.args[0]?.toLowerCase();
        const metadata = await ctx.platformAdapter.client.groupMetadata(ctx.chatId);
        const currentValue = Boolean(metadata?.joinApprovalMode);

        if (!action) {
          const storedSettings = getGroupSettings(ctx.chatId);
          const storedValue = typeof storedSettings.joinRequestsEnabled === 'boolean'
            ? storedSettings.joinRequestsEnabled
            : null;
          await ctx.reply(
            [
              `Current join approval mode: ${currentValue ? 'on' : 'off'}`,
              `Stored preference: ${storedValue === null ? 'unknown' : (storedValue ? 'on' : 'off')}`,
              '',
              'Usage:',
              '.joinapproval on',
              '.joinapproval off'
            ].join('\n')
          );
          return;
        }

        if (action !== 'on' && action !== 'off') {
          await ctx.reply('Usage: .joinapproval <on|off>');
          return;
        }

        try {
          const enabled = action === 'on';
          await setGroupJoinApprovalMode(ctx.platformAdapter.client, ctx.chatId, enabled);
          setGroupSetting(ctx.chatId, 'joinRequestsEnabled', enabled);
          await ctx.reply(`Join approval mode set to ${enabled ? 'on' : 'off'}.`);
        } catch (error) {
          await ctx.reply(`Failed to update join approval mode: ${error.message}`);
        }
      }
    },
    {
      name: 'requests',
      aliases: ['joinrequests', 'reqs'],
      description: 'List pending group join requests',
      usage: '.requests',
      category: 'group',
      ownerOnly: false,
      groupOnly: true,
      adminOnly: true,
      cooldown: 3,
      async execute(ctx) {
        try {
          const requests = await listGroupJoinRequests(ctx.platformAdapter.client, ctx.chatId);
          if (!requests.length) {
            await ctx.reply('No pending join requests.');
            return;
          }

          const mentions = [];
          const lines = requests.map((request, index) => {
            const requestedAt = formatJoinRequestTime(request?.t);
            const mention = buildMentionEntry(request?.jid);
            if (mention) mentions.push(mention.jid);
            return `${index + 1}. ${mention?.handle || request.jid}${requestedAt ? ` | ${requestedAt}` : ''}`;
          });

          await ctx.reply(
            [
              `Pending join requests: ${requests.length}`,
              ...lines,
              '',
              'Use .approve <number|jid|all> or .reject <number|jid|all>'
            ].join('\n'),
            mentions.length ? { mentions } : {}
          );
        } catch (error) {
          await ctx.reply(`Failed to fetch join requests: ${error.message}`);
        }
      }
    },
    {
      name: 'approve',
      description: 'Approve pending group join requests',
      usage: '.approve <number|jid|all>',
      category: 'group',
      ownerOnly: false,
      groupOnly: true,
      adminOnly: true,
      cooldown: 3,
      async execute(ctx) {
        const input = ctx.args[0];
        if (!input) {
          await ctx.reply('Usage: .approve <number|jid|all>');
          return;
        }

        try {
          const requests = await listGroupJoinRequests(ctx.platformAdapter.client, ctx.chatId);
          if (!requests.length) {
            await ctx.reply('No pending join requests.');
            return;
          }

          const targets = resolveJoinRequestTargets(requests, input);
          if (!targets.length) {
            await ctx.reply('Join request not found. Use .requests first.');
            return;
          }

          const response = await approveGroupJoinRequests(ctx.platformAdapter.client, ctx.chatId, targets);
          const success = response.filter((entry) => String(entry.status) === '200').map((entry) => entry.jid).filter(Boolean);
          const failed = response.filter((entry) => String(entry.status) !== '200').map((entry) => `${entry.jid || 'unknown'} (${entry.status})`);

          const successMentions = formatMentionList(success);
          const lines = [];
          if (success.length) lines.push(`Approved: ${successMentions.handles.join(', ')}`);
          if (failed.length) lines.push(`Failed: ${failed.join(', ')}`);
          await ctx.reply(
            lines.join('\n') || 'No join requests were approved.',
            successMentions.mentions.length ? { mentions: successMentions.mentions } : {}
          );
        } catch (error) {
          await ctx.reply(`Failed to approve join request(s): ${error.message}`);
        }
      }
    },
    {
      name: 'reject',
      description: 'Reject pending group join requests',
      usage: '.reject <number|jid|all>',
      category: 'group',
      ownerOnly: false,
      groupOnly: true,
      adminOnly: true,
      cooldown: 3,
      async execute(ctx) {
        const input = ctx.args[0];
        if (!input) {
          await ctx.reply('Usage: .reject <number|jid|all>');
          return;
        }

        try {
          const requests = await listGroupJoinRequests(ctx.platformAdapter.client, ctx.chatId);
          if (!requests.length) {
            await ctx.reply('No pending join requests.');
            return;
          }

          const targets = resolveJoinRequestTargets(requests, input);
          if (!targets.length) {
            await ctx.reply('Join request not found. Use .requests first.');
            return;
          }

          const response = await rejectGroupJoinRequests(ctx.platformAdapter.client, ctx.chatId, targets);
          const success = response.filter((entry) => String(entry.status) === '200').map((entry) => entry.jid).filter(Boolean);
          const failed = response.filter((entry) => String(entry.status) !== '200').map((entry) => `${entry.jid || 'unknown'} (${entry.status})`);

          const successMentions = formatMentionList(success);
          const lines = [];
          if (success.length) lines.push(`Rejected: ${successMentions.handles.join(', ')}`);
          if (failed.length) lines.push(`Failed: ${failed.join(', ')}`);
          await ctx.reply(
            lines.join('\n') || 'No join requests were rejected.',
            successMentions.mentions.length ? { mentions: successMentions.mentions } : {}
          );
        } catch (error) {
          await ctx.reply(`Failed to reject join request(s): ${error.message}`);
        }
      }
    },
    {
      name: 'ephemeral',
      aliases: ['disappearing', 'dmode'],
      description: 'Manage disappearing messages in the group',
      usage: '.ephemeral <off|24h|7d|90d>',
      category: 'group',
      ownerOnly: false,
      groupOnly: true,
      adminOnly: true,
      cooldown: 3,
      async execute(ctx) {
        const action = ctx.args[0]?.toLowerCase();
        const metadata = await ctx.platformAdapter.client.groupMetadata(ctx.chatId);
        const currentDuration = Number(metadata?.ephemeralDuration) || 0;

        if (!action) {
          const storedSettings = getGroupSettings(ctx.chatId);
          const storedDuration = Number(storedSettings.ephemeralDuration) || 0;
          await ctx.reply(
            [
              `Current disappearing messages: ${formatEphemeralDuration(currentDuration)}`,
              `Stored preference: ${formatEphemeralDuration(storedDuration)}`,
              '',
              'Usage:',
              '.ephemeral off',
              '.ephemeral 24h',
              '.ephemeral 7d',
              '.ephemeral 90d'
            ].join('\n')
          );
          return;
        }

        const duration = parseEphemeralDuration(action);
        if (duration === null) {
          await ctx.reply('Usage: .ephemeral <off|24h|7d|90d>');
          return;
        }

        try {
          await setGroupEphemeralDuration(ctx.platformAdapter.client, ctx.chatId, duration);
          setGroupSetting(ctx.chatId, 'ephemeralDuration', duration);
          await ctx.reply(`Disappearing messages set to ${formatEphemeralDuration(duration)}.`);
        } catch (error) {
          await ctx.reply(`Failed to update disappearing messages: ${error.message}`);
        }
      }
    },
    {
      name: 'tag',
      aliases: ['everyone', 'all'],
      description: 'Tag everyone or admins in the group',
      usage: '.tag [admin]',
      category: 'group',
      ownerOnly: false,
      groupOnly: true,
      adminOnly: true,
      cooldown: 3,
      async execute(ctx) {
        const metadata = await ctx.platformAdapter.client.groupMetadata(ctx.chatId);
        const participants = metadata.participants;
        const isAdminTag = ctx.args[0]?.toLowerCase() === 'admin';
        let targetParticipants = participants;
        let message = isAdminTag ? '📢 *Tagging Admins:*' : '📢 *Tagging Everyone:*';
        if (isAdminTag) {
          targetParticipants = participants.filter(p => p.admin !== null);
        }
        
        const mentions = [];
        const tagList = targetParticipants.map(p => {
          const jid = normalizeWhatsAppJid(p.id);
          const mention = buildMentionEntry(jid);
          mentions.push(mention?.jid || jid);
          return mention?.handle || `@${jid.split('@')[0]}`;
        }).join(' ');

        await ctx.platformAdapter.client.sendMessage(ctx.chatId, {
          text: `${message}\n\n${tagList}`,
          mentions: mentions
        });
      }
    },
    {
      name: 'gbio',
      description: 'Update group description',
      usage: '.gbio <text>',
      category: 'group',
      ownerOnly: false,
      groupOnly: true,
      adminOnly: true,
      cooldown: 3,
      async execute(ctx) {
        if (!ctx.args[0]) return ctx.reply('Please provide a new group bio.');
        try {
          await ctx.platformAdapter.client.groupUpdateDescription(ctx.chatId, ctx.args.join(' '));
          await ctx.reply('✅ Group bio updated successfully.');
        } catch (error) {
          await ctx.reply(`❌ Failed to update group bio: ${error.message}`);
        }
      }
    },
    {
      name: 'gpp',
      description: 'Update group profile picture',
      usage: 'Reply to an image with .gpp',
      category: 'group',
      ownerOnly: false,
      groupOnly: true,
      adminOnly: true,
      cooldown: 3,
      async execute(ctx) {
        const media = getQuotedMediaTarget(ctx, ['image']);
        if (!media) {
          return ctx.reply('Please reply to an image with .gpp');
        }
        try {
          const buffer = await downloadMediaBuffer(ctx, media);
          if (!hasValidMediaHeader(buffer)) {
            return ctx.reply('❌ The downloaded image appears corrupted or unsupported.');
          }
          await ctx.platformAdapter.client.updateProfilePicture(ctx.chatId, buffer);
          await ctx.reply('✅ Group profile picture updated.');
        } catch (error) {
          await ctx.reply(`❌ Failed to update group profile picture: ${error.message}`);
        }
      }
    },
    {
      name: 'gname',
      description: 'Update group name',
      usage: '.gname <text>',
      category: 'group',
      ownerOnly: false,
      groupOnly: true,
      adminOnly: true,
      cooldown: 3,
      async execute(ctx) {
        if (!ctx.args[0]) return ctx.reply('Please provide a new group name.');
        try {
          await ctx.platformAdapter.client.groupUpdateSubject(ctx.chatId, ctx.args.join(' '));
          await ctx.reply('✅ Group name updated.');
        } catch (error) {
          await ctx.reply(`❌ Failed to update group name: ${error.message}`);
        }
      }
    },
    {
      name: 'add',
      description: 'Add a user to the group',
      usage: '.add 234...',
      category: 'group',
      ownerOnly: false,
      groupOnly: true,
      adminOnly: true,
      cooldown: 3,
      async execute(ctx) {
        if (!ctx.args[0]) return ctx.reply('Please provide a phone number to add.');
        const user = normalizeWhatsAppJid(ctx.args[0]);
        if (!user) return ctx.reply('Please provide a valid WhatsApp number or JID.');
        try {
          await addGroupParticipant(ctx.platformAdapter.client, ctx.chatId, user);
          await ctx.reply('✅ User added to group.');
        } catch (error) {
          await ctx.reply(`❌ Failed to add user: ${error.message}`);
        }
      }
    },
    {
      name: 'link',
      description: 'Get group invite link',
      usage: '.link',
      category: 'group',
      ownerOnly: false,
      groupOnly: true,
      adminOnly: true,
      cooldown: 3,
      async execute(ctx) {
        try {
          const link = await getGroupInviteLink(ctx.platformAdapter.client, ctx.chatId);
          await ctx.reply(link);
        } catch (error) {
          await ctx.reply(`❌ Failed to get invite link: ${error.message}`);
        }
      }
    },
    {
      name: 'promote',
      description: 'Promote a user to admin',
      usage: '.promote @user',
      category: 'group',
      ownerOnly: false,
      groupOnly: true,
      adminOnly: true,
      cooldown: 3,
      async execute(ctx) {
        const { botParticipant, targetParticipant } = await getGroupActionContext(ctx, { resolveTarget: true });

        if (!isGroupAdminParticipant(botParticipant)) {
          return ctx.reply('I am not an admin in this group.');
        }

        if (!targetParticipant) {
          return ctx.reply('Please mention a user or reply to their message.');
        }

        try {
          // Use the participant's actual ID (LID format) from group metadata
          await promoteGroupParticipant(ctx.platformAdapter.client, ctx.chatId, targetParticipant.id);
          await ctx.reply(`✅ User promoted to admin.`);
        } catch (error) {
          await ctx.reply(`❌ Failed to promote: ${error.message}`);
        }
      }
    },
    {
      name: 'demote',
      description: 'Demote a user from admin',
      usage: '.demote @user',
      category: 'group',
      ownerOnly: false,
      groupOnly: true,
      adminOnly: true,
      cooldown: 3,
      async execute(ctx) {
        const { botParticipant, targetParticipant } = await getGroupActionContext(ctx, { resolveTarget: true });

        if (!isGroupAdminParticipant(botParticipant)) {
          return ctx.reply('I am not an admin in this group.');
        }

        if (!targetParticipant) {
          return ctx.reply('Please mention a user or reply to their message.');
        }

        // Check if target is superadmin - only superadmins can demote superadmins
        if (targetParticipant.admin === 'superadmin') {
          return ctx.reply('Cannot demote superadmin. Only the group creator can demote superadmins.');
        }

        try {
          await demoteGroupParticipant(ctx.platformAdapter.client, ctx.chatId, targetParticipant.id);
          await ctx.reply(`✅ User demoted from admin.`);
        } catch (error) {
          await ctx.reply(`❌ Failed to demote: ${error.message}`);
        }
      }
    },
    {
      name: 'kick',
      aliases: ['remove'],
      description: 'Remove a user from the group',
      usage: '.kick @user',
      category: 'group',
      ownerOnly: false,
      groupOnly: true,
      adminOnly: true,
      cooldown: 3,
      async execute(ctx) {
        const { botParticipant, targetParticipant } = await getGroupActionContext(ctx, { resolveTarget: true });

        if (!isGroupAdminParticipant(botParticipant)) {
          return ctx.reply('I am not an admin in this group.');
        }

        if (!targetParticipant) {
          return ctx.reply('Please mention a user or reply to their message.');
        }

        if (targetParticipant.admin === 'superadmin') {
          return ctx.reply('Cannot kick the group creator (superadmin).');
        }

        try {
          await removeGroupParticipant(ctx.platformAdapter.client, ctx.chatId, targetParticipant.id);
          await ctx.reply(`✅ User removed from group.`);
        } catch (error) {
          await ctx.reply(`❌ Failed to kick: ${error.message}`);
        }
      }
    },
    {
        name: 'group',
        description: 'Open or close group chat',
        usage: '.group open/close',
        category: 'group',
        ownerOnly: false,
        groupOnly: true,
        adminOnly: true,
        cooldown: 3,
        async execute(ctx) {
            const action = ctx.args[0]?.toLowerCase();
            if (action === 'open') {
                await setGroupChatMode(ctx.platformAdapter.client, ctx.chatId, 'open');
                await ctx.reply('✅ Group chat is now open for everyone.');
            } else if (action === 'close') {
                await setGroupChatMode(ctx.platformAdapter.client, ctx.chatId, 'close');
                await ctx.reply('✅ Group chat is now closed. Only admins can send messages.');
            } else {
                await ctx.reply('Usage: .group open/close');
            }
        }
    },
    {
        name: 'open',
        description: 'Open group chat for everyone',
        usage: '.open',
        category: 'group',
        ownerOnly: false,
        groupOnly: true,
        adminOnly: true,
        cooldown: 3,
        async execute(ctx) {
            try {
                await setGroupChatMode(ctx.platformAdapter.client, ctx.chatId, 'open');
                await ctx.reply('✅ Group chat is now open for everyone.');
            } catch (error) {
                await ctx.reply(`❌ Failed to open group: ${error.message}`);
            }
        }
    },
    {
        name: 'close',
        description: 'Close group chat (admins only)',
        usage: '.close',
        category: 'group',
        ownerOnly: false,
        groupOnly: true,
        adminOnly: true,
        cooldown: 3,
        async execute(ctx) {
            try {
                await setGroupChatMode(ctx.platformAdapter.client, ctx.chatId, 'close');
                await ctx.reply('✅ Group chat is now closed. Only admins can send messages.');
            } catch (error) {
                await ctx.reply(`❌ Failed to close group: ${error.message}`);
            }
        }
    }
  ]
};

