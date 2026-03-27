// pendingActions.js
// Centralized in-memory pending actions store for interactive flows (e.g., Facebook quality, games, etc.)
// Supports multiple types, chats, users, and custom match/handler logic.

import fs from 'fs';
import path from 'path';

class PendingActions {
  constructor() {
    // Structure: { chatId: { [pendingId]: { type, userId, data, created, match, handler, timeout } } }
    this.actions = {};
  }

  has(pendingId) {
    for (const chatId in this.actions) {
      if (this.actions[chatId][pendingId]) return true;
    }
    return false;
  }

  add(pendingId, handler, timeout = 10 * 60 * 1000) {
    // We'll use a special 'global' or 'system' chatId for non-reply based actions
    const chatId = 'system_global'; 
    this.set(chatId, pendingId, { handler, timeout });
  }

  remove(pendingId) {
    const chatId = 'system_global';
    this.delete(chatId, pendingId);
  }

  set(chatId, pendingId, { type, userId, data, match, handler, timeout = 10 * 60 * 1000 }) {
    if (!this.actions[chatId]) this.actions[chatId] = {};
    // Clear any previous timeout for this pendingId
    if (this.actions[chatId][pendingId]?.__timeout) clearTimeout(this.actions[chatId][pendingId].__timeout);
    // Set up auto-expiry
    const __timeout = setTimeout(() => {
      delete this.actions[chatId][pendingId];
    }, timeout);
    this.actions[chatId][pendingId] = { type, userId, data, match, handler, created: Date.now(), __timeout };
  }

  get(chatId, pendingId) {
    return this.actions[chatId]?.[pendingId] || null;
  }

  delete(chatId, pendingId) {
    if (this.actions[chatId]?.[pendingId]) {
      clearTimeout(this.actions[chatId][pendingId].__timeout);
      delete this.actions[chatId][pendingId];
    }
  }

  // Helper to normalize user IDs for comparison
  normalizeUserId(userId) {
    if (!userId) return '';
    return userId.split('@')[0].split(':')[0];
  }

  // Call this from your global message handler
  async handle(ctx) {
    // Get message text (MessageContext uses 'text' not 'body')
    const messageText = ctx.text || '';
    const normalizedText = messageText.toLowerCase().trim();
    const isJoinMessage = normalizedText === 'join';
    
    // Support both extendedTextMessage.contextInfo.stanzaId and messageContextInfo.stanzaId
    let replyTo = ctx.raw?.message?.extendedTextMessage?.contextInfo?.stanzaId;
    if (!replyTo) replyTo = ctx.raw?.messageContextInfo?.stanzaId;
    // WhatsApp Baileys: fallback to quoted message id if present
    if (!replyTo && ctx.raw?.messageContextInfo?.quotedMessage) {
      replyTo = ctx.raw?.messageContextInfo?.stanzaId;
      if (!replyTo && ctx.raw?.messageContextInfo?.quotedMessage?.key?.id) {
        replyTo = ctx.raw.messageContextInfo.quotedMessage.key.id;
      }
    }
    // Also check ctx.quoted which is set by the WhatsApp adapter
    if (!replyTo && ctx.quoted?.messageId) {
      replyTo = ctx.quoted.messageId;
    }
    
    const chatId = ctx.chatId;
    // console.log('[pendingActions] handle() debug', { replyTo, chatId, hasPending: !!this.actions[chatId]?.[replyTo], messageText });
    
    // 1. Try quoted/reply-based matching first
    if (replyTo && this.actions[chatId]?.[replyTo]) {
      const pending = this.actions[chatId][replyTo];
      const isJoinPending = typeof pending?.type === 'string' && pending.type.endsWith('_join');
      // If user typed "join" while replying to a non-join pending action, don't consume it here.
      // Let fallback routing pick the actual game join action.
      if (isJoinMessage && !isJoinPending) {
      } else
      // Only allow the user who started the action
      if (pending.userId && ctx.senderId && !ctx.isFromMe) {
        const pendingUserBase = this.normalizeUserId(pending.userId);
        const senderBase = this.normalizeUserId(ctx.senderId);
        if (pendingUserBase !== senderBase) {
          // Don't consume this message; allow fallback matching for other pending actions in chat.
        } else {
          // Match logic (can be custom or default)
          if (pending.match && !pending.match(messageText, ctx, pending)) {
            // Don't consume this message; allow fallback matching.
          } else {
            const result = pending.handler ? await pending.handler(ctx, pending) : true;
            if (result === true) {
              this.delete(chatId, replyTo);
              return true;
            }
            return false;
          }
        }
      } else {
        // Match logic (can be custom or default)
        if (pending.match && !pending.match(messageText, ctx, pending)) {
          // Don't consume this message; allow fallback matching.
        } else {
          const result = pending.handler ? await pending.handler(ctx, pending) : true;
          if (result === true) {
            this.delete(chatId, replyTo);
            return true;
          }
          return false;
        }
      }
    }
    
    // 2. Fallback: match most recent pending action for this chat (user doesn't need to quote)
    const pendings = this.actions[chatId] ? Object.entries(this.actions[chatId]) : [];
    
    // Add global system actions to the pool for this chat
    if (this.actions['system_global']) {
      pendings.push(...Object.entries(this.actions['system_global']));
    }

    if (pendings.length > 0) {
      // For "join", prioritize game join actions to avoid unrelated pending flows swallowing it.
      if (isJoinMessage) {
        pendings.sort((a, b) => {
          const aJoin = typeof a[1]?.type === 'string' && a[1].type.endsWith('_join');
          const bJoin = typeof b[1]?.type === 'string' && b[1].type.endsWith('_join');
          if (aJoin && !bJoin) return -1;
          if (!aJoin && bJoin) return 1;
          return b[1].created - a[1].created;
        });
      } else {
      // Sort by created time descending (most recent first)
        pendings.sort((a, b) => b[1].created - a[1].created);
      }
      for (const [pendingId, pending] of pendings) {
        if (isJoinMessage && !(typeof pending?.type === 'string' && pending.type.endsWith('_join'))) {
          continue;
        }
        // Skip if different user
        if (pending.userId && ctx.senderId && !ctx.isFromMe) {
          const pendingUserBase = this.normalizeUserId(pending.userId);
          const senderBase = this.normalizeUserId(ctx.senderId);
          if (pendingUserBase !== senderBase) continue;
        }
        // Check if message matches
        if (pending.match && !pending.match(messageText, ctx, pending)) continue;
        if (pending.handler) {
          const result = await pending.handler(ctx, pending);
          if (result === true) {
            this.delete(this.actions[chatId]?.[pendingId] ? chatId : 'system_global', pendingId);
            return true;
          }
        }
      }
    }
    return false;
  }
}

  // Centralized shouldReact helper for all plugins
  export function shouldReact() {
    try {
      // Priority 1: envMemory (real-time loaded from .env)
      if (typeof process.env.BOT_REACTIONS !== 'undefined') {
        return process.env.BOT_REACTIONS === 'on';
      }
      
      // Priority 2: Direct file read
      const envPath = path.join(process.cwd(), '.env');
      if (fs.existsSync(envPath)) {
        const env = fs.readFileSync(envPath, 'utf8');
        const match = env.match(/^BOT_REACTIONS=(on|off)/m);
        if (match) return match[1] === 'on';
      }
      return true;
    } catch { return true; }
  }

const pendingActions = new PendingActions();
export default pendingActions;
