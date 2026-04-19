import { spawn, spawnSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
let managerLogger = createFallbackLogger('manager');

let botProcess = null;

const GITHUB_REPO = 'https://github.com/marhthing/Marvik.git';
const isInitialSetup = !existsSync('src/index.js') || !existsSync('package.json');
const isRestart = existsSync('.restart_flag');

(async () => {
  managerLogger = await resolveManagerLogger();

  managerLogger.info('Marvik Auto-Manager');
  managerLogger.info(`Working in: ${__dirname}`);

  if (isRestart) {
    managerLogger.info('Restart flag detected, clearing flag...');
    try { unlinkSync('.restart_flag'); } catch {}
  }

  if (isInitialSetup) {
    managerLogger.info('Setup needed - cloning from GitHub...');
    await cloneAndSetup();
    return;
  }

  managerLogger.info('Starting Marvik...');
  startBot('src/index.js');
})();

function createFallbackLogger(scope = 'app') {
  const prefix = `[${scope}]`;
  return {
    child(childScope) {
      return createFallbackLogger(`${scope}:${childScope}`);
    },
    info(...args) {
      console.log(prefix, ...args);
    },
    warn(...args) {
      console.warn(prefix, ...args);
    },
    error(...args) {
      console.error(prefix, ...args);
    },
  };
}

async function resolveManagerLogger() {
  const bootstrapPath = './src/utils/bootstrapLogger.js';
  if (!existsSync(bootstrapPath)) return createFallbackLogger('manager');

  try {
    const mod = await import(bootstrapPath);
    const bootstrapLogger = mod?.default;
    if (!bootstrapLogger?.child) return createFallbackLogger('manager');
    return bootstrapLogger.child('manager');
  } catch {
    return createFallbackLogger('manager');
  }
}

async function cloneAndSetup() {
  managerLogger.info('Cloning bot from GitHub...');
  managerLogger.info(`Repository: ${GITHUB_REPO}`);

  const isWindows = process.platform === 'win32';

  if (existsSync('temp_clone')) {
    if (isWindows) {
      spawnSync('powershell', ['-Command', 'Remove-Item temp_clone -Recurse -Force'], { stdio: 'inherit' });
    } else {
      spawnSync('rm', ['-rf', 'temp_clone'], { stdio: 'inherit' });
    }
  }

  const cloneResult = spawnSync('git', ['clone', GITHUB_REPO, 'temp_clone'], { stdio: 'inherit' });
  if (cloneResult.error || cloneResult.status !== 0) {
    managerLogger.error('Failed to clone repository!', cloneResult.error || { status: cloneResult.status });
    process.exit(1);
  }

  if (!existsSync('temp_clone/src/index.js')) {
    managerLogger.error('src/index.js does not exist in temp_clone after cloning!');
    process.exit(1);
  }

  managerLogger.info('src/index.js found in temp_clone, proceeding to move...');

  if (isWindows) {
    spawnSync('robocopy', ['temp_clone', '.', '/E', '/MOVE', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], { stdio: 'inherit' });
    spawnSync('robocopy', ['temp_clone', '.git', '/E', '/MOVE', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], { stdio: 'inherit' });
  } else {
    spawnSync('bash', ['-c', 'cp -rf temp_clone/* . && cp -rf temp_clone/.git . && rm -rf temp_clone'], { stdio: 'inherit' });
  }

  if (existsSync('temp_clone')) {
    if (isWindows) {
      spawnSync('powershell', ['-Command', 'Remove-Item temp_clone -Recurse -Force'], { stdio: 'inherit' });
    } else {
      spawnSync('rm', ['-rf', 'temp_clone'], { stdio: 'inherit' });
    }
  }

  managerLogger.info('Bot files moved successfully!');
  installDependencies();

  await import('./src/config/default.js');
  await import('dotenv/config');

  startBot('src/index.js');
}

function installDependencies() {
  if (!existsSync('package.json')) return;

  managerLogger.info('Installing dependencies...');
  const installResult = spawnSync('npm', ['install', '--production'], { stdio: 'inherit' });
  if (installResult.error) {
    managerLogger.error('Failed to install dependencies', installResult.error);
    process.exit(1);
  }
  if (installResult.status !== 0) {
    managerLogger.error(`Failed to install dependencies. Exit code: ${installResult.status}`);
    process.exit(1);
  }
  managerLogger.info('Dependencies installed!');
}

function startBot(entryPoint = 'src/index.js') {
  if (!existsSync(entryPoint)) {
    managerLogger.error(`Entry point ${entryPoint} not found!`);
    return;
  }

  if (botProcess) {
    managerLogger.info('Ending existing bot process...');
    botProcess.removeAllListeners('exit');
    botProcess.kill('SIGTERM');
    botProcess = null;
  }

  managerLogger.info(`Starting bot: ${entryPoint}`);
  botProcess = spawn('node', [entryPoint], { stdio: 'inherit' });

  botProcess.on('exit', (code, signal) => {
    managerLogger.warn(`Bot exited with code ${code}, signal ${signal}`);

    if (existsSync('.restart_flag')) {
      managerLogger.info('Restart flag detected - clearing flag and restarting...');
      try { unlinkSync('.restart_flag'); } catch {}
    }

    managerLogger.info('ReStarting Marvik...');
    startBot(entryPoint);
  });

  botProcess.on('error', (error) => {
    managerLogger.error('Bot start error', error);
  });

  managerLogger.info('Bot manager running!');
}

process.on('uncaughtException', (error) => {
  managerLogger.error('Manager uncaught exception', error);
});

process.on('unhandledRejection', (reason) => {
  managerLogger.error('Manager unhandled rejection', reason);
});

