import { findParticipant, resolveParticipantFromContext } from '../../utils/whatsappJid.js';

export function isGroupAdminParticipant(participant) {
  return Boolean(participant?.admin);
}

export function getBotIdentity(adapter) {
  return {
    id: adapter?.client?.user?.id || adapter?.client?.user?.jid || null,
    lid: adapter?.client?.user?.lid || null
  };
}

export function getBotParticipant(groupMetadata, adapter) {
  const participants = groupMetadata?.participants || [];
  const botIdentity = getBotIdentity(adapter);
  return findParticipant(participants, botIdentity.id, botIdentity.lid);
}

export async function getGroupActionContext(ctx, { resolveTarget = false } = {}) {
  const metadata = await ctx.platformAdapter.client.groupMetadata(ctx.chatId);
  const botParticipant = getBotParticipant(metadata, ctx.platformAdapter);
  const targetParticipant = resolveTarget
    ? await resolveParticipantFromContext(ctx, metadata)
    : null;

  return {
    metadata,
    botParticipant,
    targetParticipant
  };
}
