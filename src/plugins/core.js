// pm2style.js - Plugin for .shutdown, .update, .restart commands (PM2 style)
import { writeFileSync } from 'fs';
import { execSync } from 'child_process';
import logger from '../utils/logger.js';
import { recordLifecycleEvent, setPendingLifecycleAction } from '../state/lifecycle.js';

const cwd = process.cwd();
const pluginLogger = logger.child({ component: 'core' });

export default {
  name: 'core',
  description: 'Bot process management commands: .shutdown, .update, .restart',
  version: '1.0.0',
  author: 'Are Martins',
  commands: [
    {
      name: 'shutdown',
      aliases: [],
      description: 'Shutdown the bot process',
      usage: '.shutdown',
      category: 'owner',
      ownerOnly: true,
      adminOnly: false,
      groupOnly: false,
      cooldown: 0,
      async execute(ctx) {
        await ctx.reply('🛑 Shutting down...');
        pluginLogger.info('Shutdown command received');
        recordLifecycleEvent('shutdown_requested', {
          chatId: ctx.chatId,
          senderId: ctx.senderId || null,
          senderName: ctx.senderName || null
        });
        if (ctx.bot && typeof ctx.bot.stop === 'function') {
          await ctx.bot.stop();
        }
        process.exit(0);
      }
    },
    {
      name: 'restart',
      aliases: [],
      description: 'Restart the bot process',
      usage: '.restart',
      category: 'owner',
      ownerOnly: true,
      adminOnly: false,
      groupOnly: false,
      cooldown: 0,
      async execute(ctx) {
        await ctx.reply('♻️ Restarting...');
        pluginLogger.info('Restart command received');
        setPendingLifecycleAction({
          type: 'restart',
          chatId: ctx.chatId,
          senderId: ctx.senderId || null,
          senderName: ctx.senderName || null,
          messageKey: ctx.messageKey || ctx.raw?.key || null
        });
        recordLifecycleEvent('restart_requested', {
          chatId: ctx.chatId,
          senderId: ctx.senderId || null,
          senderName: ctx.senderName || null
        });
        if (ctx.bot && typeof ctx.bot.restart === 'function') {
           await ctx.bot.restart();
        } else {
           process.exit(0);
        }
      }
    },
    {
      name: 'update',
      aliases: [],
      description: 'Check for updates',
      usage: '.update',
      category: 'owner',
      ownerOnly: true,
      adminOnly: false,
      groupOnly: false,
      cooldown: 0,
      async execute(ctx) {
        // Only check for updates, do not handle .update now logic here
        try {
          const { execSync } = await import('child_process');
          execSync('git fetch');
          const status = execSync('git status -uno').toString();
          if (status.includes('Your branch is up to date')) {
            await ctx.reply('✅ Bot is already up to date.');
          } else {
            await ctx.reply('🆕 Update available! Use `.update now` to apply.');
          }
        } catch (error) {
          await ctx.reply('❌ Error checking for updates: ' + error.message);
        }
      }
    },
    {
      name: 'updatenow',
      aliases: ['update now'], 
      description: 'Apply update if available (reclone only if update exists)',
      usage: '.update now',
      category: 'owner',
      ownerOnly: true,
      adminOnly: false,
      groupOnly: false,
      cooldown: 0,
      async execute(ctx) {
        // Check if local git is up to date with remote, then reclone if not
        try {
          const { execSync } = await import('child_process');
          const fs = await import('fs');
          const path = await import('path');
          execSync('git fetch');
          const local = execSync('git rev-parse HEAD').toString().trim();
          let remote;
          try {
            remote = execSync('git rev-parse @{u}').toString().trim();
          } catch (e) {
            await ctx.reply('❌ Could not determine remote tracking branch. Is this a git repo with a remote?');
            return;
          }
          if (local === remote) {
            await ctx.reply('✅ Bot is already up to date.');
            return;
          } else {
            await ctx.reply('🗑️ Update available! updating....');
            const repoUrl = 'https://github.com/marhthing/MatBot.git';
            const tempDir = path.join(cwd, 'temp_update');
            // Clone latest code to temp_update
            if (fs.existsSync(tempDir)) {
              if (process.platform === 'win32') {
                execSync(`powershell -Command \"Remove-Item '${tempDir}' -Recurse -Force\"`);
              } else {
                execSync(`rm -rf '${tempDir}'`);
              }
            }
            execSync(`git clone --depth 1 ${repoUrl} ${tempDir}`);
            // Delete everything except keep list
            const keep = ['.env', 'session', 'index.js', 'storage', 'cookies', 'node_modules', 'package-lock.json'];
            const all = fs.readdirSync(cwd);
            for (const item of all) {
              if (keep.includes(item) || item === 'temp_update') continue;
              try {
                const full = path.join(cwd, item);
                if (fs.lstatSync(full).isDirectory()) {
                  if (process.platform === 'win32') {
                    execSync(`powershell -Command \"Remove-Item '${full}' -Recurse -Force\"`);
                  } else {
                    execSync(`rm -rf '${full}'`);
                  }
                } else {
                  fs.unlinkSync(full);
                }
              } catch (e) {
                await ctx.reply(`⚠️ Error deleting ${item}: ${e.message}`);
              }
            }
            // Copy new files from temp_update to cwd, except keep list (only at root)
            const copyRecursiveSync = (src, dest) => {
              const entries = fs.readdirSync(src, { withFileTypes: true });
              for (const entry of entries) {
                // Only skip keep list at root level
                if (keep.includes(entry.name) && dest === cwd) continue;
                const srcPath = path.join(src, entry.name);
                const destPath = path.join(dest, entry.name);
                if (entry.isDirectory()) {
                  if (!fs.existsSync(destPath)) fs.mkdirSync(destPath);
                  copyRecursiveSync(srcPath, destPath);
                } else {
                  fs.copyFileSync(srcPath, destPath);
                }
              }
            };
            copyRecursiveSync(tempDir, cwd);
            // Remove temp_update
            if (process.platform === 'win32') {
              execSync(`powershell -Command \"Remove-Item '${tempDir}' -Recurse -Force\"`);
            } else {
              execSync(`rm -rf '${tempDir}'`);
            }
            // Debug: List root directory contents before restart
            const afterUpdate = fs.readdirSync(cwd);
            pluginLogger.debug({ entries: afterUpdate }, 'Root directory after update');
            if (!fs.existsSync(path.join(cwd, 'src', 'index.js'))) {
              pluginLogger.error('src/index.js is missing after update');
            }
            try {
              pluginLogger.info('Update complete, exiting for fresh start');
              if (ctx.bot && typeof ctx.bot.stop === 'function') {
                await ctx.bot.stop();
              }
              process.exit(0);
            } catch (e) {
              await ctx.reply('❌ Error exiting process: ' + e.message);
            }
          }
        } catch (error) {
          await ctx.reply('❌ Error checking for updates: ' + error.message);
        }
      }
    },
    {
      name: 'updateforce',
      aliases: ['update force'],
      description: 'Force reclone and clean environment, regardless of update status',
      usage: '.update force',
      category: 'owner',
      ownerOnly: true,
      adminOnly: false,
      groupOnly: false,
      cooldown: 0,
      async execute(ctx) {
        await ctx.reply('Force updating.....');
        const fs = await import('fs');
        const { execSync } = await import('child_process');
        const path = await import('path');
        const repoUrl = 'https://github.com/marhthing/MatBot.git';
        const tempDir = path.join(cwd, 'temp_update');
        if (fs.existsSync(tempDir)) {
          if (process.platform === 'win32') {
            execSync(`powershell -Command \"Remove-Item '${tempDir}' -Recurse -Force\"`);
          } else {
            execSync(`rm -rf '${tempDir}'`);
          }
        }
        execSync(`git clone --depth 1 ${repoUrl} ${tempDir}`);
        const keep = ['.env', 'session', 'index.js', 'storage', 'cookies', 'node_modules', 'package-lock.json'];
        const all = fs.readdirSync(cwd);
        for (const item of all) {
          if (keep.includes(item) || item === 'temp_update') continue;
          try {
            const full = path.join(cwd, item);
            if (fs.lstatSync(full).isDirectory()) {
              if (process.platform === 'win32') {
                execSync(`powershell -Command \"Remove-Item '${full}' -Recurse -Force\"`);
              } else {
                execSync(`rm -rf '${full}'`);
              }
            } else {
              fs.unlinkSync(full);
            }
          } catch (e) {}
        }
        // Copy new files from temp_update to cwd, except keep list (only at root)
        const copyRecursiveSync = (src, dest) => {
          const entries = fs.readdirSync(src, { withFileTypes: true });
          for (const entry of entries) {
            // Only skip keep list at root level
            if (keep.includes(entry.name) && dest === cwd) continue;
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            if (entry.isDirectory()) {
              if (!fs.existsSync(destPath)) fs.mkdirSync(destPath);
              copyRecursiveSync(srcPath, destPath);
            } else {
              fs.copyFileSync(srcPath, destPath);
            }
          }
        };
        copyRecursiveSync(tempDir, cwd);
        if (process.platform === 'win32') {
          execSync(`powershell -Command \"Remove-Item '${tempDir}' -Recurse -Force\"`);
        } else {
          execSync(`rm -rf '${tempDir}'`);
        }
        // Start the root index.js in the foreground (interactive)
        execSync('node index.js', { stdio: 'inherit' });
        if (ctx.bot && typeof ctx.bot.stop === 'function') {
          await ctx.bot.stop();
        }
        process.exit(0);
      }
    }
  ],
  async onLoad(bot) {
    const restartHours = Math.max(0, Number(bot?.config?.autoRestartHours || 0) || 0);
    if (restartHours <= 0) {
      pluginLogger.debug('Auto-restart is disabled');
      return undefined;
    }

    const RESTART_INTERVAL = restartHours * 60 * 60 * 1000;
    pluginLogger.info({ restartHours }, 'Auto-restart scheduled');
    const restartTimer = setInterval(async () => {
      pluginLogger.info('Auto-restart triggered');
      if (bot && typeof bot.restart === 'function') {
        await bot.restart();
      } else {
        process.exit(0);
      }
    }, RESTART_INTERVAL);

    return () => clearInterval(restartTimer);
  }
};

