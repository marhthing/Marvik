import { readStorage, writeStorage } from '../utils/storageStore.js';

export default {
  name: 'permissions',
  description: 'Manage per-user command permissions',
  version: '1.0.0',
  author: 'MATDEV',
  commands: [
    {
      name: 'allow',
      description: 'Allow a user to use a command: .allow <cmd>',
      usage: '.allow <cmd>',
      category: 'owner',
      cooldown: 3,
      groupOnly: false,
      ownerOnly: true,
      adminOnly: false,
      async execute(ctx) {
        // In both private and group chats, just use chatId as the JID to allow
        const [cmd] = ctx.args;
        const jid = ctx.chatId;
        if (!cmd || !jid) {
          return ctx.reply('Usage: .allow <cmd>');
        }
        const storage = readStorage();
        storage.allowedCommands = storage.allowedCommands || {};
        storage.allowedCommands[cmd] = storage.allowedCommands[cmd] || [];
        if (!storage.allowedCommands[cmd].includes(jid)) {
          storage.allowedCommands[cmd].push(jid);
          writeStorage(storage);
          ctx.reply(`✅ Allowed ${cmd} command`);
        } else {
          ctx.reply(`${cmd} command is already allowed`);
        }
      }
    },
    {
      name: 'deny',
      aliases: ['disallow'],
      description: 'Remove a user or group from allowed list: .deny <cmd>',
      usage: '.deny <cmd>',
      category: 'owner',
      cooldown: 3,
      groupOnly: false,
      ownerOnly: true,
      adminOnly: false,
      async execute(ctx) {
        // In both private and group chats, just use chatId as the JID to remove
        const [cmd] = ctx.args;
        const jid = ctx.chatId;
        if (!cmd || !jid) {
          return ctx.reply('Usage: .deny <cmd>');
        }
        const storage = readStorage();
        storage.allowedCommands = storage.allowedCommands || {};
        storage.allowedCommands[cmd] = storage.allowedCommands[cmd] || [];
        if (storage.allowedCommands[cmd].includes(jid)) {
          storage.allowedCommands[cmd] = storage.allowedCommands[cmd].filter(j => j !== jid);
          writeStorage(storage);
          ctx.reply(`❌ Removed ${cmd} command`);
        } else {
          ctx.reply(`${cmd} command was not allowed`);
        }
      }
    },
    {
      name: 'pm',
      description: 'Show allowed users for all commands',
      usage: '.pm',
      category: 'owner',
      cooldown: 3,
      groupOnly: false,
      ownerOnly: true,
      adminOnly: false,
      async execute(ctx) {
        const storage = readStorage();
        const allowed = storage.allowedCommands || {};
        // Show only allowed commands for the current user or group
        const myJid = ctx.chatId;
        const allowedCmds = Object.entries(allowed)
          .filter(([cmd, jids]) => Array.isArray(jids) && jids.includes(myJid))
          .map(([cmd]) => cmd);
        if (!allowedCmds.length) return ctx.reply('No allowed commands set for this chat.');
        let msg = '*Allowed commands:*\n';
        for (const cmd of allowedCmds) {
          msg += `• ${cmd}\n`;
        }
        ctx.reply(msg);
      }
    }
  ]
};
