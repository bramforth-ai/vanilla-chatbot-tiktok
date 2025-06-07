// utils/logger.js
const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Determine environment
const isProduction = process.env.NODE_ENV === 'production';

// Set log level based on explicit environment variable regardless of environment
const logLevel = process.env.LOG_LEVEL || 'debug';

// Check if verbose logging is disabled (works in any environment)
const verboseLogging = process.env.DISABLE_VERBOSE_LOGS !== 'true';

// Create logs directory if it doesn't exist (only for local development)
let fileTransports = [];
if (!isProduction) {
  const logsDir = path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  // Add file transports only in development
  fileTransports = [
    // File transport for errors
    new winston.transports.File({ 
      filename: path.join(logsDir, 'error.log'), 
      level: 'error' 
    }),
    // File transport for all logs
    new winston.transports.File({ 
      filename: path.join(logsDir, 'combined.log') 
    })
  ];
}

// Create a log filter to reduce verbosity when requested
const logFilter = winston.format((info) => {
  // Skip filtering if verbose logging is enabled
  if (verboseLogging) {
    return info;
  }

  // Clone the log info to avoid modifying the original
  const filteredInfo = { ...info };
  
  // Filter out large content in messages
  if (typeof filteredInfo.message === 'string' && filteredInfo.message.length > 200) {
    filteredInfo.message = `${filteredInfo.message.substring(0, 100)}... [TRUNCATED, full length: ${filteredInfo.message.length}]`;
  }
  
  // Filter out detailed objects
  for (const key in filteredInfo) {
    // Skip basic properties
    if (['level', 'message', 'timestamp', 'service'].includes(key)) {
      continue;
    }
    
    // Filter large objects
    if (typeof filteredInfo[key] === 'object' && filteredInfo[key] !== null) {
      const stringified = JSON.stringify(filteredInfo[key]);
      if (stringified.length > 200) {
        filteredInfo[key] = `[LARGE OBJECT: approx. ${stringified.length} chars]`;
      }
    }
    
    // Filter long strings
    if (typeof filteredInfo[key] === 'string' && filteredInfo[key].length > 100) {
      filteredInfo[key] = `${filteredInfo[key].substring(0, 50)}... [TRUNCATED]`;
    }
  }
  
  return filteredInfo;
})();

// Configure logger
const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    logFilter,
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'vanilla-chatbot' }, // Changed service name
  transports: [
    // Console transport
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, ...rest }) => {
          // In non-verbose mode, simplify the output
          const metaStr = verboseLogging ? JSON.stringify(rest) : '';
          return `${timestamp} ${level}: ${message} ${metaStr}`;
        })
      )
    }),
    ...fileTransports
  ]
});

// Log initial configuration
logger.info(`Logger initialized with level: ${logLevel}, verbose logging: ${verboseLogging ? 'enabled' : 'disabled'}`);

// Add helper method to safely log objects without overwhelming logs
logger.logObject = (level, message, obj) => {
  if (!verboseLogging) {
    // In non-verbose mode, just log the message
    logger.log(level, message);
  } else {
    // Otherwise, include the object (truncated if needed)
    let truncatedObj = obj;
    
    if (typeof obj === 'object' && obj !== null) {
      const str = JSON.stringify(obj);
      if (str.// utils/phone-masker.js
// Simple utility to mask phone numbers in logs for video recording

/**
 * Mask phone numbers in log messages
 * +447775722870 → +44777***2870
 * whatsapp:+447775722870 → whatsapp:+44777***2870
 * +447401296098 → +44740***6098
 * 
 * @param {string} message - Log message that may contain phone numbers
 * @returns {string} Message with phone numbers masked
 */
function maskPhoneNumbers(message) {
  if (!message || typeof message !== 'string') {
    return message;
  }

  let maskedMessage = message;

  // Pattern 1: Full UK phone numbers with + (most common)
  // +447775722870 → +44777***2870
  maskedMessage = maskedMessage.replace(
    /(\+44\d{3})(\d{3,4})(\d{3,4})/g, 
    '$1***$3'
  );

  // Pattern 2: WhatsApp formatted numbers
  // whatsapp:+447775722870 → whatsapp:+44777***2870
  maskedMessage = maskedMessage.replace(
    /(whatsapp:\+44\d{3})(\d{3,4})(\d{3,4})/g,
    '$1***$3'
  );

  // Pattern 3: Other international numbers
  // +1234567890 → +1234***890
  maskedMessage = maskedMessage.replace(
    /(\+\d{1,3}\d{2,3})(\d{3,4})(\d{3,4})/g,
    '$1***$3'
  );

  // Pattern 4: Dots notation (already partially masked)
  // ...775722870 → ...775***870
  maskedMessage = maskedMessage.replace(
    /(\.\.\.[\d\s-]{3,4})(\d{3,4})(\d{3,4})/g,
    '$1***$3'
  );

  return maskedMessage;
}

/**
 * Create a logger wrapper that automatically masks phone numbers
 * @param {Object} originalLogger - Winston logger instance
 * @returns {Object} Wrapped logger with phone masking
 */
function createMaskedLogger(originalLogger) {
  return {
    info: (message, ...args) => {
      originalLogger.info(maskPhoneNumbers(message), ...args);
    },
    
    error: (message, ...args) => {
      originalLogger.error(maskPhoneNumbers(message), ...args);
    },
    
    warn: (message, ...args) => {
      originalLogger.warn(maskPhoneNumbers(message), ...args);
    },
    
    debug: (message, ...args) => {
      originalLogger.debug(maskPhoneNumbers(message), ...args);
    },

    // Pass through other methods
    log: (level, message, ...args) => {
      originalLogger.log(level, maskPhoneNumbers(message), ...args);
    }
  };
}

module.exports = {
  maskPhoneNumbers,
  createMaskedLogger
};length > 500) {
        truncatedObj = `[Object too large to log: ${str.length} chars]`;
      }
    }
    
    logger.log(level, message, { data: truncatedObj });
  }
};

module.exports = logger;