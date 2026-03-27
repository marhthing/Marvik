import logger from '../utils/logger.js';
import { getBooleanEnv } from '../utils/envStore.js';
import { readStorage } from '../utils/storageStore.js';

/**
 * Command Registry
 * Manages all bot commands and dispatches them
 */
export default class CommandRegistry {
  constructor(config) {
    this.config = config;
    this.commands = new Map();
    this.cooldowns = new Map();
    this.logger = logger.child({ component: 'CommandRegistry' });
    this.messageHandlers = new Set();
  }

  /**
   * Register a command
   * @param {string} name - Command name
   * @param {object} commandData - Command configuration
   */
  register(name, commandData) {
    if (this.commands.has(name)) {
      this.logger.warn(`Command '${name}' is already registered. Overwriting...`);
    }

    this.commands.set(name, {
      name,
      aliases: commandData.aliases || [],
      description: commandData.description || 'No description',
      usage: commandData.usage || `${this.config.prefix}${name}`,
      category: commandData.category || 'general',
      ownerOnly: commandData.ownerOnly || false,
      adminOnly: commandData.adminOnly || false,
      groupOnly: commandData.groupOnly || false,
      cooldown: commandData.cooldown || 3,
      allowedUsers: commandData.allowedUsers || [],
      allowedGroups: commandData.allowedGroups || [],
      execute: commandData.execute
    });

    // Register aliases
    if (commandData.aliases) {
      for (const alias of commandData.aliases) {
        this.commands.set(alias, this.commands.get(name));
      }
    }

    this.logger.info(`Registered command: ${name}`);
  }

  /**
   * Register a message handler for all messages (not just commands)
   * @param {function} fn - Handler function (ctx) => {}
   */
  registerMessageHandler(fn) {
    this.messageHandlers.add(fn);
    return () => this.unregisterMessageHandler(fn);
  }

  /**
   * Unregister a previously registered message handler
   * @param {function} fn
   */
  unregisterMessageHandler(fn) {
    return this.messageHandlers.delete(fn);
  }

  /**
   * Get all registered message handlers
   */
  getMessageHandlers() {
    return Array.from(this.messageHandlers);
  }

  /**
   * Get a command by name or alias
   */
  get(name) {
    return this.commands.get(name);
  }

  /**
   * Get all commands
   */
  getAll() {
    const uniqueCommands = new Map();
    for (const [key, cmd] of this.commands) {
      if (key === cmd.name) {
        uniqueCommands.set(key, cmd);
      }
    }
    return Array.from(uniqueCommands.values());
  }

  /**
   * Execute a command
   * Only allow execution if fromMe, unless the command or config allows exceptions
   */
  async execute(messageContext) {
    // Check BOT_REACTIONS in .env
    const botReactions = getBooleanEnv('BOT_REACTIONS', true) ? 'on' : 'off';

    if (!messageContext.command) {
      this.logger.info({ text: messageContext.text }, '[CommandRegistry] No command parsed from message');
      return;
    }
    const command = this.get(messageContext.command);
    if (!command) {
      this.logger.info({ command: messageContext.command }, '[CommandRegistry] Command not found');
      return;
    }

    // Use normal remoteJid logic for cooldown and permission checks
    const userJid = messageContext.senderId;
    const isOwner = messageContext.isOwner;
    const isFromMe = messageContext.isFromMe;

    // --- LOGIC FIX: allow permitted users/groups from storage.json even if isFromMe is false ---
    let allow = false;
    // Helper to normalize JIDs to digits only (for robust allow-list matching)
    const normalizeJid = jid => (jid || '').split('@')[0].replace(/\D/g, '');
    if (isOwner || isFromMe) {
      allow = true;
    } else {
      // Check allowed users/groups from storage.json
      try {
        const storage = readStorage();
        const allowed = storage.allowedCommands || {};
        // Collect all possible JIDs to check (raw, alt, chatId, and normalized forms)
        const userJidsToCheck = [userJid];
        if (messageContext.raw?.key?.remoteJidAlt) {
          userJidsToCheck.push(messageContext.raw.key.remoteJidAlt);
        }
        // Always include chatId for allow-list checks (not just for groups)
        if (messageContext.chatId) {
          userJidsToCheck.push(messageContext.chatId);
        }
        // Add normalized digit-only forms
        const normalizedJids = userJidsToCheck.map(normalizeJid);
        // Check if any allowed JID (raw or normalized) matches
        if (Array.isArray(allowed[command.name])) {
          for (const allowedJid of allowed[command.name]) {
            if (
              userJidsToCheck.includes(allowedJid) ||
              normalizedJids.includes(normalizeJid(allowedJid))
            ) {
              allow = true;
              break;
            }
          }
        }
      } catch {}
      // Exception: allow if command.allowedUsers includes this user (raw or normalized)
      if (
        Array.isArray(command.allowedUsers) &&
        (command.allowedUsers.includes(userJid) || command.allowedUsers.map(normalizeJid).includes(normalizeJid(userJid)))
      ) {
        allow = true;
      }
      // Exception: allow if command.allowedGroups includes this group (raw or normalized)
      if (
        Array.isArray(command.allowedGroups) &&
        (command.allowedGroups.includes(messageContext.chatId) || command.allowedGroups.map(normalizeJid).includes(normalizeJid(messageContext.chatId)))
      ) {
        allow = true;
      }
    }
    if (!allow) {
      return;
    }
    // --- END LOGIC FIX ---

    // Check permissions for non-owners
    if (!isOwner) {
      if (command.ownerOnly) {
        return;
      }
      if (command.adminOnly && !messageContext.isAdmin) {
        return;
      }
      if (command.groupOnly && !messageContext.isGroup) {
        await messageContext.reply('❌ This command can only be used in groups.');
        return;
      }
    }

    // Check cooldown (even for owner, but with shorter cooldown)
    const cooldownTime = isOwner ? 0 : command.cooldown;
    if (cooldownTime > 0 && !this.checkCooldown(userJid, command.name, cooldownTime)) {
      await messageContext.reply(`⏳ Please wait before using this command again.`);
      return;
    }

    // React with loading emoji before executing command (always, not just for owner)
    let loadingReacted = false;
    if (botReactions === 'on' && typeof messageContext.react === 'function') {
      try {
        await messageContext.react('⏳'); // loading emoji
        loadingReacted = true;
      } catch {
        // Fallback: send emoji as message if reaction fails
        try { await messageContext.send('⏳'); } catch {}
      }
    }

    // Execute command
    let commandSuccess = true;
    try {
      this.logger.info(`Executing command: ${command.name} (Platform: ${messageContext.platform}, From: ${messageContext.isFromMe ? 'Bot' : 'User'})`);
      await command.execute(messageContext);
      // React with tick if successful
      if (botReactions === 'on' && typeof messageContext.react === 'function') {
        try {
          await messageContext.react('✅'); // tick emoji
        } catch {
          // Fallback: send emoji as message if reaction fails
          try { await messageContext.send('✅'); } catch {}
        }
      }
    } catch (error) {
      commandSuccess = false;
      this.logger.error({ error, command: command.name }, 'Command execution failed');
      // React with failed emoji
      if (botReactions === 'on' && typeof messageContext.react === 'function') {
        try {
          await messageContext.react('❌'); // failed emoji
        } catch {
          // Fallback: send emoji as message if reaction fails
          try { await messageContext.send('❌'); } catch {}
        }
      }
      await messageContext.reply('❌ An error occurred while executing the command.');
    }
  }

  /**
   * Check command cooldown
   */
  checkCooldown(userId, commandName, cooldown) {
    const key = `${userId}-${commandName}`;
    const now = Date.now();

    if (this.cooldowns.has(key)) {
      const expirationTime = this.cooldowns.get(key) + (cooldown * 1000);
      
      if (now < expirationTime) {
        return false;
      }
    }

    this.cooldowns.set(key, now);
    
    // Clean up old cooldowns after 1 minute
    setTimeout(() => this.cooldowns.delete(key), 60000);
    
    return true;
  }

  /**
   * Unregister a command
   */
  unregister(name) {
    const command = this.commands.get(name);
    if (!command) return false;

    // Remove command and all its aliases
    this.commands.delete(name);
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.commands.delete(alias);
      }
    }

    this.logger.info(`Unregistered command: ${name}`);
    return true;
  }
}
