import pendingActions from './pendingActions.js';

export function createReplySession(chatId, sentMessage, config) {
  pendingActions.set(chatId, sentMessage.key.id, config);
  return sentMessage.key.id;
}

export function cloneReplySession(chatId, previousMessageId, nextMessage) {
  const existing = pendingActions.get(chatId, previousMessageId);
  if (!existing) return false;
  pendingActions.set(chatId, nextMessage.key.id, { ...existing });
  return true;
}
