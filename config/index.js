// config/index.js
require('dotenv').config();
const prompts = require('./prompts');
const tools = require('./tools');

// Configuration object
const config = {
  // Server configuration
  port: process.env.PORT || 5000,
  environment: process.env.NODE_ENV || 'development',

  // MongoDB configuration
  mongodb: {
    // Parse and modify the URI to use the correct database name
    get uri() {
      let connectionUri = process.env.MONGODB_URI;
      const dbName = process.env.MONGODB_DATABASE_NAME || 'vanilla_chatbot';

      // Remove any existing database name from the URI
      if (connectionUri) {
        // Check if URI has a database name
        const hasDbName = /\/[^/?]+(\?|$)/.test(connectionUri);
        if (hasDbName) {
          // Replace existing database name
          connectionUri = connectionUri.replace(/\/([^/?]+)(\?|$)/, `/${dbName}$2`);
        } else {
          // Add database name before query parameters
          connectionUri = connectionUri.includes('?')
            ? connectionUri.replace('?', `/${dbName}?`)
            : `${connectionUri}/${dbName}`;
        }
      }

      return connectionUri;
    },
    databaseName: process.env.MONGODB_DATABASE_NAME || 'vanilla_chatbot',
    // Add knowledge collection configuration
    knowledgeCollection: process.env.MONGODB_KNOWLEDGE_COLLECTION || 'knowledge_items',
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true
    }
  },

  // Twilio configuration
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER,

    // Add base URL for webhook validation (used in production)
    baseUrl: process.env.BASE_URL || 'https://your-server-url.com'
  },

  // OpenAI configuration
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    // Ensure we're using a vision-capable model
    model: process.env.OPENAI_MODEL || 'gpt-4.1-nano-2025-04-14', // Vision-capable model 
    summaryModel: process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini-2024-07-18'
  },

  // Conversation history configuration
  conversation: {
    maxHistoryMessages: 10 // Default number of messages to include in history
  },

  // New summary configuration
  summary: {
    minMessageCount: parseInt(process.env.SUMMARY_MIN_MESSAGE_COUNT || '5', 10),
    maxLength: parseInt(process.env.SUMMARY_MAX_LENGTH || '500', 10),
    recentMessageCount: parseInt(process.env.SUMMARY_RECENT_MESSAGE_COUNT || '20', 10), // NEW
    enabled: process.env.ENABLE_SUMMARIES !== 'false' // Enable by default unless explicitly disabled
  },

  // System prompts and tools
  prompts,
  tools
};

// Validate essential configuration
function validateConfig() {
  const requiredVars = [
    'MONGODB_URI',
    'MONGODB_DATABASE_NAME',
    'OPENAI_API_KEY'
  ];

  const missing = requiredVars.filter(varName => !process.env[varName]);

  if (missing.length > 0) {
    console.warn(`Warning: Missing environment variables: ${missing.join(', ')}`);
    console.warn('Some functionality may not work correctly.');
  }
}

validateConfig();

module.exports = config;