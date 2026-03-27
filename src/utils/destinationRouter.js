import { getOwnerJid } from './messageUtils.js';

export const DEFAULT_DESTINATION_CONFIG = { dest: 'owner', jid: null };

export function normalizeDirectJid(value) {
  if (!value) return null;
  const trimmed = String(value).trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.endsWith('@g.us') || trimmed.endsWith('@status') || trimmed.endsWith('@broadcast')) {
    return null;
  }
  if (trimmed.includes('@')) {
    return trimmed;
  }
  const digits = trimmed.replace(/\D/g, '');
  return digits ? `${digits}@s.whatsapp.net` : null;
}

export function normalizeJidList(values = []) {
  return [...new Set(values.map(normalizeDirectJid).filter(Boolean))];
}

export function normalizeDestinationConfig(config = {}, defaults = DEFAULT_DESTINATION_CONFIG) {
  const merged = { ...defaults, ...config };
  const dest = merged.dest === 'group' ? 'group' : merged.dest === 'custom' ? 'custom' : 'owner';
  return {
    ...merged,
    dest,
    jid: dest === 'custom' ? normalizeDirectJid(merged.jid) : null
  };
}

export function applyDestinationCommand(arg, setConfig, messages = {}) {
  if (arg === 'g') {
    setConfig({ dest: 'group', jid: null });
    return messages.group || 'Destination set to the same chat.';
  }
  if (arg === 'p') {
    setConfig({ dest: 'owner', jid: null });
    return messages.owner || 'Destination set to the owner.';
  }
  if (/^[0-9a-zA-Z@._-]+$/.test(arg)) {
    setConfig({ dest: 'custom', jid: arg });
    return (messages.custom || 'Destination set to JID: %s').replace('%s', arg);
  }
  return null;
}

export function resolveDestinationJid(ctx, config, fallbackJid = null) {
  const normalized = normalizeDestinationConfig(config);
  if (normalized.dest === 'group') return ctx.chatId;
  if (normalized.dest === 'custom' && normalized.jid) return normalized.jid;
  const ownerJid = getOwnerJid(ctx);
  return ownerJid || fallbackJid || ctx.chatId;
}
