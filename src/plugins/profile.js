import { findContactByJid, resolveWhatsAppTarget } from '../utils/whatsappJid.js';
import { buildMentionEntry } from '../utils/mentions.js';
import { resolveCanonicalJid } from '../state/knownEntities.js';
import { fetchProfilePictureBuffer } from '../domains/whatsapp/profileMedia.js';

function getCanonicalTargetJid(jid) {
  return resolveCanonicalJid(jid) || jid;
}

async function fetchStatus(client, jid) {
  try {
    if (typeof client.fetchStatus !== 'function') return null;
    return await client.fetchStatus(jid);
  } catch {
    return null;
  }
}

export default {
  name: 'profile',
  description: 'Fetch a WhatsApp user profile if available',
  version: '1.0.0',
  author: 'Are Martins',
  commands: [
    {
      name: 'profile',
      aliases: ['whois', 'userinfo'],
      description: 'Show WhatsApp profile details for a user',
      usage: '.profile <number|@mention|reply>',
      category: 'utility',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 5,
      async execute(ctx) {
        const resolvedTarget = await resolveWhatsAppTarget(ctx);
        if (!resolvedTarget?.targetJid) {
          await ctx.reply('Usage: .profile <number|@mention|reply>');
          return;
        }
        const rawTargetJid = resolvedTarget.rawTargetJid;
        const targetJid = getCanonicalTargetJid(resolvedTarget.targetJid);
        const displayNumber = resolvedTarget.phoneNumber || String(targetJid).split('@')[0];

        const mention = buildMentionEntry(targetJid);
        const number = mention?.handle || `@${displayNumber}`;

        let waInfo = null;
        try {
          waInfo = await ctx.platformAdapter.client.onWhatsApp(targetJid);
        } catch {}
        const waEntry = Array.isArray(waInfo) ? waInfo[0] : waInfo;
        const exists = waEntry?.exists !== false;

        const runtimeContacts = ctx.platformAdapter.getContacts?.() || {};
        const contactInfo = findContactByJid(runtimeContacts, targetJid, rawTargetJid) || null;
        const pushName = contactInfo?.notify || 'Not available to this session';
        const savedName = contactInfo?.name || null;
        const verifiedName = contactInfo?.verifiedName || waEntry?.verifiedName || null;
        const status = await fetchStatus(ctx.platformAdapter.client, targetJid);
        const profilePicture = await fetchProfilePictureBuffer(ctx.platformAdapter.client, targetJid);

        const lines = [
          '*WhatsApp Profile*',
          `User: ${number}`,
          `Number: ${displayNumber}`,
          `Exists on WhatsApp: ${exists ? 'yes' : 'no'}`,
          `Push name: ${pushName}`
        ];

        if (savedName && savedName !== pushName) {
          lines.push(`Saved name: ${savedName}`);
        }

        if (verifiedName && verifiedName !== pushName && verifiedName !== savedName) {
          lines.push(`Verified name: ${verifiedName}`);
        }

        if (status?.status) {
          lines.push(`Bio: ${status.status}`);
        } else {
          lines.push('Bio: not available');
        }

        if (status?.setAt) {
          const date = new Date(status.setAt);
          if (!Number.isNaN(date.getTime())) {
            lines.push(`Bio updated: ${date.toLocaleString('en-US')}`);
          }
        }

        if (profilePicture) {
          await ctx.sendMedia(profilePicture, {
            type: 'image',
            mimetype: 'image/jpeg',
            caption: lines.join('\n'),
            ...(mention ? { mentions: [mention.jid] } : {})
          });
          return;
        }

        await ctx.reply(lines.join('\n'), mention ? { mentions: [mention.jid] } : {});
      }
    }
  ]
};
