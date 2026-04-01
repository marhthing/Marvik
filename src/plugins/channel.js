import { parseNewsletterMessages, resolveNewsletterJid } from '../domains/whatsapp/channelUtils.js';
import { normalizeWhatsAppJid } from '../utils/whatsappJid.js';

function formatMetadata(metadata, jid) {
  return [
    `Name: ${metadata?.name || 'Unknown'}`,
    `JID: ${jid}`,
    `Invite: ${metadata?.invite || 'Unknown'}`,
    `Subscribers: ${metadata?.subscribers ?? 'Unknown'}`,
    `Verification: ${metadata?.verification || 'Unknown'}`,
    `Mute: ${metadata?.mute_state || 'Unknown'}`,
    '',
    metadata?.description || 'No description.'
  ].join('\n');
}

function formatFetchedMessages(messages) {
  if (!messages.length) {
    return 'No recent channel posts found.';
  }

  return messages.slice(0, 10).map((message, index) => {
    const timestamp = Number(message.timestamp)
      ? new Date(Number(message.timestamp) * 1000).toLocaleString('en-US')
      : 'Unknown time';
    return [
      `${index + 1}. ${message.id || 'unknown'}`,
      `Time: ${timestamp}`,
      `Views: ${message.views || 'Unknown'}`,
      message.text || '[Non-text post]'
    ].join('\n');
  }).join('\n\n');
}

async function requireNewsletterTarget(ctx) {
  const input = ctx.args[1] || ctx.args[0];
  if (!input) {
    await ctx.reply('Provide a channel JID or invite code/link.');
    return null;
  }

  try {
    return await resolveNewsletterJid(ctx.platformAdapter.client, input);
  } catch (error) {
    await ctx.reply(`Failed to resolve channel: ${error.message}`);
    return null;
  }
}

function getActionInput(ctx, action) {
  const prefix = ctx.bot?.config?.prefix || ctx.platformAdapter?.config?.prefix || '';
  let rest = String(ctx.text || '').trim();
  if (prefix && rest.startsWith(prefix)) {
    rest = rest.slice(prefix.length).trim();
  }
  if (ctx.command && rest.toLowerCase().startsWith(ctx.command)) {
    rest = rest.slice(ctx.command.length).trim();
  }
  if (action && rest.toLowerCase().startsWith(action)) {
    rest = rest.slice(action.length).trim();
  }
  return rest.trim();
}

function splitPipeInput(value = '') {
  const parts = String(value || '').split('|');
  return parts.map((part) => part.trim()).filter(Boolean);
}

export default {
  name: 'channel',
  description: 'WhatsApp channel/newsletter tools',
  version: '1.1.0',
  author: 'Are Martins',
  commands: [
    {
      name: 'channel',
      aliases: ['newsletter'],
      description: 'Inspect and manage WhatsApp channels',
      usage: '.channel <info|follow|unfollow|mute|unmute|posts> <jid|invite|link> [count]',
      category: 'owner',
      ownerOnly: true,
      adminOnly: false,
      groupOnly: false,
      cooldown: 3,
      async execute(ctx) {
        const action = ctx.args[0]?.toLowerCase();
        if (!action) {
          await ctx.reply(
            'Usage:\n.channel info <jid|invite|link>\n.channel follow <jid|invite|link>\n.channel unfollow <jid|invite|link>\n.channel mute <jid|invite|link>\n.channel unmute <jid|invite|link>\n.channel posts <jid|invite|link> [count]\n.channel create <name> | [description]\n.channel rename <jid|invite|link> | <name>\n.channel desc <jid|invite|link> | <description>\n.channel admins <jid|invite|link>\n.channel subscribe <jid|invite|link>\n.channel owner <jid|invite|link> <newOwnerJid>\n.channel demote <jid|invite|link> <userJid>\n.channel delete <jid|invite|link>'
          );
          return;
        }

        if (action === 'create') {
          const [name, description = ''] = splitPipeInput(getActionInput(ctx, action));
          if (!name) {
            await ctx.reply('Usage: .channel create <name> | [description]');
            return;
          }

          const metadata = await ctx.platformAdapter.client.newsletterCreate(name, description || undefined);
          await ctx.reply(formatMetadata(metadata, metadata.id));
          return;
        }

        const target = await requireNewsletterTarget(ctx);
        if (!target) return;

        const jid = target.jid;

        if (action === 'info') {
          const metadata = target.metadata || await ctx.platformAdapter.client.newsletterMetadata('jid', jid);
          if (!metadata) {
            await ctx.reply('Channel metadata not found.');
            return;
          }

          await ctx.reply(formatMetadata(metadata, jid));
          return;
        }

        if (action === 'follow') {
          await ctx.platformAdapter.client.newsletterFollow(jid);
          await ctx.reply(`Followed ${jid}.`);
          return;
        }

        if (action === 'unfollow') {
          await ctx.platformAdapter.client.newsletterUnfollow(jid);
          await ctx.reply(`Unfollowed ${jid}.`);
          return;
        }

        if (action === 'mute') {
          await ctx.platformAdapter.client.newsletterMute(jid);
          await ctx.reply(`Muted ${jid}.`);
          return;
        }

        if (action === 'unmute') {
          await ctx.platformAdapter.client.newsletterUnmute(jid);
          await ctx.reply(`Unmuted ${jid}.`);
          return;
        }

        if (action === 'posts' || action === 'fetch') {
          const count = Math.max(1, Math.min(parseInt(ctx.args[2] || ctx.args[1], 10) || 5, 10));
          const result = await ctx.platformAdapter.client.newsletterFetchMessages(jid, count, 0, 0);
          const messages = parseNewsletterMessages(result);
          await ctx.reply(formatFetchedMessages(messages));
          return;
        }

        if (action === 'rename' || action === 'name') {
          const [, name] = splitPipeInput(getActionInput(ctx, action));
          if (!name) {
            await ctx.reply('Usage: .channel rename <jid|invite|link> | <name>');
            return;
          }

          await ctx.platformAdapter.client.newsletterUpdateName(jid, name);
          await ctx.reply(`Updated channel name for ${jid}.`);
          return;
        }

        if (action === 'desc' || action === 'description') {
          const [, description] = splitPipeInput(getActionInput(ctx, action));
          if (!description) {
            await ctx.reply('Usage: .channel desc <jid|invite|link> | <description>');
            return;
          }

          await ctx.platformAdapter.client.newsletterUpdateDescription(jid, description);
          await ctx.reply(`Updated channel description for ${jid}.`);
          return;
        }

        if (action === 'admins') {
          const count = await ctx.platformAdapter.client.newsletterAdminCount(jid);
          await ctx.reply(`Admin count for ${jid}: ${count}`);
          return;
        }

        if (action === 'subscribe') {
          const result = await ctx.platformAdapter.client.subscribeNewsletterUpdates(jid);
          await ctx.reply(result?.duration ? `Subscribed to live updates for ${jid} (${result.duration}).` : `Subscribed to live updates for ${jid}.`);
          return;
        }

        if (action === 'owner') {
          const newOwnerJid = normalizeWhatsAppJid(ctx.args[2]);
          if (!newOwnerJid) {
            await ctx.reply('Usage: .channel owner <jid|invite|link> <newOwnerJid>');
            return;
          }

          await ctx.platformAdapter.client.newsletterChangeOwner(jid, newOwnerJid);
          await ctx.reply(`Transferred ownership of ${jid} to ${newOwnerJid}.`);
          return;
        }

        if (action === 'demote') {
          const userJid = normalizeWhatsAppJid(ctx.args[2]);
          if (!userJid) {
            await ctx.reply('Usage: .channel demote <jid|invite|link> <userJid>');
            return;
          }

          await ctx.platformAdapter.client.newsletterDemote(jid, userJid);
          await ctx.reply(`Demoted ${userJid} in ${jid}.`);
          return;
        }

        if (action === 'delete') {
          await ctx.platformAdapter.client.newsletterDelete(jid);
          await ctx.reply(`Deleted ${jid}.`);
          return;
        }

        await ctx.reply('Unknown channel action.');
      }
    }
  ]
};

