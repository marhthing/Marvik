function formatScope(scope) {
  return scope ? `[${scope}]` : '[boot]';
}

function logWith(method, scope, message, details) {
  const prefix = formatScope(scope);
  if (typeof details === 'undefined') {
    console[method](`${prefix} ${message}`);
    return;
  }
  console[method](`${prefix} ${message}`, details);
}

const bootstrapLogger = {
  info(message, details) {
    logWith('log', 'boot', message, details);
  },
  warn(message, details) {
    logWith('warn', 'boot', message, details);
  },
  error(message, details) {
    logWith('error', 'boot', message, details);
  },
  child(scope) {
    return {
      info(message, details) {
        logWith('log', scope, message, details);
      },
      warn(message, details) {
        logWith('warn', scope, message, details);
      },
      error(message, details) {
        logWith('error', scope, message, details);
      }
    };
  }
};

export default bootstrapLogger;
