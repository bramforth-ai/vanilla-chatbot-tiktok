// models/conversation.js
const mongoose = require('mongoose');
const logger = require('../utils/logger');

// Schema for individual messages in a conversation
const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'assistant'],
    required: true
  },
  content: {
    type: String,
    default: ''
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  channel: {
    type: String,
    enum: ['whatsapp', 'website'],
    required: true
  },
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: () => new Map()
  }
});

// Schema for identifiers (ways to identify a user)
const identifierSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['whatsapp_phone', 'website_session', 'user_id', 'phone', 'email'],
    required: true
  },
  value: {
    type: String,
    required: true
  },
  // New fields to track when this identifier was added and verified
  addedAt: {
    type: Date,
    default: Date.now
  },
  verified: {
    type: Boolean,
    default: false
  },
  verifiedAt: Date,
  // Priority determines which identifier takes precedence (higher = more reliable)
  priority: {
    type: Number,
    default: 0
  }
});

// Schema for user information (generalized from clientInfo)
const userInfoSchema = new mongoose.Schema({
  userId: String,
  firstName: String,
  lastName: String,
  email: String,
  phone: String,
  // Add when this information was last updated
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  // Generic field for additional user data
  additionalInfo: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: () => new Map()
  }
});

// Schema for conversation summary
const summarySchema = new mongoose.Schema({
  text: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date
  },
  lastMessageId: {
    type: String,
    default: null
  },
  messageCount: {
    type: Number,
    default: 0
  },
  modelUsed: {
    type: String,
    default: null
  }
});

// Main conversation schema
const conversationSchema = new mongoose.Schema({
  identifiers: {
    type: [identifierSchema],
    required: true,
    validate: [arr => arr.length > 0, 'At least one identifier is required']
  },
  userInfo: userInfoSchema, // Renamed from clientInfo to be more generic
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  lastActivity: {
    type: Date,
    default: Date.now
  },
  messages: {
    type: [messageSchema],
    default: []
  },
  previousResponseId: String,
  channel: {
    type: String,
    enum: ['whatsapp', 'website'],
    required: true
  },
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: () => new Map()
  },
  // Identification state tracking
  identificationState: {
    status: {
      type: String,
      enum: ['unidentified', 'partial', 'identified'],
      default: 'unidentified'
    },
    method: {
      type: String,
      enum: ['none', 'phone', 'name', 'email', 'user_id', 'whatsapp_phone'],
      default: 'none'
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0
    },
    verifiedAt: Date,
    lastAttemptAt: Date
  },
  // Summary field
  summary: {
    type: summarySchema,
    default: null
  }
}, {
  timestamps: true
});

// Add diagnostic hooks
conversationSchema.pre('validate', function(next) {
  logger.info(`Pre-validate conversation: ${this._id || 'new'}, identifiers: ${JSON.stringify(this.identifiers)}`);
  next();
});

conversationSchema.post('validate', function(doc) {
  logger.info(`Post-validate conversation: ${doc._id || 'new'}`);
});

conversationSchema.pre('save', function(next) {
  logger.info(`Pre-save conversation: ${this._id || 'new'}, message count: ${this.messages.length}`);
  next();
});

conversationSchema.post('save', function(doc) {
  logger.info(`Post-save conversation: ${doc._id}, message count: ${doc.messages.length}`);
});

// Add error handlers for mongoose operations
conversationSchema.post('save', function(error, doc, next) {
  if (error) {
    logger.error(`Error saving conversation: ${error}`, error);
  }
  next(error);
});

// Indexes for efficient querying
conversationSchema.index({ 'identifiers.type': 1, 'identifiers.value': 1 });
conversationSchema.index({ lastActivity: -1 });
conversationSchema.index({ 'userInfo.userId': 1 });
// Add index for identification status to quickly find conversations that need identification
conversationSchema.index({ 'identificationState.status': 1 });

// Static method to find conversation by identifier
conversationSchema.statics.findByIdentifier = function(type, value) {
  logger.info(`Finding conversation by identifier: ${type}:${value}`);
  return this.findOne({
    'identifiers': {
      $elemMatch: {
        'type': type,
        'value': value
      }
    }
  });
};

// Static method to find conversations by multiple identifiers
conversationSchema.statics.findByIdentifiers = function(identifiers) {
  logger.info(`Finding conversations by multiple identifiers: ${JSON.stringify(identifiers)}`);
  return this.find({
    'identifiers': {
      $elemMatch: {
        $or: identifiers.map(id => ({
          'type': id.type,
          'value': id.value
        }))
      }
    }
  });
};

// Method to add a message to a conversation
conversationSchema.methods.addMessage = function(role, content, channel, metadata = {}) {
  logger.info(`Adding message to conversation ${this._id}: ${role}, ${channel}, content length: ${content.length}`);
  this.messages.push({
    role,
    content,
    timestamp: new Date(),
    channel,
    metadata
  });
  this.lastUpdated = new Date();
  this.lastActivity = new Date();
  return this.save();
};

// Method to get recent messages
conversationSchema.methods.getRecentMessages = function(limit = 10) {
  return this.messages.slice(-limit);
};

// Method to add an identifier to a conversation
conversationSchema.methods.addIdentifier = function(type, value, priority = 0, verified = false) {
  // Check if identifier already exists
  const existingIdentifier = this.identifiers.find(id => id.type === type && id.value === value);
  
  if (existingIdentifier) {
    // Update existing identifier if needed
    if (priority > existingIdentifier.priority) {
      existingIdentifier.priority = priority;
    }
    if (verified && !existingIdentifier.verified) {
      existingIdentifier.verified = true;
      existingIdentifier.verifiedAt = new Date();
    }
  } else {
    // Add new identifier
    const newIdentifier = {
      type,
      value,
      priority,
      verified,
      addedAt: new Date()
    };
    
    if (verified) {
      newIdentifier.verifiedAt = new Date();
    }
    
    this.identifiers.push(newIdentifier);
  }
  
  this.lastUpdated = new Date();
  return this;
};

// Method to update identification state
conversationSchema.methods.updateIdentificationState = function(status, method, confidence = 0) {
  this.identificationState.status = status;
  this.identificationState.method = method;
  this.identificationState.confidence = confidence;
  this.identificationState.lastAttemptAt = new Date();
  
  if (status === 'identified') {
    this.identificationState.verifiedAt = new Date();
  }
  
  this.lastUpdated = new Date();
  return this;
};

// Method to get primary identifier
conversationSchema.methods.getPrimaryIdentifier = function() {
  if (!this.identifiers || this.identifiers.length === 0) {
    return null;
  }
  
  // Sort by priority (descending) and return the highest
  return [...this.identifiers].sort((a, b) => b.priority - a.priority)[0];
};

// Create the model
const Conversation = mongoose.model('Conversation', conversationSchema);

module.exports = Conversation;