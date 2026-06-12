const pino = require('pino');
const { AsyncLocalStorage } = require('async_hooks');

// Async storage context to hold trace metadata per request thread
const logContextStorage = new AsyncLocalStorage();

// Pino configuration
const baseLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label.toUpperCase() }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Proxy logger to merge thread-local tracing context automatically
const logger = new Proxy(baseLogger, {
  get(target, property) {
    if (['info', 'warn', 'error', 'debug', 'trace', 'fatal'].includes(property)) {
      return (mergingObject, ...args) => {
        const store = logContextStorage.getStore() || {};
        const context = {
          service: process.env.SERVICE_NAME || 'node-service',
          tenant_id: store.tenantId || null,
          trace_id: store.traceId || null,
        };

        if (typeof mergingObject === 'object' && mergingObject !== null) {
          return target[property]({ ...context, ...mergingObject }, ...args);
        } else {
          return target[property](context, mergingObject, ...args);
        }
      };
    }
    return target[property];
  },
});

module.exports = {
  logger,
  logContextStorage,
};
