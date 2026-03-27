/**
 * Group management plugin
 */
import { getQuotedMediaTarget } from '../utils/quotedMedia.js';
import { downloadMediaBuffer, hasValidMediaHeader } from '../utils/mediaDecode.js';
import { findParticipant, normalizeWhatsAppJid, resolveParticipantFromContext } from '../utils/whatsappJid.js';

export default {
  name: 'group',
  description: 'Group management commands',
  version: '1.0.0',
  author: 'MATDEV',
  commands: [
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
          mentions.push(jid);
          return `@${jid.split('@')[0]}`;
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
          await ctx.platformAdapter.client.groupParticipantsUpdate(ctx.chatId, [user], 'add');
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
          const code = await ctx.platformAdapter.client.groupInviteCode(ctx.chatId);
          await ctx.reply(`https://chat.whatsapp.com/${code}`);
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
        const botId = ctx.platformAdapter.client.user?.id || ctx.platformAdapter.client.user?.jid;
        const botLid = ctx.platformAdapter.client.user?.lid;
        const groupMetadata = await ctx.platformAdapter.client.groupMetadata(ctx.chatId);
        
        const botParticipant = findParticipant(groupMetadata.participants, botId, botLid);
        
        if (!botParticipant || !botParticipant.admin) {
          return ctx.reply('I am not an admin in this group.');
        }
        
        const targetParticipant = await resolveParticipantFromContext(ctx, groupMetadata);
        if (!targetParticipant) {
          return ctx.reply('Please mention a user or reply to their message.');
        }

        try {
          // Use the participant's actual ID (LID format) from group metadata
          await ctx.platformAdapter.client.groupParticipantsUpdate(ctx.chatId, [targetParticipant.id], 'promote');
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
        const botId = ctx.platformAdapter.client.user?.id || ctx.platformAdapter.client.user?.jid;
        const botLid = ctx.platformAdapter.client.user?.lid;
        const groupMetadata = await ctx.platformAdapter.client.groupMetadata(ctx.chatId);
        const botParticipant = findParticipant(groupMetadata.participants, botId, botLid);
        
        if (!botParticipant || !botParticipant.admin) {
          return ctx.reply('I am not an admin in this group.');
        }
        
        const targetParticipant = await resolveParticipantFromContext(ctx, groupMetadata);
        if (!targetParticipant) {
          return ctx.reply('Please mention a user or reply to their message.');
        }

        // Check if target is superadmin - only superadmins can demote superadmins
        if (targetParticipant.admin === 'superadmin') {
          return ctx.reply('Cannot demote superadmin. Only the group creator can demote superadmins.');
        }

        try {
          await ctx.platformAdapter.client.groupParticipantsUpdate(ctx.chatId, [targetParticipant.id], 'demote');
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
        const botId = ctx.platformAdapter.client.user?.id || ctx.platformAdapter.client.user?.jid;
        const botLid = ctx.platformAdapter.client.user?.lid;
        const groupMetadata = await ctx.platformAdapter.client.groupMetadata(ctx.chatId);
        const botParticipant = findParticipant(groupMetadata.participants, botId, botLid);
        
        if (!botParticipant || !botParticipant.admin) {
          return ctx.reply('I am not an admin in this group.');
        }
        
        const targetParticipant = await resolveParticipantFromContext(ctx, groupMetadata);
        if (!targetParticipant) {
          return ctx.reply('Please mention a user or reply to their message.');
        }

        if (targetParticipant.admin === 'superadmin') {
          return ctx.reply('Cannot kick the group creator (superadmin).');
        }

        try {
          await ctx.platformAdapter.client.groupParticipantsUpdate(ctx.chatId, [targetParticipant.id], 'remove');
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
                await ctx.platformAdapter.client.groupSettingUpdate(ctx.chatId, 'not_announcement');
                await ctx.reply('✅ Group chat is now open for everyone.');
            } else if (action === 'close') {
                await ctx.platformAdapter.client.groupSettingUpdate(ctx.chatId, 'announcement');
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
                await ctx.platformAdapter.client.groupSettingUpdate(ctx.chatId, 'not_announcement');
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
                await ctx.platformAdapter.client.groupSettingUpdate(ctx.chatId, 'announcement');
                await ctx.reply('✅ Group chat is now closed. Only admins can send messages.');
            } catch (error) {
                await ctx.reply(`❌ Failed to close group: ${error.message}`);
            }
        }
    }
  ]
};
