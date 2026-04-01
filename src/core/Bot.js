import EventEmitter from 'events';
import logger from '../utils/logger.js';
import CommandRegistry from './CommandRegistry.js';
import PluginLoader from './PluginLoader.js';
import PermissionManager from './PermissionManager.js';
import RateLimiter from '../utils/rateLimiter.js';
import MediaHandler from '../utils/mediaHandler.js';
import WhatsAppAdapter from '../adapters/WhatsAppAdapter.js';
import fs from 'fs';
import path from 'path';
import pendingActions from '../utils/pendingActions.js';
import memoryStore from '../state/memory.js';
import { getOwnerJidFromConfig } from '../utils/whatsappJid.js';
import { getKnownContacts } from '../state/knownEntities.js';
import { getStickerCommands } from '../state/stickerCommands.js';
import {
  clearPendingLifecycleAction,
  getPendingLifecycleAction,
  markStartup,
  recordLifecycleEvent
} from '../state/lifecycle.js';

const STARTUP_OWNER_IMAGE_PATH = path.resolve(process.cwd(), 'assets', 'marvik-logo.png');

export default class Bot extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.logger = logger.child({ component: 'Bot' });
    
    this.commandRegistry = new CommandRegistry(config);
    this.pluginLoader = new PluginLoader(this.commandRegistry, config);
    this.pluginLoader.setBot(this);
    this.permissionManager = new PermissionManager(config);
    this.rateLimiter = new RateLimiter(config);
    this.mediaHandler = new MediaHandler(config);
    
    this.adapters = new Map();
    
    this.createDirectories();
  }

  createDirectories() {
    const dirs = [
      this.config.paths.session,
      this.config.paths.storage,
      this.config.paths.tmp,
      this.config.paths.plugins
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        this.logger.info(`Created directory: ${dir}`);
      }
    }

    // Ensure storage.json exists
    const storageFile = path.join(this.config.paths.storage, 'storage.json');
    if (!fs.existsSync(storageFile)) {
      fs.writeFileSync(storageFile, '{}', 'utf-8');
      this.logger.info(`Created file: ${storageFile}`);
    }
  }

  async start() {
    this.logger.info(`Starting ${this.config.botName}...`);

    if (this.config.platforms.whatsapp) {
      await this.initializeWhatsApp();
      await new Promise((resolve) => {
        const onReady = (platform) => {
          if (platform === 'whatsapp') {
            this.off('platform:ready', onReady);
            resolve();
          }
        };
        this.on('platform:ready', onReady);
      });
    }

    await this.pluginLoader.loadAll();

    if (this.adapters.size === 0) {
      this.logger.error('No platforms enabled! Enable at least one platform in .env');
      process.exit(1);
    }

    await this.notifyOwnerStartup();
    await this.notifyLifecycleCompletion();
    markStartup();
    this.logger.info(`${this.config.botName} started successfully on ${this.adapters.size} platform(s)`);
  }

  async initializeWhatsApp() {
    try {
      this.logger.info('Initializing WhatsApp...');
      const adapter = new WhatsAppAdapter(this.config);
      adapter.commandRegistry = this.commandRegistry;
      
      adapter.on('message', (messageContext) => {
        // Prevent duplicate execution of the same message ID if it's not an edit
        // or handle it within handleMessage logic
        this.handleMessage(messageContext);
      });

      adapter.on('ready', () => {
        this.logger.info('WhatsApp is ready');
        this.emit('platform:ready', 'whatsapp');
      });

      await adapter.connect();
      this.adapters.set('whatsapp', adapter);
    } catch (error) {
      this.logger.error({ 
        message: error?.message, 
        stack: error?.stack,
        name: error?.name,
        code: error?.code
      }, 'Failed to initialize WhatsApp');
      throw error;
    }
  }

  async restart() {
    this.logger.info('Restarting bot...');
    recordLifecycleEvent('restart_exit');
    await this.stop();
    process.exit(0);
  }

  getOwnerJid() {
    return getOwnerJidFromConfig(this.config);
  }

  async getOwnerDisplayName(ownerJid) {
    const fallback = this.config.ownerNumber || ownerJid?.split('@')[0] || 'owner';
    try {
      const latestOwnerMessage = memoryStore.getLatestMessage('whatsapp', ownerJid);
      if (latestOwnerMessage?.pushName) {
        return latestOwnerMessage.pushName;
      }
    } catch {}
    try {
      const contacts = getKnownContacts();
      if (contacts?.[ownerJid]) {
        const entry = contacts[ownerJid];
        return entry.name || entry.notify || entry.verifiedName || entry.short || fallback;
      }
      const ownerDigits = String(ownerJid || fallback).replace(/[^\d]/g, '');
      for (const [jid, entry] of Object.entries(contacts || {})) {
        const digits = String(jid || '').replace(/[^\d]/g, '');
        if (digits && ownerDigits && digits === ownerDigits) {
          return entry.name || entry.notify || entry.verifiedName || entry.short || fallback;
        }
      }
    } catch {}
    return fallback;
  }

  async notifyOwnerStartup() {
    const whatsapp = this.getAdapter('whatsapp');
    const ownerJid = this.getOwnerJid();
    if (!whatsapp || !ownerJid) return;

    const pendingAction = getPendingLifecycleAction();
    const isRestart = pendingAction?.type === 'restart';

    const ownerLabel = await this.getOwnerDisplayName(ownerJid);
    const message = isRestart
      ? `Hi ${ownerLabel}, i have restarted`
      : `Hi ${ownerLabel}, i have started`;
    const guideCaption = [
      `Marvik is ${isRestart ? 'back online after a restart' : 'now online'}.`,
      '',
      'Quick guide:',
      '- Use `.menu` to view commands',
      '- Use `.help <command>` for command usage',
      '- Use `.stats` to inspect activity',
      '- Use `.restart` or `.shutdown` for lifecycle control',
      '- Check `.env` when you want to adjust config'
    ].join('\n');

    try {
      if (!isRestart && fs.existsSync(STARTUP_OWNER_IMAGE_PATH)) {
        try {
          const imageBuffer = fs.readFileSync(STARTUP_OWNER_IMAGE_PATH);
          await whatsapp.sendMedia(ownerJid, imageBuffer, 'image', { caption: guideCaption });
        } catch (error) {
          this.logger.warn({ error }, 'Failed to send startup guide image to owner');
        }
      }

      await whatsapp.sendMessage(ownerJid, message);
    } catch (error) {
      this.logger.warn({ error }, 'Failed to send startup message to owner');
    }
  }

  async notifyLifecycleCompletion() {
    const whatsapp = this.getAdapter('whatsapp');
    const pendingAction = getPendingLifecycleAction();
    if (!whatsapp || !pendingAction) return;

    try {
      if (pendingAction.type === 'restart' && pendingAction.chatId) {
        const senderLabel = pendingAction.senderName || pendingAction.senderId?.split('@')[0] || 'owner';
        let reacted = false;
        if (pendingAction.messageKey) {
          try {
            await whatsapp.sendReaction(pendingAction.chatId, pendingAction.messageKey, '✅');
            reacted = true;
          } catch (error) {
            this.logger.warn({ error }, 'Failed to send restart completion reaction');
          }
        }

        if (!reacted) {
          await whatsapp.sendMessage(
            pendingAction.chatId,
            `Restart complete. ${this.config.botName} is back online, ${senderLabel}.`
          );
        }

        recordLifecycleEvent('restart_completed', {
          chatId: pendingAction.chatId,
          senderId: pendingAction.senderId || null,
          reacted
        });
      }
    } catch (error) {
      this.logger.warn({ error }, 'Failed to send lifecycle completion message');
      return;
    }

    clearPendingLifecycleAction();
  }

  async handleMessage(messageContext) {
    messageContext.bot = this;

    this.logger.debug({
      platform: messageContext.platform,
      command: messageContext.command,
      sender: messageContext.senderName,
      isCommand: !!messageContext.command,
      text: messageContext.text,
      chatId: messageContext.chatId,
      senderId: messageContext.senderId,
      isOwner: messageContext.isOwner
    }, '[handleMessage] Received message');

    let handled = false;
    try {
      handled = await pendingActions.handle(messageContext);
    } catch (err) {
      this.logger.error({ err, ctx: messageContext }, '[handleMessage] Error in pendingActions.handle');
    }
    if (handled) return;

    if (this.permissionManager.isBanned(messageContext.senderId, messageContext.platform)) {
      this.logger.warn(`Blocked message from banned user: ${messageContext.senderId}`);
      return;
    }

    if (this.permissionManager.isChatBlacklisted(messageContext.chatId, messageContext.platform)) {
      this.logger.warn(`Blocked message from blacklisted chat: ${messageContext.chatId}`);
      return;
    }

    this.emit('message', messageContext);

    // Check for sticker commands
    if (messageContext.platform === 'whatsapp' && messageContext.raw?.message?.stickerMessage) {
      try {
        const stickerMessage = messageContext.raw.message.stickerMessage;
        const fileSha256 = stickerMessage.fileSha256;
        if (fileSha256) {
          const stickerId = Buffer.from(fileSha256).toString('base64');
          const stickerCommands = getStickerCommands();
          const boundCmd = stickerCommands[stickerId];
          
            if (boundCmd) {
              this.logger.info(`Sticker command detected: ${boundCmd}`);
              messageContext.command = boundCmd.split(/\s+/)[0];
              messageContext.args = boundCmd.split(/\s+/).slice(1);
              
              // If the sticker itself is a reply, we want the command to act on the QUOTED message.
              // We need to move the current sticker's quoted context into the messageContext.quoted
              const contextInfo = messageContext.raw.message?.stickerMessage?.contextInfo;
              if (contextInfo?.quotedMessage) {
                // The sticker is replying to someone/something.
                // Reconstruct the quoted context so the command sees the QUOTED message as the target.
                let quotedSenderId = contextInfo.participant || contextInfo.remoteJid;
                if (quotedSenderId?.endsWith('@lid')) {
                  try {
                    const pn = await this.adapters.get('whatsapp').client.signalRepository.lidMapping.getPNForLID(quotedSenderId);
                    if (pn) quotedSenderId = pn;
                  } catch (e) {}
                }
                if (quotedSenderId) quotedSenderId = quotedSenderId.replace(/:.*$/, '');
                
                let quotedType = 'text';
                let quotedText = '';
                const quotedMsg = contextInfo.quotedMessage;
                
                if (quotedMsg.imageMessage) {
                  quotedType = 'image';
                  quotedText = quotedMsg.imageMessage.caption || '';
                } else if (quotedMsg.videoMessage) {
                  quotedType = 'video';
                  quotedText = quotedMsg.videoMessage.caption || '';
                } else if (quotedMsg.audioMessage) {
                  quotedType = 'audio';
                } else if (quotedMsg.stickerMessage) {
                  quotedType = 'sticker';
                } else if (quotedMsg.documentMessage) {
                  quotedType = 'document';
                } else if (quotedMsg.conversation) {
                  quotedText = quotedMsg.conversation;
                } else if (quotedMsg.extendedTextMessage) {
                  quotedText = quotedMsg.extendedTextMessage.text || '';
                }
                
                messageContext.quoted = {
                  messageId: contextInfo.stanzaId,
                  senderId: quotedSenderId,
                  type: quotedType,
                  text: quotedText,
                  message: quotedMsg,
                  raw: {
                    key: {
                      remoteJid: messageContext.chatId,
                      id: contextInfo.stanzaId,
                      participant: contextInfo.participant
                    },
                    message: quotedMsg
                  }
                };
                
                // IMPORTANT: We must also update the raw message's context for plugins that check raw directly
                // We simulate an extendedTextMessage with contextInfo pointing to the quoted message
                messageContext.raw.message = {
                  extendedTextMessage: {
                    text: `.${boundCmd}`,
                    contextInfo: contextInfo
                  }
                };
              } else {
                // If NOT a reply, the command should just run as a normal command.
                // We don't want the sticker itself to be the "target" (quoted) of the command.
                messageContext.quoted = null;
                
                // IMPORTANT: We must also remove the stickerMessage from raw.message
                // so that plugins like 'save' that check raw.message don't find the sticker.
                if (messageContext.raw.message?.stickerMessage) {
                  delete messageContext.raw.message.stickerMessage;
                }
                
                this.logger.info(`Running sticker command "${messageContext.command}" without target (no reply).`);
              }
            }
        }
      } catch (err) {
        this.logger.error({ err }, '[handleMessage] Error checking sticker command');
      }
    }

    for (const handler of this.commandRegistry.getMessageHandlers()) {
      try {
        await handler(messageContext);
      } catch (err) {
        this.logger.error({ err }, '[handleMessage] Error in message handler');
      }
    }

    if (messageContext.command) {
      try {
        // Check for owner override on adminOnly commands
        const registry = this.commandRegistry;
        const cmd = registry.get(messageContext.command);
        if (cmd && cmd.adminOnly && messageContext.isOwner && messageContext.isGroup) {
          messageContext.isAdmin = true;
        }

        const rateLimitResult = this.rateLimiter.check(messageContext.senderId, messageContext.platform);
        
        if (!rateLimitResult.allowed) {
          if (rateLimitResult.reason === 'temporarily_blocked') {
            await messageContext.reply(`You are temporarily blocked from using commands. Try again in ${rateLimitResult.resetIn} seconds.`);
          } else {
            await messageContext.reply(`Slow down! You can use ${rateLimitResult.remaining} more command(s). Reset in ${rateLimitResult.resetIn} seconds.`);
          }
          return;
        }

        await this.commandRegistry.execute(messageContext);
      } catch (err) {
        this.logger.error({ err, command: messageContext.command }, '[handleMessage] Error executing command');
      }
    }
  }

  async stop() {
    if (this._stopping) return;
    this._stopping = true;
    this.logger.info('Stopping bot...');
    
    for (const [platform, adapter] of this.adapters) {
      this.logger.info(`Disconnecting ${platform}...`);
      try {
        await adapter.disconnect();
      } catch (e) {
        this.logger.error({ error: e }, `Error disconnecting ${platform}`);
      }
    }
    try {
      await memoryStore.flushWrites();
    } catch (error) {
      this.logger.warn({ error }, 'Failed to flush memory store writes before shutdown');
    }
    this.logger.info('Bot stopped');
  }

  getAdapter(platform) {
    return this.adapters.get(platform);
  }

  getCommandRegistry() {
    return this.commandRegistry;
  }

  getPluginLoader() {
    return this.pluginLoader;
  }

  getPermissionManager() {
    return this.permissionManager;
  }

  getRateLimiter() {
    return this.rateLimiter;
  }

  getMediaHandler() {
    return this.mediaHandler;
  }
}
