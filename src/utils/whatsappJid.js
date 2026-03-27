import { jidNormalizedUser } from '@whiskeysockets/baileys';

export function normalizeDigits(value = '') {
  return String(value).replace(/[^\d]/g, '');
}

export function normalizeWhatsAppJid(value = '') {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (trimmed.includes('@')) return jidNormalizedUser(trimmed);
  const digits = normalizeDigits(trimmed);
  return digits ? `${digits}@s.whatsapp.net` : null;
}

export function getOwnerJidFromConfig(config = {}) {
  const ownerNumber = config.ownerNumber || process.env.OWNER_NUMBER || '';
  return normalizeWhatsAppJid(ownerNumber);
}

export function splitJidList(input = '') {
  return String(input)
    .split(',')
    .map((entry) => normalizeWhatsAppJid(entry))
    .filter(Boolean);
}

export function getParticipantPhone(participant = {}) {
  return normalizeDigits(participant.phoneNumber || participant.id || participant.lid || '');
}

export function findParticipant(participants = [], userId, userLid = null) {
  const normalizedUserId = userId ? jidNormalizedUser(userId) : null;
  const normalizedUserLid = userLid ? jidNormalizedUser(userLid) : null;
  const userPhone = normalizeDigits(userId || userLid || '');

  return participants.find((participant) => {
    const participantId = participant.id ? jidNormalizedUser(participant.id) : null;
    const participantLid = participant.lid ? jidNormalizedUser(participant.lid) : null;
    const participantPhone = getParticipantPhone(participant);

    return participantId === normalizedUserId ||
      participantLid === normalizedUserId ||
      (normalizedUserLid && participantId === normalizedUserLid) ||
      (normalizedUserLid && participantLid === normalizedUserLid) ||
      (participantPhone && userPhone && participantPhone === userPhone);
  }) || null;
}

export function findParticipantByPhone(participants = [], phoneNumber = '') {
  const targetPhone = normalizeDigits(phoneNumber);
  if (!targetPhone) return null;

  return participants.find((participant) => getParticipantPhone(participant) === targetPhone) || null;
}

export async function resolveParticipantFromContext(ctx, groupMetadata) {
  const participants = groupMetadata?.participants || [];

  if (ctx.quoted?.senderId) {
    return findParticipant(participants, ctx.quoted.senderId, null);
  }

  if (Array.isArray(ctx.mentions) && ctx.mentions.length > 0) {
    return findParticipant(participants, ctx.mentions[0], null);
  }

  if (ctx.args?.[0]) {
    return findParticipantByPhone(participants, ctx.args[0]);
  }

  return null;
}
