/**
 * Unified message context that all plugins receive
 * Platform-agnostic interface for interacting with messages
 */
import logger from '../utils/logger.js';

export default class MessageContext {
  constructor(data, adapter) {
    // Core identification
    this.platform = data.platform;
    this.messageId = data.messageId;
    this.messageKey = data.messageKey; // Store full message key
    this.chatId = data.chatId;
    this.senderId = data.senderId;
    this.senderName = data.senderName;
    
    // Message content
    this.text = data.text || '';
    this.command = data.command || null;
    this.args = data.args || [];
    
    // Context flags
    this.isGroup = data.isGroup || false;
    this.isOwner = data.isOwner || false;
    this.isAdmin = data.isAdmin || false;
    this.isFromMe = data.isFromMe || false; // Is message from bot itself
    
    // Media
    this.media = data.media || null;
    
    // Quoted/replied message
    this.quoted = data.quoted || null;
    
    // Store adapter reference for method calls
    this._adapter = adapter;
    this.platformAdapter = adapter; // Ensure plugins can access platformAdapter
    // Pass through any extra fields (like raw)
    Object.assign(this, data);

    // Logging function for debug (always available)
    this.log = (...args) => {
      if (adapter && adapter.logger) {
        adapter.logger.debug(...args);
      } else {
        logger.debug({ args }, 'Message context debug');
      }
    };
  }

  /**
   * Reply to the message
   */
  async reply(text, options = {}) {
    return await this._adapter.sendMessage(this.chatId, text, {
      quoted: this.raw || this.messageKey || this.messageId,
      ...options
    });
  }

  /**
   * Send a message without quoting
   */
  async send(text, options = {}) {
    return await this._adapter.sendMessage(this.chatId, text, options);
  }

  /**
   * React to the message
   */
  async react(emoji) {
    // Pass the full message key instead of just the ID
    return await this._adapter.sendReaction(this.chatId, this.messageKey || this.messageId, emoji);
  }

  /**
   * Delete the message
   */
  async delete() {
    return await this._adapter.deleteMessage(this.chatId, this.messageId);
  }

  /**
   * Edit a message (if supported by platform)
   */
  async edit(newText, options = {}) {
    if (typeof this._adapter.editMessage === 'function') {
      return await this._adapter.editMessage(this.chatId, this.messageId, newText, options);
    } else {
      throw new Error('Edit not supported for this platform');
    }
  }

  /**
   * Send media (image, video, audio, document)
   */
  async sendMedia(media, options = {}) {
    const mediaType = options.type || options.mediaType || options.kind;
    return await this._adapter.sendMedia(this.chatId, media, mediaType, options);
  }

  /**
   * Download media from the message
   */
  async downloadMedia() {
    if (!this.media) return null;
    return await this._adapter.downloadMedia(this.media);
  }

  /**
   * Check if user is group admin
   */
  async isGroupAdmin(userId = this.senderId) {
    if (!this.isGroup) return false;
    return await this._adapter.isGroupAdmin(this.chatId, userId);
  }

  /**
   * Send presence update (e.g., 'composing', 'recording', 'available', 'unavailable')
   */
  async presence(type = 'composing') {
    if (typeof this._adapter.sendPresence === 'function') {
      return await this._adapter.sendPresence(this.chatId, type);
    } else {
      throw new Error('Presence updates not supported for this platform');
    }
  }

  /**
   * Mark this message as read
   */
  async read() {
    if (typeof this._adapter.markRead === 'function') {
      await this._adapter.markRead(this.chatId, this.messageId, this.messageKey);
    }
  }
}
