import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState,
  downloadMediaMessage,
  jidNormalizedUser,
  delay,
  fetchLatestBaileysVersion,
  Browsers
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import BaseAdapter from './BaseAdapter.js';
import MessageContext from '../core/MessageContext.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import memoryStore from '../state/memory.js';
import readline from 'readline';
import { upsertKnownChat, upsertKnownContact, mapLidToJid, dedupeKnownEntities } from '../state/knownEntities.js';
import { wrapClientSendMessage } from '../utils/i18n.js';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const adapterLogger = logger.child({ component: 'whatsapp-adapter' });

export default class WhatsAppAdapter extends BaseAdapter {
  constructor(config) {
    super('whatsapp', config);
    
    this.baileysLogger = {
      level: 'silent',
      child: () => this.baileysLogger,
      trace: () => {}, debug: () => {}, info: () => {},
      warn: () => {}, error: () => {}, fatal: () => {}
    };
    this.pendingViewOnce = new Map();
    this.pairingCodeRequested = false;
    this.pairingMethod = null;
    this.phoneNumber = null;
    this.isFirstPairingAttempt = true;
    this.authFailures = 0;
    this.contacts = new Map();
  }

  normalizeNumber(value) {
    return (value || '').replace(/[^\d]/g, '');
  }

  getContextInfo(message = {}) {
    return message?.extendedTextMessage?.contextInfo ||
           message?.imageMessage?.contextInfo ||
           message?.videoMessage?.contextInfo ||
           message?.stickerMessage?.contextInfo ||
           message?.audioMessage?.contextInfo ||
           message?.documentMessage?.contextInfo ||
           message?.buttonsResponseMessage?.contextInfo ||
           message?.listResponseMessage?.contextInfo ||
           null;
  }

  extractText(message = {}) {
    return message?.conversation ||
           message?.extendedTextMessage?.text ||
           message?.imageMessage?.caption ||
           message?.videoMessage?.caption ||
           message?.documentMessage?.caption ||
           message?.buttonsResponseMessage?.selectedDisplayText ||
           message?.listResponseMessage?.title ||
           message?.templateButtonReplyMessage?.selectedDisplayText ||
           message?.interactiveResponseMessage?.body?.text ||
           '';
  }

  extractMedia(message = {}, raw) {
    if (message?.imageMessage) return { type: 'image', mimetype: message.imageMessage.mimetype, raw };
    if (message?.videoMessage) {
      return {
        type: message.videoMessage.gifPlayback ? 'gif' : 'video',
        mimetype: message.videoMessage.mimetype,
        raw
      };
    }
    if (message?.audioMessage) return { type: message.audioMessage.ptt ? 'ptt' : 'audio', mimetype: message.audioMessage.mimetype, raw };
    if (message?.documentMessage) return { type: 'document', mimetype: message.documentMessage.mimetype, fileName: message.documentMessage.fileName, raw };
    if (message?.stickerMessage) return { type: 'sticker', mimetype: message.stickerMessage.mimetype, raw };
    return null;
  }

  getMentions(message = {}) {
    const contextInfo = this.getContextInfo(message);
    return Array.isArray(contextInfo?.mentionedJid) ? [...new Set(contextInfo.mentionedJid)] : [];
  }

  mergeEditedMessageWithOriginalContext(editedMessage = {}, originalMessage = {}) {
    const editedType = editedMessage ? Object.keys(editedMessage)[0] : null;
    const originalType = originalMessage ? Object.keys(originalMessage)[0] : null;
    const originalContextInfo = this.getContextInfo(originalMessage);
    const editedText = this.extractText(editedMessage);

    if (!editedType) {
      return editedMessage;
    }

    const editedPayload = editedMessage[editedType];
    const originalPayload = editedType && originalMessage ? originalMessage[editedType] : null;

    if (editedPayload && typeof editedPayload === 'object') {
      const mergedPayload = { ...originalPayload, ...editedPayload };
      if (originalContextInfo && !editedPayload?.contextInfo) {
        mergedPayload.contextInfo = originalContextInfo;
      }
      return { [editedType]: mergedPayload };
    }

    if (editedText && originalContextInfo) {
      return {
        extendedTextMessage: {
          text: editedText,
          contextInfo: originalContextInfo
        }
      };
    }

    if (editedType === 'extendedTextMessage' && originalType === 'conversation') {
      return {
        extendedTextMessage: {
          text: editedPayload?.text || '',
          ...(editedPayload || {})
        }
      };
    }

    return editedMessage;
  }

  buildQuotedMessage(contextInfo, chatId, quotedMsg, quotedSenderId) {
    if (!contextInfo?.quotedMessage) return null;

    let quotedType = 'text';
    let quotedText = this.extractText(quotedMsg);
    const quotedMedia = this.extractMedia(quotedMsg, {
      key: {
        remoteJid: chatId,
        id: contextInfo.stanzaId,
        participant: contextInfo.participant
      },
      message: quotedMsg
    });

    if (quotedMsg.imageMessage) quotedType = 'image';
    else if (quotedMsg.videoMessage) quotedType = quotedMsg.videoMessage.gifPlayback ? 'gif' : 'video';
    else if (quotedMsg.audioMessage) quotedType = quotedMsg.audioMessage.ptt ? 'ptt' : 'audio';
    else if (quotedMsg.stickerMessage) quotedType = 'sticker';
    else if (quotedMsg.documentMessage) quotedType = 'document';

    return {
      messageId: contextInfo.stanzaId,
      senderId: quotedSenderId,
      type: quotedType,
      text: quotedText,
      media: quotedMedia,
      mentions: Array.isArray(contextInfo.mentionedJid) ? contextInfo.mentionedJid : [],
      message: quotedMsg,
      raw: {
        key: {
          remoteJid: chatId,
          id: contextInfo.stanzaId,
          participant: contextInfo.participant
        },
        message: quotedMsg
      }
    };
  }

  getWhatsAppSessionPath() {
    const projectRoot = path.resolve(__dirname, '..', '..');
    return path.join(projectRoot, 'session', 'whatsapp');
  }

  async connect() {
    const sessionPath = this.getWhatsAppSessionPath();
    const credsPath = path.join(sessionPath, 'creds.json');
    const credsExist = fs.existsSync(credsPath);
    
    if (!fs.existsSync(sessionPath)) {
      fs.mkdirSync(sessionPath, { recursive: true });
    }

    if (credsExist) {
      this.logger.info('Found existing WhatsApp credentials. Logging in automatically...');
      await this.connectWithCredentials(sessionPath);
      return;
    }

    if (!this.pairingMethod) {
      this.pairingMethod = await this.promptPairingMethod();
    }
    
    if (this.pairingMethod === 'pairingCode' && !this.phoneNumber) {
      this.phoneNumber = await this.promptPhoneNumber();
    }

    if (this.isFirstPairingAttempt && this.pairingMethod === 'pairingCode') {
      const files = fs.existsSync(sessionPath) ? fs.readdirSync(sessionPath) : [];
      for (const file of files) {
        fs.unlinkSync(path.join(sessionPath, file));
      }
    }

    await this.connectWithAuth(sessionPath);
  }

  async connectWithCredentials(sessionPath) {
    sessionPath = this.getWhatsAppSessionPath();
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();
    const alwaysOnline = process.env.ALWAYS_ONLINE === 'true';
    this._alwaysOnline = alwaysOnline;
    this.client = makeWASocket({
      auth: state,
      version,
      browser: Browsers.macOS('Chrome'),
      logger: this.baileysLogger,
      generateHighQualityLinkPreview: true,
      markOnlineOnConnect: false, // Default to false
      getMessage: async (key) => {
        const msg = memoryStore.getMessage('whatsapp', key.remoteJid, key.id);
        if (msg?.message) return msg;
        return { message: null };
      }
    });
    wrapClientSendMessage(this.client);

    this.setupEventHandlers(saveCreds);
    this._setupMediaDownloader();
  }

  async connectWithAuth(sessionPath) {
    sessionPath = this.getWhatsAppSessionPath();
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();
    const alwaysOnline = process.env.ALWAYS_ONLINE === 'true';
    this._alwaysOnline = alwaysOnline;
    this.client = makeWASocket({
      auth: state,
      version,
      browser: Browsers.macOS('Chrome'),
      logger: this.baileysLogger,
      printQRInTerminal: false,
      generateHighQualityLinkPreview: true,
      markOnlineOnConnect: false, // Default to false
      getMessage: async (key) => {
        const msg = memoryStore.getMessage('whatsapp', key.remoteJid, key.id);
        if (msg?.message) return msg;
        return { message: null };
      }
    });
    wrapClientSendMessage(this.client);

    this.setupEventHandlers(saveCreds, sessionPath);
    this._setupMediaDownloader();
  }

  // Setup media downloader for memoryStore to use during cleanup
  _setupMediaDownloader() {
    memoryStore.setMediaDownloader(async (msg) => {
      try {
        const buffer = await downloadMediaMessage(
          msg,
          'buffer',
          {},
          { 
            logger: this.baileysLogger,
            reuploadRequest: this.client.updateMediaMessage 
          }
        );
        return buffer;
      } catch (err) {
        return null;
      }
    });
  }

  setupEventHandlers(saveCreds, sessionPath) {
    sessionPath = this.getWhatsAppSessionPath();
    this.client.ev.on('creds.update', saveCreds);

    this.client.ev.on('contacts.upsert', (contacts = []) => {
      for (const contact of contacts) {
        const jid = contact?.id || contact?.jid;
        if (!jid) continue;
        const prev = this.contacts.get(jid) || {};
        this.contacts.set(jid, { ...prev, ...contact });
        upsertKnownContact(jid, contact);
      }
    });

    this.client.ev.on('contacts.update', (contacts = []) => {
      for (const contact of contacts) {
        const jid = contact?.id || contact?.jid;
        if (!jid) continue;
        const prev = this.contacts.get(jid) || {};
        this.contacts.set(jid, { ...prev, ...contact });
        upsertKnownContact(jid, contact);
      }
    });

    this.client.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        if (this.pairingMethod === 'qr') {
          this.logger.info('Scan QR code to login to WhatsApp');
          qrcode.generate(qr, { small: true });
        } else if (this.pairingMethod === 'pairingCode' && 
                   !this.pairingCodeRequested && 
                   !this.client.authState.creds.registered &&
                   this.isFirstPairingAttempt) {
          this.pairingCodeRequested = true;
          try {
            await delay(2000);
            const code = await this.client.requestPairingCode(this.phoneNumber);
            adapterLogger.info({ code }, 'Pairing code generated');
          } catch (error) {
            this.logger.error({ error }, 'Failed to request pairing code');
          }
        }
      }

      if (connection === 'open') {
        this.isFirstPairingAttempt = false;
        const userId = this.client.user?.id;
        if (userId) {
          const phone = userId.split(':')[0].replace(/[^\d]/g, '');
          const envPath = path.resolve(process.cwd(), '.env');
          if (fs.existsSync(envPath)) {
            let envContent = fs.readFileSync(envPath, 'utf-8');
            const regex = /^OWNER_NUMBER=.*/m;
            if (regex.test(envContent)) {
              envContent = envContent.replace(regex, `OWNER_NUMBER=${phone}`);
            } else {
              envContent += `\nOWNER_NUMBER=${phone}`;
            }
            fs.writeFileSync(envPath, envContent, 'utf-8');
          }
        }
        
        // Explicitly set presence based on ALWAYS_ONLINE setting
        const alwaysOnline = process.env.ALWAYS_ONLINE === 'true';
        this._alwaysOnline = alwaysOnline;
        try {
          if (alwaysOnline) {
            await this.client.sendPresenceUpdate('available');
          } else {
            await this.client.sendPresenceUpdate('unavailable');
          }
        } catch (e) {
          // Ignore presence update errors
        }
        
        this.emit('ready');
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        if (statusCode === DisconnectReason.restartRequired || 
            (this.pairingCodeRequested && statusCode !== DisconnectReason.loggedOut)) {
          this.isFirstPairingAttempt = false;
          this.pairingCodeRequested = false;
          await delay(1000);
          await this.connectWithAuth(sessionPath);
          return;
        }
        if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
          this.authFailures++;
          if (this.authFailures >= 5) {
            this.logger.info('Clearing session after 5 failed attempts and restarting...');
            fs.rmSync(sessionPath, { recursive: true, force: true });
            this.authFailures = 0;
            this.pairingCodeRequested = false;
            this.pairingMethod = null;
            this.phoneNumber = null;
            this.isFirstPairingAttempt = true;
            await delay(2000);
            await this.connect();
          } else {
            await delay(5000);
            await this.connect();
          }
          return;
        }
        const shouldReconnect = (lastDisconnect?.error instanceof Boom) && statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          await delay(5000);
          await this.connect();
        }
      }
    });

    this.client.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        if (!msg.message && !msg.messageStubType && !msg.key?.isViewOnce) continue;
        try {
          memoryStore.saveMessage('whatsapp', msg.key.remoteJid, msg.key.id, msg);
          const messageContext = await this.parseMessage(msg);
          this.emitMessage(messageContext);
        } catch (error) {
          this.logger.error({ error }, 'Failed to parse WhatsApp message');
        }
      }
    });

    this.client.ev.on('messages.update', async (updates) => {
      // Forward raw update events so plugins can survive internal client re-connects.
      this.emit('raw:messages.update', updates);
      for (const update of updates) {
        // WhatsApp edits often come as a protocol message in the update
        const messageUpdate = update.update;
        const key = update.key;

        // Check for protocol message (edit)
        const isProtocolEdit = messageUpdate.message?.protocolMessage?.type === 14 || messageUpdate.message?.protocolMessage?.editedMessage;
        const isDirectEdit = messageUpdate.message?.editedMessage;

        if (isProtocolEdit || isDirectEdit) {
          try {
            const originalMsg = memoryStore.getMessage('whatsapp', key.remoteJid, key.id);
            const editedMsg = isProtocolEdit 
              ? (messageUpdate.message.protocolMessage.editedMessage || messageUpdate.message.protocolMessage)
              : messageUpdate.message.editedMessage;
            
            if (editedMsg) {
              const mergedMessage = this.mergeEditedMessageWithOriginalContext(
                editedMsg.message || editedMsg,
                originalMsg?.message || {}
              );
              const msg = {
                key,
                message: mergedMessage,
                pushName: update.pushName || originalMsg?.pushName || 'User',
                messageTimestamp: update.messageTimestamp || Math.floor(Date.now() / 1000)
              };
              
              memoryStore.saveMessage('whatsapp', key.remoteJid, key.id, msg);
              const messageContext = await this.parseMessage(msg);
              
              if (messageContext.command || (messageContext.text && messageContext.text.startsWith(this.config.prefix))) {
                this.logger.info({ chatId: key.remoteJid, msgId: key.id }, 'Detected WhatsApp protocol edit, re-processing');
                this.emitMessage(messageContext);
              }
            }
          } catch (error) {
            this.logger.error({ error }, 'Failed to process WhatsApp protocol edit');
          }
          continue;
        }

        // Fallback for standard message property updates
        if (messageUpdate.message) {
          try {
            const msg = memoryStore.getMessage('whatsapp', key.remoteJid, key.id);
            if (msg) {
              const updatedMsg = { ...msg, ...messageUpdate };
              memoryStore.saveMessage('whatsapp', key.remoteJid, key.id, updatedMsg);
              
              const messageContext = await this.parseMessage(updatedMsg);
              if (messageContext.command || (messageContext.text && messageContext.text.startsWith(this.config.prefix))) {
                this.logger.info({ chatId: key.remoteJid, msgId: key.id }, 'Detected standard message update, re-processing');
                this.emitMessage(messageContext);
              }
            }
          } catch (error) {
            this.logger.error({ error }, 'Failed to process WhatsApp message update');
          }
        }
      }
    });
  }

  async promptPairingMethod() {
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('Choose login method (1 = QR code, 2 = 8-digit pairing code): ', (answer) => {
        rl.close();
        resolve(answer.trim() === '2' ? 'pairingCode' : 'qr');
      });
    });
  }

  async promptPhoneNumber() {
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('Enter your phone number: ', (answer) => {
        rl.close();
        resolve(answer.trim().replace(/[^\d]/g, ''));
      });
    });
  }

  async parseMessage(msg) {
    const isGroup = msg.key.remoteJid?.endsWith('@g.us');
    const chatId = msg.key.remoteJid;
    let senderId = isGroup ? msg.key.participant : msg.key.remoteJid;
    const originalSenderId = senderId;

    if (isGroup && senderId?.endsWith('@lid')) {
        if (msg.key.participantAlt) senderId = msg.key.participantAlt;
        else if (msg.key.participantPn) senderId = msg.key.participantPn;
        else {
          try {
            const pn = await this.client.signalRepository.lidMapping.getPNForLID(senderId);
            if (pn) senderId = pn;
          } catch (e) {}
        }
    } else if (!isGroup && senderId?.endsWith('@lid') && msg.key.remoteJidAlt) {
        senderId = msg.key.remoteJidAlt;
    }
    
    senderId = jidNormalizedUser(senderId);
    if (originalSenderId?.endsWith('@lid') && senderId?.endsWith('@s.whatsapp.net')) {
      mapLidToJid(originalSenderId, senderId);
    } else if (msg.key.participant && msg.key.participant.endsWith('@lid') && senderId?.endsWith('@s.whatsapp.net')) {
      mapLidToJid(msg.key.participant, senderId);
    }

    upsertKnownChat(chatId, { isGroup });
    if (senderId) {
      upsertKnownContact(senderId, { name: msg.pushName || senderId.split('@')[0] });
    }
    dedupeKnownEntities();

    const text = this.extractText(msg.message);
    const media = this.extractMedia(msg.message, msg);
    const mentions = this.getMentions(msg.message);

    let command = null;
    let args = [];
    if (text.startsWith(this.config.prefix)) {
      const cleanedText = text.slice(this.config.prefix.length).trimStart();
      const parts = cleanedText.split(/\s+/);
      command = parts[0].toLowerCase();
      args = parts.slice(1);
    }

    // --- Robust owner detection: always remove WhatsApp suffixes like :90 ---
    let trueSenderId = senderId;
    if (msg.key.fromMe && this.client?.user?.id) {
      trueSenderId = this.client.user.id;
    }
    const cleanSender = trueSenderId.split(':')[0];
    const senderNum = this.normalizeNumber(cleanSender.split('@')[0]);
    const ownerNum = this.normalizeNumber(this.config.ownerNumber);
    const isOwner = senderNum === ownerNum;

    let isAdmin = false;
    if (isGroup) {
      try {
        const groupMetadata = await this.client.groupMetadata(chatId);
        
        // Extract phone number from senderId for comparison
        const senderPhone = senderId.split('@')[0].replace(/[^\d]/g, '');
        const normalizedSenderId = jidNormalizedUser(senderId);

        const participant = groupMetadata.participants.find(p => {
          // Get all possible identifiers for this participant
          const pId = jidNormalizedUser(p.id);
          const pLid = p.lid ? jidNormalizedUser(p.lid) : null;
          
          // Extract phone number from participant's id or phoneNumber field
          const pPhoneFromId = p.id ? p.id.split('@')[0].replace(/[^\d]/g, '') : null;
          const pPhoneFromField = p.phoneNumber ? p.phoneNumber.replace(/[^\d]/g, '') : null;
          
          // Check all possible matches
          const match = pId === normalizedSenderId || 
                        pLid === normalizedSenderId ||
                        (pPhoneFromId && pPhoneFromId === senderPhone) ||
                        (pPhoneFromField && pPhoneFromField === senderPhone);
          
          return match;
        });
        
        isAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';
        
        if (isOwner && !isAdmin) {
          isAdmin = true;
        }
      } catch (error) {
        this.logger.error({ error }, 'Failed to get group metadata');
        if (isOwner) isAdmin = true;
      }
    }

    let quoted = null;
    const contextInfo = this.getContextInfo(msg.message);
    
    if (contextInfo?.quotedMessage) {
      const quotedMsg = contextInfo.quotedMessage;
      let quotedSenderId = contextInfo.participant || contextInfo.remoteJid;
      
      // Handle LID format for quoted sender
      if (quotedSenderId?.endsWith('@lid')) {
        try {
          const pn = await this.client.signalRepository.lidMapping.getPNForLID(quotedSenderId);
          if (pn) quotedSenderId = pn;
        } catch (e) {}
      }
      if (quotedSenderId) {
        quotedSenderId = jidNormalizedUser(quotedSenderId);
      }

      quoted = this.buildQuotedMessage(contextInfo, chatId, quotedMsg, quotedSenderId);
    }

    return new MessageContext({
      platform: 'whatsapp',
      messageId: msg.key.id,
      messageKey: msg.key,
      chatId,
      senderId: cleanSender,
      senderName: msg.pushName || senderId.split('@')[0],
      text,
      command,
      args,
      mentions,
      media,
      isGroup,
      isOwner,
      isAdmin,
      isFromMe: msg.key.fromMe || false,
      quoted,
      raw: msg
    }, this);
  }

  async sendMessage(chatId, text, options = {}) {
    const message = { text };
    if (Array.isArray(options.mentions) && options.mentions.length > 0) {
      message.mentions = options.mentions;
    }
    if (options.linkPreview === false) {
      message.linkPreview = false;
    }

    const sendOptions = {};
    const quotedMessage = this.normalizeQuotedMessage(chatId, options.quoted);
    if (quotedMessage) {
      sendOptions.quoted = quotedMessage;
    }

    const sent = await this.client.sendMessage(chatId, message, sendOptions);
    if (sent?.key?.id) memoryStore.saveMessage('whatsapp', chatId, sent.key.id, sent);
    return sent;
  }

  async sendReaction(chatId, messageKey, emoji) {
    const key = typeof messageKey === 'object' ? messageKey : { id: messageKey, remoteJid: chatId, fromMe: false };
    return await this.client.sendMessage(chatId, { react: { text: emoji, key: key } });
  }

  async sendPresence(chatId, type = 'composing') {
    // Baileys supports socket-level and chat-level presence updates.
    // 'available'/'unavailable' can be sent without a jid; others require a chat jid.
    if (!this.client) return;
    const normalizedType = type || 'composing';
    if ((normalizedType === 'available' || normalizedType === 'unavailable') && !chatId) {
      return await this.client.sendPresenceUpdate(normalizedType);
    }
    return await this.client.sendPresenceUpdate(normalizedType, chatId);
  }

  async markRead(chatId, messageId, messageKey = null) {
    if (!this.client || !messageId || !chatId) return;
    const key = {
      remoteJid: chatId,
      id: messageId,
      fromMe: messageKey?.fromMe || false,
      participant: messageKey?.participant
    };
    try {
      await this.client.readMessages([key]);
    } catch (e) {
      // Ignore read errors to avoid blocking message flow
    }
  }

  async deleteMessage(chatId, messageId) {
    return await this.client.sendMessage(chatId, { delete: { id: messageId, remoteJid: chatId } });
  }

  async clearChat(chatId) {
    try {
      // Baileys requires the key and timestamp of the last message to clear/delete a chat properly
      const lastMsg = memoryStore.getLatestMessage('whatsapp', chatId);
      
      // this.logger.info({ chatId, hasLastMsg: !!lastMsg }, 'Attempting to clear chat');

      // 1. First attempt: Delete for me (clears history but keeps chat in list)
      try {
        await this.client.chatModify({
          clear: {
            messages: lastMsg ? [{
              key: lastMsg.key,
              messageTimestamp: lastMsg.messageTimestamp
            }] : []
          }
        }, chatId);
      } catch (e) {
        this.logger.warn({ error: e.message, chatId }, 'Chat clear failed, trying delete');
      }

      // 2. Second attempt: Delete chat (removes from list)
      await this.client.chatModify(
        { 
          delete: true,
          lastMessages: lastMsg ? [{
            key: lastMsg.key,
            messageTimestamp: lastMsg.messageTimestamp
          }] : []
        }, 
        chatId
      );
      
      return true;
    } catch (error) {
      this.logger.error({ error: error.message, chatId }, 'Failed to clear chat');
      // Final fallback: old style clear if possible
      try {
        await this.client.chatModify({ clear: 'all' }, chatId);
        return true;
      } catch (e) {
        throw error;
      }
    }
  }

  async downloadMedia(mediaInfo) {
    try {
      return await downloadMediaMessage(mediaInfo.raw, 'buffer', {}, { logger: this.logger, reuploadRequest: this.client.updateMediaMessage });
    } catch (error) {
      throw error;
    }
  }

  async isGroupAdmin(chatId, userId) {
    try {
      const groupMetadata = await this.client.groupMetadata(chatId);
      
      // Extract phone number from userId for comparison
      const userPhone = userId.split('@')[0].replace(/[^\d]/g, '');
      const normalizedUserId = jidNormalizedUser(userId);
      
      const participant = groupMetadata.participants.find(p => {
        const pId = jidNormalizedUser(p.id);
        const pLid = p.lid ? jidNormalizedUser(p.lid) : null;
        const pPhoneFromId = p.id ? p.id.split('@')[0].replace(/[^\d]/g, '') : null;
        const pPhoneFromField = p.phoneNumber ? p.phoneNumber.replace(/[^\d]/g, '') : null;
        
        return pId === normalizedUserId || 
               pLid === normalizedUserId ||
               (pPhoneFromId && pPhoneFromId === userPhone) ||
               (pPhoneFromField && pPhoneFromField === userPhone);
      });
      
      return participant?.admin === 'admin' || participant?.admin === 'superadmin';
    } catch (error) {
      return false;
    }
  }

  async getInfo(id) {
    try {
      if (id.endsWith('@g.us')) return await this.client.groupMetadata(id);
      return await this.client.onWhatsApp(id);
    } catch (error) {
      return null;
    }
  }

  getContacts() {
    if (this.contacts && this.contacts.size) {
      return Object.fromEntries(this.contacts.entries());
    }
    return this.client?.contacts || {};
  }

  async sendMedia(chatId, mediaBuffer, mediaType, options = {}) {
    // Support both string and object for mediaType
    let type = mediaType;
    let mimetype = options.mimetype;
    
    if (mediaType && typeof mediaType === 'object') {
      type = mediaType.type || mediaType.mediaType || mediaType.kind;
      if (mediaType.mimetype) mimetype = mediaType.mimetype;
    }
    
    if (!type && options && typeof options === 'object' && !Array.isArray(options)) {
      type = options.type || options.mediaType || options.kind;
    }

    if (!type) {
      throw new Error('Media type is required. Received: ' + JSON.stringify(mediaType));
    }

    let message = {};
    if (type === 'image') {
      message.image = mediaBuffer;
      if (options.caption) message.caption = options.caption;
    } else if (type === 'video') {
      message.video = mediaBuffer;
      if (options.caption) message.caption = options.caption;
      if (options.gifPlayback) message.gifPlayback = true;
      if (mimetype) message.mimetype = mimetype;
    } else if (type === 'audio') {
      message.audio = mediaBuffer;
      message.mimetype = mimetype || 'audio/mp4';
      if (options.ptt) message.ptt = true;
    } else if (type === 'document') {
      message.document = mediaBuffer;
      message.mimetype = mimetype || 'application/octet-stream';
      if (options.fileName) message.fileName = options.fileName;
      if (options.caption) message.caption = options.caption;
    } else if (type === 'sticker') {
      message.sticker = mediaBuffer;
    } else {
      throw new Error('Unsupported media type: ' + type);
    }
    if (Array.isArray(options.mentions) && options.mentions.length > 0) {
      message.mentions = options.mentions;
    }
    const sendOptions = {};
    const quotedMessage = this.normalizeQuotedMessage(chatId, options.quoted);
    if (quotedMessage) {
      sendOptions.quoted = quotedMessage;
    }
    const sent = await this.client.sendMessage(chatId, message, sendOptions);
    if (sent?.key?.id) memoryStore.saveMessage('whatsapp', chatId, sent.key.id, sent);
    return sent;
  }

  normalizeQuotedMessage(chatId, quoted) {
    if (!quoted) return null;

    if (quoted.key && quoted.message) {
      return quoted;
    }

    if (quoted.raw?.key && quoted.raw?.message) {
      return quoted.raw;
    }

    if (quoted.messageKey) {
      return this.normalizeQuotedMessage(chatId, quoted.messageKey);
    }

    if (quoted.id || quoted.remoteJid || quoted.participant || quoted.fromMe !== undefined) {
      const key = {
        remoteJid: quoted.remoteJid || chatId,
        id: quoted.id,
        fromMe: quoted.fromMe || false,
        participant: quoted.participant
      };
      const storedMessage = memoryStore.getMessage('whatsapp', key.remoteJid, key.id);
      if (storedMessage?.key && storedMessage?.message) {
        return storedMessage;
      }
      return { key, message: undefined };
    }

    if (typeof quoted === 'string') {
      const storedMessage = memoryStore.getMessage('whatsapp', chatId, quoted);
      if (storedMessage?.key && storedMessage?.message) {
        return storedMessage;
      }
      return { key: { id: quoted, remoteJid: chatId, fromMe: false }, message: undefined };
    }

    return null;
  }

  async setAlwaysOnline(value) {
    this._alwaysOnline = value;
    try {
      if (value) {
        await this.client.sendPresenceUpdate('available');
      } else {
        await this.client.sendPresenceUpdate('unavailable');
      }
    } catch (e) {
      // Ignore presence update errors
    }
  }

  async editMessage(chatId, messageId, newText, options = {}) {
    // WhatsApp now supports editing messages sent by the bot
    try {
      await this.client.editMessage(chatId, { id: messageId, remoteJid: chatId, fromMe: true }, { text: newText });
    } catch (e) {
      throw new Error('Failed to edit message: ' + e.message);
    }
  }

  async disconnect() {
    if (!this.client) return;
    try {
      this.client.ws?.close?.();
      this.client.end?.(new Error('Bot shutdown'));
    } catch (error) {
      this.logger.warn({ error }, 'WhatsApp socket close failed');
    }
    this.client = null;
  }
}
