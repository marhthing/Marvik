import logger from '../utils/logger.js';
import { getBooleanEnv } from '../utils/envStore.js';
import { getAllowedCommandsMap } from '../state/permissions.js';

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
    this.commandExecutedHandlers = new Set();
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

    if (commandData.aliases) {
      for (const alias of commandData.aliases) {
        this.commands.set(alias, this.commands.get(name));
      }
    }

    this.logger.info(`Registered command: ${name}`);
  }

  registerMessageHandler(fn) {
    this.messageHandlers.add(fn);
    return () => this.unregisterMessageHandler(fn);
  }

  unregisterMessageHandler(fn) {
    return this.messageHandlers.delete(fn);
  }

  getMessageHandlers() {
    return Array.from(this.messageHandlers);
  }

  registerCommandExecutedHandler(fn) {
    this.commandExecutedHandlers.add(fn);
    return () => this.unregisterCommandExecutedHandler(fn);
  }

  unregisterCommandExecutedHandler(fn) {
    return this.commandExecutedHandlers.delete(fn);
  }

  getCommandExecutedHandlers() {
    return Array.from(this.commandExecutedHandlers);
  }

  get(name) {
    return this.commands.get(name);
  }

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

    const userJid = messageContext.senderId;
    const isOwner = messageContext.isOwner;
    const isFromMe = messageContext.isFromMe;

    let allow = false;
    const normalizeJid = (jid) => (jid || '').split('@')[0].replace(/\D/g, '');

    if (isOwner || isFromMe) {
      allow = true;
    } else {
      try {
        const allowed = getAllowedCommandsMap();
        const userJidsToCheck = [userJid];

        if (messageContext.raw?.key?.remoteJidAlt) {
          userJidsToCheck.push(messageContext.raw.key.remoteJidAlt);
        }

        if (messageContext.chatId) {
          userJidsToCheck.push(messageContext.chatId);
        }

        const normalizedJids = userJidsToCheck.map(normalizeJid);

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

      if (
        Array.isArray(command.allowedUsers) &&
        (command.allowedUsers.includes(userJid) || command.allowedUsers.map(normalizeJid).includes(normalizeJid(userJid)))
      ) {
        allow = true;
      }

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

    if (command.groupOnly && !messageContext.isGroup) {
      await messageContext.reply('This command only works in groups.');
      return;
    }

    if (!isOwner) {
      if (command.ownerOnly) {
        return;
      }
      if (command.adminOnly && !messageContext.isAdmin) {
        return;
      }
    }

    const cooldownTime = isOwner ? 0 : command.cooldown;
    if (cooldownTime > 0 && !this.checkCooldown(userJid, command.name, cooldownTime)) {
      await messageContext.reply('Please wait before using this command again.');
      return;
    }

    if (botReactions === 'on' && typeof messageContext.react === 'function') {
      try {
        await messageContext.react('⏳');
      } catch {
        try {
          await messageContext.send('⏳');
        } catch {}
      }
    }

    try {
      this.logger.info(
        `Executing command: ${command.name} (Platform: ${messageContext.platform}, From: ${messageContext.isFromMe ? 'Bot' : 'User'})`
      );

      await command.execute(messageContext);

      for (const handler of this.commandExecutedHandlers) {
        try {
          await handler({ messageContext, command });
        } catch (hookError) {
          this.logger.error({ error: hookError, command: command.name }, 'Command executed hook failed');
        }
      }

      if (botReactions === 'on' && typeof messageContext.react === 'function') {
        try {
          await messageContext.react('✅');
        } catch {
          try {
            await messageContext.send('✅');
          } catch {}
        }
      }
    } catch (error) {
      this.logger.error({ error, command: command.name }, 'Command execution failed');

      if (botReactions === 'on' && typeof messageContext.react === 'function') {
        try {
          await messageContext.react('❌');
        } catch {
          try {
            await messageContext.send('❌');
          } catch {}
        }
      }

      await messageContext.reply('An error occurred while executing the command.');
    }
  }

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
    setTimeout(() => this.cooldowns.delete(key), 60000);
    return true;
  }

  unregister(name) {
    const command = this.commands.get(name);
    if (!command) return false;

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
