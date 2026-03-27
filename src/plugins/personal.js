/**
 * Personal management plugin
 */
import { jidNormalizedUser } from '@whiskeysockets/baileys';
import { getQuotedMediaTarget } from '../utils/quotedMedia.js';
import { downloadMediaBuffer, hasValidMediaHeader } from '../utils/mediaDecode.js';

export default {
  name: 'personal',
  description: 'Owner personal management commands',
  version: '1.0.0',
  author: 'MATDEV',
  commands: [
    {
      name: 'setpp',
      description: 'Update owner profile picture',
      usage: 'Reply to an image with .setpp',
      category: 'personal',
      ownerOnly: true,
      adminOnly: false,
      groupOnly: false,
      cooldown: 3,
      async execute(ctx) {
        const media = getQuotedMediaTarget(ctx, ['image']);
        
        if (!media) {
          return ctx.reply('Please reply to an image with .setpp');
        }
        try {
          const buffer = await downloadMediaBuffer(ctx, media);
          if (!hasValidMediaHeader(buffer)) {
            return ctx.reply('❌ The downloaded image appears corrupted or unsupported.');
          }
          const botId = jidNormalizedUser(ctx.platformAdapter.client.user.id);
          await ctx.platformAdapter.client.updateProfilePicture(botId, buffer);
          await ctx.reply('✅ Profile picture updated successfully.');
        } catch (error) {
          await ctx.reply(`❌ Failed to update profile picture: ${error.message}`);
        }
      }
    },
,
    {
      name: 'setbio',
      description: 'Update owner bio',
      usage: '.setbio <text>',
      category: 'personal',
      ownerOnly: true,
      adminOnly: false,
      groupOnly: false,
      cooldown: 3,
      async execute(ctx) {
        if (!ctx.args[0]) return ctx.reply('Please provide a new bio.');
        try {
          await ctx.platformAdapter.client.updateProfileStatus(ctx.args.join(' '));
          await ctx.reply('✅ Bio updated successfully.');
        } catch (error) {
          await ctx.reply(`❌ Failed to update bio: ${error.message}`);
        }
      }
    },
    {
      name: 'clear',
      aliases: ['clearchat'],
      description: 'Clear chat conversation (local)',
      usage: '.clear',
      category: 'general',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 3,
      execute: async (ctx) => {
        try {
          // Allow .clear in any chat (group, owner, or private)
          if (ctx.platform !== 'whatsapp') {
            return await ctx.reply('❌ This command is only available on WhatsApp.');
          }
          // Delete the command message first
          try {
            await ctx._adapter.deleteMessage(ctx.chatId, ctx.messageId);
          } catch (e) {
            // Ignore if deletion fails
          }
          await ctx._adapter.clearChat(ctx.chatId);
        } catch (error) {
          console.error(`Error in .clear command: ${error.message}`);
          await ctx.reply('❌ Failed to clear chat.');
        }
      }
    }
  ]
};
