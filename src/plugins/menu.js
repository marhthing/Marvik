// menu.js - Plugin to show a stylish menu with bot/system info
export default {
  name: 'menu',
  description: 'Show main menu and bot info',
  version: '1.0.0',
  author: 'MATDEV',
  commands: [
    {
      name: 'menu',
      aliases: [], // Only .menu command
      description: 'Show main menu and bot info',
      usage: '.menu',
      category: 'utility',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 2,
      async execute(ctx) {
        const os = await import('os');
        const processMem = process.memoryUsage();
        const totalMem = os.default.totalmem();
        const usedMem = totalMem - os.default.freemem();
        const formatMB = (bytes) => `${(bytes / 1024 / 1024).toFixed(0)}`;
        const now = new Date();
        const time = now.toLocaleTimeString('en-US', { hour12: true });
        const day = now.toLocaleDateString('en-US', { weekday: 'long' });
        const date = now.toLocaleDateString('en-US');
        const version = '1.0.0';
        const ram = `${formatMB(usedMem)}/${formatMB(totalMem)}MB`;
        // Uptime
        const upSec = process.uptime();
        const h = Math.floor(upSec / 3600);
        const m = Math.floor((upSec % 3600) / 60);
        const s = Math.floor(upSec % 60);
        const uptime = `${h}h ${m}m ${s}s`;
        const platform = `${os.default.platform()} (${os.default.arch()})`;
        // User
        let user = ctx.pushName || ctx.senderName || ctx.sender || 'User';
        // Fetch all commands for menu
        let allCommands = [];
        if (ctx._adapter && ctx._adapter.commandRegistry && typeof ctx._adapter.commandRegistry.getAll === 'function') {
          allCommands = ctx._adapter.commandRegistry.getAll();
        } else if (ctx.bot && Array.isArray(ctx.bot.commands)) {
          allCommands = ctx.bot.commands;
        }
        const plugins = allCommands.length;
        // Group commands by category
        const categories = {};
        for (const cmd of allCommands) {
          if (!cmd.name) continue;
          const cat = cmd.category || 'other';
          if (!categories[cat]) categories[cat] = [];
          categories[cat].push(cmd);
        }
        // Build menu section
        let menuSection = '';
        for (const [cat, cmds] of Object.entries(categories)) {
          menuSection += `\n╭─ʕ ${cat} ʔ\n`;
          menuSection += cmds.map(c => ` │ .${c.name}`).join('   ') + '\n';
        }
        menuSection += '╰───────────────⊷';
        // Menu message
        const msg = `═══ MATDEV ═══⊷\n` +
          `┃¶╭──────────────\n` +
          `┃¶│ Prefix : .\n` +
          `┃¶│ User : ${user}\n` +
          `┃¶│ Time : ${time}\n` +
          `┃¶│ Day : ${day}\n` +
          `┃¶│ Date : ${date}\n` +
          `┃¶│ Version : ${version}\n` +
          `┃¶│ Plugins : ${plugins}\n` +
          `┃¶│ Ram : ${ram}\n` +
          `┃¶│ Uptime : ${uptime}\n` +
          `┃¶│ Platform : ${platform}\n` +
          `┃¶╰───────────────\n` +
          `╰═════════════════⊷` +
          menuSection;
        await ctx.reply(msg);
      }
    }
  ]
};
