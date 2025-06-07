// utils/logger.js
const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Phone masking utility
function maskPhoneNumbers(message) {
  if (!message || typeof message !== 'string') {
    return message;
  }

  let masked = message;
  
  // UK numbers: +447775722870 → +44777***2870
  masked = masked.replace(/(\+44\d{3})(\d{3,4})(\d{3,4})/g, '$1***$3');
  
  // WhatsApp: whatsapp:+447775722870 → whatsapp:+44777***2870  
  masked = masked.replace(/(whatsapp:\+44\d{3})(\d{3,4})(\d{3,4})/g, '$1***$3');
  
  // Other international: +1234567890 → +1234***890
  masked = masked.replace(/(\+\d{1,3}\d{2,3})(\d{3,4})(\d{3,4})/g, '$1***$3');
  
  // Dots notation: ...775722870 → ...775***870
  masked = masked.replace(/(\.\.\.[\d\s-]{3,4})(\d{3,4})(\d{3,4})/g, '$1***$3');
  
  return masked;
}

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

// Phone masking format
const phoneMaskingFormat = winston.format((info) => {
  if (info.message) {
    info.message = maskPhoneNumbers(info.message);
  }
  return info;
})();

// Configure logger
const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    phoneMaskingFormat,    // 🔒 ADD PHONE MASKING HERE
    logFilter,
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'vanilla-chatbot' },
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
      if (str.length > 500) {
        truncatedObj = `[Object too large to log: ${str.length} chars]`;
      }
    }
    
    logger.log(level, message, { data: truncatedObj });
  }
};

module.exports = logger;