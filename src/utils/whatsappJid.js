import { jidNormalizedUser } from '@whiskeysockets/baileys';
import { resolveCanonicalJid } from '../state/knownEntities.js';

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

export function extractJidLike(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return null;
  return value.id || value.jid || value.lid || value.participant || null;
}

export function findContactByJid(contacts = {}, ...jids) {
  const candidates = Array.from(new Set(
    jids
      .map((jid) => normalizeWhatsAppJid(jid))
      .filter(Boolean)
  ));
  if (!candidates.length) return null;

  for (const candidate of candidates) {
    if (contacts[candidate]) {
      return contacts[candidate];
    }
  }

  const candidateDigits = candidates
    .map((jid) => normalizeDigits(jid))
    .filter(Boolean);

  for (const [key, entry] of Object.entries(contacts)) {
    const entryCandidates = [
      key,
      entry?.id,
      entry?.jid,
      entry?.lid
    ]
      .map((jid) => normalizeWhatsAppJid(jid))
      .filter(Boolean);

    if (entryCandidates.some((entryJid) => candidates.includes(entryJid))) {
      return entry;
    }

    const entryDigits = entryCandidates
      .map((jid) => normalizeDigits(jid))
      .filter(Boolean);

    if (entryDigits.some((digits) => candidateDigits.includes(digits))) {
      return entry;
    }
  }

  return null;
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
  const rawMentionedJids = ctx?.raw?.message?.extendedTextMessage?.contextInfo?.mentionedJid;

  if (ctx.quoted?.senderId) {
    return findParticipant(participants, ctx.quoted.senderId, null);
  }

  if (Array.isArray(ctx.mentions) && ctx.mentions.length > 0) {
    return findParticipant(participants, ctx.mentions[0], null);
  }

  if (Array.isArray(rawMentionedJids) && rawMentionedJids.length > 0) {
    return findParticipant(participants, rawMentionedJids[0], null);
  }

  if (ctx.args?.[0]) {
    return findParticipantByPhone(participants, ctx.args[0]);
  }

  return null;
}

export async function resolveWhatsAppTarget(ctx, input = null) {
  const rawMentionedJids = ctx?.raw?.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  const firstMention = Array.isArray(ctx?.mentions) && ctx.mentions.length > 0
    ? ctx.mentions[0]
    : (Array.isArray(rawMentionedJids) && rawMentionedJids.length > 0 ? rawMentionedJids[0] : null);

  const rawTargetJid = input ||
    firstMention ||
    ctx?.quoted?.senderId ||
    (ctx?.args?.[0] ? normalizeWhatsAppJid(ctx.args[0]) : null) ||
    (!ctx?.isGroup ? ctx?.chatId : null) ||
    ctx?.senderId ||
    null;

  if (!rawTargetJid) {
    return null;
  }

  let participant = null;
  if (ctx?.isGroup && ctx?.platformAdapter?.client?.groupMetadata) {
    try {
      const metadata = await ctx.platformAdapter.client.groupMetadata(ctx.chatId);
      participant = await resolveParticipantFromContext(ctx, metadata);
    } catch {}
  }

  const participantPhone = participant ? getParticipantPhone(participant) : '';
  const participantJid = participant?.id ? jidNormalizedUser(participant.id) : null;
  const normalizedTargetJid = jidNormalizedUser(rawTargetJid);
  const canonicalTargetJid = resolveCanonicalJid(participantJid || normalizedTargetJid) || participantJid || normalizedTargetJid;
  const canonicalDigits = normalizeDigits(canonicalTargetJid);
  const resolvedPhoneNumber = participantPhone || canonicalDigits || normalizeDigits(participantJid || normalizedTargetJid || rawTargetJid) || '';

  return {
    rawTargetJid,
    targetJid: canonicalTargetJid,
    participant,
    phoneNumber: resolvedPhoneNumber,
    mentionHandle: `@${resolvedPhoneNumber || 'unknown'}`
  };
}
