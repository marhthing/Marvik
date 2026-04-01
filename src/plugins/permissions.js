import {
  allowCommandForJid,
  denyCommandForJid,
  getAllowedCommandsMap,
  isCommandAllowedForJid,
  migrateLegacyPermissionsStorage
} from '../state/permissions.js';

export default {
  name: 'permissions',
  description: 'Manage per-user command permissions',
  version: '1.1.0',
  author: 'Are Martins',
  async onLoad() {
    migrateLegacyPermissionsStorage();
  },
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
        const [cmd] = ctx.args;
        const jid = ctx.chatId;
        if (!cmd || !jid) {
          return ctx.reply('Usage: .allow <cmd>');
        }

        if (!isCommandAllowedForJid(cmd, jid)) {
          allowCommandForJid(cmd, jid);
          ctx.reply(`Allowed ${cmd} command`);
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
        const [cmd] = ctx.args;
        const jid = ctx.chatId;
        if (!cmd || !jid) {
          return ctx.reply('Usage: .deny <cmd>');
        }

        if (isCommandAllowedForJid(cmd, jid)) {
          denyCommandForJid(cmd, jid);
          ctx.reply(`Removed ${cmd} command`);
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
        const allowed = getAllowedCommandsMap();
        const myJid = ctx.chatId;
        const allowedCmds = Object.entries(allowed)
          .filter(([, jids]) => Array.isArray(jids) && jids.includes(myJid))
          .map(([cmd]) => cmd);

        if (!allowedCmds.length) {
          return ctx.reply('No allowed commands set for this chat.');
        }

        let msg = '*Allowed commands:*\n';
        for (const cmd of allowedCmds) {
          msg += `- ${cmd}\n`;
        }
        ctx.reply(msg);
      }
    }
  ]
};

