// services/session-manager.js
const { v4: uuidv4 } = require('uuid');
const Conversation = require('../models/conversation');
const identificationService = require('./identification-service');
const logger = require('../utils/logger');

// In-memory session store for active WebSocket connections
const sessions = new Map();

/**
 * Session Manager
 * Handles WebSocket sessions and links them to conversations
 */
const sessionManager = {
  /**
   * Create a new session for a WebSocket connection
   * @param {WebSocket} ws - WebSocket connection
   * @returns {Object} Session object
   */
  createSession(ws) {
    const sessionId = uuidv4();
    const session = {
      id: sessionId,
      ws,
      createdAt: new Date(),
      identifierType: 'website_session',
      identifierValue: `session_${sessionId}`,
      conversationId: null
    };

    sessions.set(sessionId, session);
    logger.info(`Session created: ${sessionId}`);
    return session;
  },

  /**
   * Get a session by ID
   * @param {string} sessionId - Session ID
   * @returns {Object|null} Session object or null if not found
   */
  getSession(sessionId) {
    return sessions.get(sessionId) || null;
  },

  /**
   * Remove a session
   * @param {string} sessionId - Session ID
   */
  removeSession(sessionId) {
    sessions.delete(sessionId);
    logger.info(`Session removed: ${sessionId}`);
  },

  /**
   * Get or create a conversation for a session
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object>} Conversation document
   */
  async getOrCreateConversation(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // If the session already has a conversation, get it
    if (session.conversationId) {
      const existingConversation = await Conversation.findById(session.conversationId);
      if (existingConversation) {
        // Check if the conversation is marked as merged
        if (existingConversation.metadata.get('merged')) {
          // Redirect to the merged conversation
          const mergedIntoId = existingConversation.metadata.get('mergedInto');
          if (mergedIntoId) {
            const mergedConversation = await Conversation.findById(mergedIntoId);
            if (mergedConversation) {
              // Update session to point to the merged conversation
              session.conversationId = mergedConversation._id;
              logger.info(`Session ${sessionId} redirected to merged conversation: ${mergedIntoId}`);
              return mergedConversation;
            }
          }
        }
        return existingConversation;
      }
    }

    // Try to find an existing conversation for this identifier
    let conversation = await Conversation.findByIdentifier(
      session.identifierType,
      session.identifierValue
    );

    // If no conversation found, create a new one
    if (!conversation) {
      // ✅ FIXED: Properly define all required variables before using them
      let identificationState = {
        status: 'unidentified',
        method: 'none',
        confidence: 0
      };

      let identifierPriority = identificationService.PRIORITY.SESSION;
      let identifierVerified = false;

      // Set appropriate priority and verification based on identifier type
      if (session.identifierType === 'whatsapp_phone' || session.identifierType === 'phone') {
        identifierPriority = identificationService.PRIORITY.PHONE;
        // Phone numbers from WhatsApp are considered verified
        identifierVerified = session.identifierType === 'whatsapp_phone';
      }

      conversation = new Conversation({
        identifiers: [{
          type: session.identifierType,      
          value: session.identifierValue,     
          priority: identifierPriority,       
          verified: identifierVerified,        
          addedAt: new Date()
        }],
        channel: session.identifierType === 'whatsapp_phone' ? 'whatsapp' : 'website', 
        lastActivity: new Date(),
        identificationState                   
      });

      await conversation.save();
      logger.info(`New conversation created for ${session.identifierType}:${session.identifierValue}`); 
    }

    // Update session to reference this conversation
    session.conversationId = conversation._id;

    return conversation;
  },

  /**
   * Get or create a conversation by identifier (for WhatsApp)
   * @param {string} type - Identifier type (e.g., 'whatsapp_phone')
   * @param {string} value - Identifier value (e.g., phone number)
   * @returns {Promise<Object>} Conversation document
   */
  async getOrCreateConversationByIdentifier(type, value) {
    // Try to find an existing conversation
    let conversation = await Conversation.findByIdentifier(type, value);

    // If no conversation found, create a new one
    if (!conversation) {
      // For phone identifiers, attempt verification first
      let identificationState = {
        status: 'unidentified',
        method: 'none',
        confidence: 0
      };

      let identifierPriority = identificationService.PRIORITY.SESSION;
      let identifierVerified = false;

      // ✅ FIXED: Use 'type' parameter instead of 'session.identifierType'
      if (type === 'whatsapp_phone' || type === 'phone') {
        identifierPriority = identificationService.PRIORITY.PHONE;
        // Phone numbers from WhatsApp are considered verified
        identifierVerified = type === 'whatsapp_phone';
      }

      conversation = new Conversation({
        identifiers: [{
          type,
          value,
          priority: identifierPriority,
          verified: identifierVerified,
          addedAt: new Date()
        }],
        channel: type === 'whatsapp_phone' ? 'whatsapp' : 'website',
        lastActivity: new Date(),
        identificationState
      });

      await conversation.save();
      logger.info(`New conversation created for ${type}:${value}`);
    }

    return conversation;
  },

  /**
   * Process an identifier for a session
   * @param {string} sessionId - Session ID
   * @param {Object} identifier - Identifier object {type, value}
   * @returns {Promise<Object>} Result of identifier processing
   */
  async processIdentifier(sessionId, identifier) {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Get the conversation
    const conversation = await this.getOrCreateConversation(sessionId);

    // Process the identifier
    const result = await identificationService.processIdentifier(
      conversation._id,
      identifier
    );

    // If conversations were merged, update any sessions pointing to old conversations
    if (result.merged && result.mergedCount > 0) {
      // Get IDs of previous conversations that were merged and deleted
      const previousConversationIds = result.previousConversationIds;

      if (previousConversationIds && previousConversationIds.length > 0) {
        // Update sessions to point to the current conversation
        this.updateSessionsForMergedConversations(
          previousConversationIds,
          conversation._id.toString()
        );
      }
    }

    return result;
  },

  /**
   * Get a conversation by ID
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<Object>} Conversation document
   */
  async getConversationById(conversationId) {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    return conversation;
  },

  /**
   * Process an identifier without a session (for WhatsApp)
   * @param {string} conversationId - Conversation ID
   * @param {Object} identifier - Identifier object {type, value}
   * @returns {Promise<Object>} Result of identifier processing
   */
  async processIdentifierWithoutSession(conversationId, identifier) {
    // Process the identifier using the identification service
    const result = await identificationService.processIdentifier(
      conversationId,
      identifier
    );

    return result;
  },

  /**
   * Redirect all sessions from old conversations to a primary conversation
   * @param {string} primaryConversationId - ID of the primary conversation
   * @param {Array} oldConversationIds - IDs of old conversations
   * @returns {Promise<number>} Number of sessions updated
   */
  async redirectSessions(primaryConversationId, oldConversationIds) {
    let count = 0;

    // Check all active sessions
    for (const [sessionId, session] of sessions.entries()) {
      if (session.conversationId && oldConversationIds.includes(session.conversationId.toString())) {
        // Update this session to point to the primary conversation
        session.conversationId = primaryConversationId;
        count++;

        logger.info(`Redirected session ${sessionId} from old conversation to ${primaryConversationId}`);
      }
    }

    return count;
  },

  /**
   * Update all sessions pointing to old conversations
   * @param {Array} oldConversationIds - IDs of old conversations
   * @param {string} newConversationId - ID of the new conversation
   */
  updateSessionsForMergedConversations(oldConversationIds, newConversationId) {
    let updatedCount = 0;

    // Check all active sessions
    for (const [sessionId, session] of sessions.entries()) {
      if (session.conversationId && oldConversationIds.includes(session.conversationId.toString())) {
        // Update the session to point to the new conversation
        session.conversationId = newConversationId;
        updatedCount++;

        logger.info(`Updated session ${sessionId} to use merged conversation ${newConversationId}`);
      }
    }

    if (updatedCount > 0) {
      logger.info(`Updated ${updatedCount} sessions to use merged conversation ${newConversationId}`);
    }

    return updatedCount;
  },

  /**
   * Add a message to a conversation
   * @param {string} conversationId - Conversation ID
   * @param {string} role - Message role ('user' or 'assistant')
   * @param {string} content - Message content
   * @param {string} channel - Message channel ('whatsapp' or 'website')
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<Object>} Updated conversation
   */
  async addMessage(conversationId, role, content, channel, metadata = {}) {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    // For user messages, check for potential identifiers
    if (role === 'user') {
      // Check for potential identifiers in the message
      const potentialIds = identificationService.extractPotentialIdentifiers(content);

      // Process each potential identifier
      for (const identifier of potentialIds) {
        try {
          // Only process high-confidence identifiers automatically
          if (identifier.confidence >= 0.7) {
            await identificationService.processIdentifier(
              conversationId,
              identifier,
              false // don't attempt verification - this is the key change
            );
          }
        } catch (error) {
          logger.error(`Error processing potential identifier:`, error);
        }
      }
    }

    return conversation.addMessage(role, content, channel, metadata);
  },

  /**
   * Update conversation with OpenAI response ID
   * @param {string} conversationId - Conversation ID
   * @param {string} responseId - OpenAI response ID
   * @returns {Promise<Object>} Updated conversation
   */
  async updateResponseId(conversationId, responseId) {
    return Conversation.findByIdAndUpdate(
      conversationId,
      { previousResponseId: responseId },
      { new: true }
    );
  },

  /**
   * Update conversation with user info
   * @param {string} conversationId - Conversation ID
   * @param {Object} userInfo - User information
   * @returns {Promise<Object>} Updated conversation
   */
  async updateUserInfo(conversationId, userInfo) {
    // Update the conversation with user info
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    // Update user info
    conversation.userInfo = {
      ...userInfo,
      lastUpdated: new Date()
    };

    // If we have a userId, add it as an identifier
    if (userInfo.userId) {
      conversation.addIdentifier(
        'user_id',
        userInfo.userId.toString(),
        identificationService.PRIORITY.USER_ID,
        true // verified
      );

      // Update identification state
      conversation.updateIdentificationState(
        'identified',
        'user_id',
        1.0 // Full confidence
      );
    }

    // If we have a phone, add it as an identifier
    if (userInfo.phone) {
      conversation.addIdentifier(
        'phone',
        userInfo.phone,
        identificationService.PRIORITY.PHONE,
        true // verified
      );
    }

    return conversation.save();
  },

  /**
   * Get all sessions
   * @returns {Array} Array of session objects
   */
  getAllSessions() {
    return Array.from(sessions.values());
  },

  /**
   * Get conversation history formatted for OpenAI
   * @param {string} conversationId - Conversation ID
   * @param {number} limit - Maximum number of messages to include
   * @returns {Promise<Array>} Messages formatted for OpenAI
   */
  async getConversationHistoryForAI(conversationId, limit = 10) {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    // Get recent messages
    const recentMessages = conversation.messages
      .slice(-limit)
      .map(msg => ({
        role: msg.role,
        content: msg.content
      }));

    return recentMessages;
  },

  // Add this method to services/session-manager.js
  /**
   * Process an identifier and consolidate conversations if needed
   * @param {string} sessionId - Session ID
   * @param {Object} identifier - Identifier object
   * @returns {Promise<Object>} Result of processing
   */
  async processIdentifierAndConsolidate(sessionId, identifier) {
    try {
      // First, process the identifier
      const conversation = await this.getOrCreateConversation(sessionId);

      // Process the identifier
      const result = await identificationService.processIdentifier(
        conversation._id,
        identifier
      );

      // If conversations were merged, update session
      if (result.merged && result.mergedCount > 0) {
        const updatedConversation = await this.getConversationById(conversation._id);
        return {
          success: true,
          merged: true,
          mergedCount: result.mergedCount,
          conversation: updatedConversation
        };
      }

      return {
        success: true,
        merged: false,
        conversation
      };
    } catch (error) {
      logger.error(`Error processing identifier and consolidating:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
 * Update conversation metadata
 * @param {string} conversationId - ID of the conversation
 * @param {Object} metadata - Metadata to update
 * @returns {Promise<void>}
 */
  async updateConversationMetadata(conversationId, metadata) {
    try {
      const conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        throw new Error(`Conversation ${conversationId} not found`);
      }

      // Initialize metadata field if it doesn't exist
      if (!conversation.metadata) {
        conversation.metadata = new Map();
      }

      // Update with new metadata
      for (const [key, value] of Object.entries(metadata)) {
        conversation.metadata.set(key, value);
      }

      await conversation.save();
      logger.info(`Updated metadata for conversation ${conversationId}`);
    } catch (error) {
      logger.error(`Error updating metadata for conversation ${conversationId}:`, error);
      throw error;
    }
  },

  /**
   * Assess if identification is needed for a conversation
   * @param {string} conversationId - Conversation ID
   * @param {string} userMessage - Current user message
   * @returns {Promise<Object>} Assessment result
   */
  async assessIdentificationNeeds(conversationId, userMessage) {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    return identificationService.assessIdentificationNeeds(conversation, userMessage);
  }
};

module.exports = sessionManager;