import pino from 'pino';
import config from '../config/default.js';

const level = config.logging.level || 'info';
const prettyEnabled = config.logging.pretty !== false;
const showTimestamp = config.logging.timestamps !== false;

const pinoOptions = {
  level,
  base: undefined,
  timestamp: showTimestamp ? pino.stdTimeFunctions.isoTime : false,
  formatters: {
    level(label) {
      return { level: label };
    }
  },
  serializers: {
    error: pino.stdSerializers.err,
    err: pino.stdSerializers.err
  }
};

if (prettyEnabled) {
  pinoOptions.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname',
      singleLine: false
    }
  };
}

const logger = pino(pinoOptions);

logger.simplifyLog = function (message) {
  // Remove timestamp, component, and duplicate lines
  return message
    .replace(/\[\d{2}:\d{2}:\d{2}\] /g, '') // Remove timestamps
    .replace(/\s*component: ".*"/g, '') // Remove component lines
    .replace(/\s*- /g, '- ') // Normalize dashes
    .replace(/\n{2,}/g, '\n') // Remove extra newlines
    .replace(/\n(?=\n)/g, '') // Remove consecutive newlines
    .replace(/\n+$/, '') // Remove trailing newlines
    .replace(/\s{2,}/g, ' '); // Remove extra spaces
};

logger.makeChild = function (bindings = {}) {
  return logger.child(bindings);
};

export default logger;
