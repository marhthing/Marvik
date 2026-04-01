export function normalizeMentionJid(jid) {
  if (!jid || typeof jid !== 'string') return null;
  return jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
}

export function formatMentionHandle(jid) {
  const normalized = normalizeMentionJid(jid);
  if (!normalized) return '@unknown';
  return `@${normalized.split('@')[0]}`;
}

export function buildMentionEntry(jid) {
  const normalized = normalizeMentionJid(jid);
  if (!normalized) return null;
  return {
    jid: normalized,
    handle: formatMentionHandle(normalized)
  };
}
