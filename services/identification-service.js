// services/identification-service.js
const Conversation = require('../models/conversation');
const logger = require('../utils/logger');
const summaryService = require('./summary-service');
const config = require('../config');

/**
 * Extract and normalize phone numbers from text
 * @param {string} text - Text to search for phone numbers
 * @returns {Array} Array of normalized phone numbers found
 */
function extractPhoneNumbers(text) {
  if (!text || typeof text !== 'string') return [];
  
  const phoneNumbers = [];
  
  // More comprehensive international phone regex
  const patterns = [
    // International format: +1234567890, +44 1234 567890, etc.
    /\+\d{1,3}[\s\-\.]?\d{1,4}[\s\-\.]?\d{1,4}[\s\-\.]?\d{1,4}[\s\-\.]?\d{0,4}/g,
    // UK format: 07123456789, 01234 567890
    /0\d{10,11}|\b0\d{4}\s?\d{6,7}\b/g,
    // US format: (123) 456-7890, 123-456-7890, 123.456.7890
    /\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]?\d{4}/g,
    // Generic: any sequence of 7-15 digits with optional separators
    /\b\d{1,4}[\s\-\.]?\d{1,4}[\s\-\.]?\d{1,4}[\s\-\.]?\d{1,4}\b/g
  ];
  
  patterns.forEach(pattern => {
    const matches = text.match(pattern) || [];
    matches.forEach(match => {
      const normalized = normalizePhoneNumber(match);
      if (normalized && normalized.length >= 7) { // Minimum viable phone number length
        phoneNumbers.push(normalized);
      }
    });
  });
  
  // Remove duplicates
  return [...new Set(phoneNumbers)];
}

/**
 * Normalize phone number - international friendly
 * @param {string} phone - Raw phone number
 * @returns {string} Normalized phone number
 */
function normalizePhoneNumber(phone) {
  if (!phone) return '';
  
  // Remove all non-digit characters except +
  let cleaned = phone.replace(/[^\d+]/g, '');
  
  // If it starts with +, keep it as international
  if (cleaned.startsWith('+')) {
    return cleaned;
  }
  
  // For numbers without country code, we can't reliably add one
  // So we'll store them as-is and match against variations
  return cleaned;
}

/**
 * Generate phone number variations for matching
 * @param {string} phone - Phone number to generate variations for
 * @returns {Array} Array of possible variations
 */
function generatePhoneVariations(phone) {
  const variations = [phone];
  const cleaned = phone.replace(/[^\d]/g, '');
  
  // Add cleaned version
  if (cleaned !== phone) {
    variations.push(cleaned);
  }
  
  // If no country code, try common prefixes for the number length
  if (!phone.startsWith('+')) {
    // UK variations
    if (cleaned.startsWith('0') && cleaned.length === 11) {
      variations.push('+44' + cleaned.substring(1));
    }
    // US variations  
    if (cleaned.length === 10) {
      variations.push('+1' + cleaned);
    }
    // Add other common country codes as needed
  }
  
  // If has country code, also add version without it
  if (phone.startsWith('+44') && phone.length > 3) {
    variations.push('0' + phone.substring(3));
  }
  if (phone.startsWith('+1') && phone.length > 2) {
    variations.push(phone.substring(2));
  }
  
  return [...new Set(variations)];
}

/**
 * Find conversations that match any phone number variation
 * @param {Array} phoneNumbers - Array of phone numbers to search for
 * @param {string} excludeConversationId - Conversation ID to exclude from results
 * @returns {Promise<Array>} Array of matching conversations
 */
async function findConversationsByPhones(phoneNumbers, excludeConversationId = null) {
  if (!phoneNumbers || phoneNumbers.length === 0) return [];
  
  // Generate all possible variations
  const allVariations = [];
  phoneNumbers.forEach(phone => {
    allVariations.push(...generatePhoneVariations(phone));
  });
  
  logger.info(`Searching for conversations with phone variations:`, allVariations.slice(0, 5)); // Log first 5 to avoid spam
  
  // Build query for all variations
  const phoneConditions = [];
  allVariations.forEach(variation => {
    phoneConditions.push(
      { 'identifiers': { $elemMatch: { 'type': 'whatsapp_phone', 'value': variation } } },
      { 'identifiers': { $elemMatch: { 'type': 'phone', 'value': variation } } }
    );
  });
  
  const query = { $or: phoneConditions };
  if (excludeConversationId) {
    query._id = { $ne: excludeConversationId };
  }
  
  return await Conversation.find(query);
}

/**
 * Simplified identification service - phone numbers only
 */
const identificationService = {
  /**
   * Process a message and check for phone numbers to merge conversations
   * @param {string} conversationId - Current conversation ID
   * @param {string} message - User message to analyze
   * @returns {Promise<Object>} Result of processing
   */
  async processMessageForIdentification(conversationId, message) {
    try {
      logger.info(`Processing message for phone identification: ${conversationId}`);
      
      // Extract phone numbers from message
      const phoneNumbers = extractPhoneNumbers(message);
      
      if (phoneNumbers.length === 0) {
        logger.info('No phone numbers found in message');
        return { merged: false, phoneNumbers: [] };
      }
      
      logger.info(`Found potential phone numbers:`, phoneNumbers);
      
      // Find matching conversations
      const matchingConversations = await findConversationsByPhones(phoneNumbers, conversationId);
      
      if (matchingConversations.length === 0) {
        logger.info('No matching conversations found for phone numbers');
        
        // Add phone numbers as identifiers to current conversation
        const currentConversation = await Conversation.findById(conversationId);
        if (currentConversation) {
          phoneNumbers.forEach(phone => {
            currentConversation.addIdentifier('phone', phone, 70, false);
          });
          await currentConversation.save();
          logger.info(`Added phone identifiers to conversation ${conversationId}`);
        }
        
        return { merged: false, phoneNumbers, addedIdentifiers: true };
      }
      
      logger.info(`Found ${matchingConversations.length} conversations to merge`);
      
      // Merge conversations
      const result = await this.mergeConversations(conversationId, matchingConversations);
      
      return {
        merged: true,
        phoneNumbers,
        mergedCount: matchingConversations.length,
        conversation: result.conversation
      };
      
    } catch (error) {
      logger.error('Error processing message for identification:', error);
      return { merged: false, error: error.message };
    }
  },
  
  /**
   * Merge multiple conversations into one
   * @param {string} primaryConversationId - ID of conversation to keep
   * @param {Array} conversationsToMerge - Conversations to merge into primary
   * @returns {Promise<Object>} Merge result
   */
  async mergeConversations(primaryConversationId, conversationsToMerge) {
    try {
      const primaryConversation = await Conversation.findById(primaryConversationId);
      if (!primaryConversation) {
        throw new Error(`Primary conversation ${primaryConversationId} not found`);
      }
      
      logger.info(`Merging ${conversationsToMerge.length} conversations into ${primaryConversationId}`);
      
      const allMessages = [...primaryConversation.messages];
      const allIdentifiers = [...primaryConversation.identifiers];
      let totalMergedMessages = 0;
      
      // Process each conversation to merge
      for (const conversation of conversationsToMerge) {
        logger.info(`Merging conversation ${conversation._id} with ${conversation.messages.length} messages`);
        
        // Add messages
        if (conversation.messages && conversation.messages.length > 0) {
          allMessages.push(...conversation.messages);
          totalMergedMessages += conversation.messages.length;
        }
        
        // Add unique identifiers
        if (conversation.identifiers && conversation.identifiers.length > 0) {
          conversation.identifiers.forEach(identifier => {
            const exists = allIdentifiers.some(
              id => id.type === identifier.type && id.value === identifier.value
            );
            if (!exists) {
              allIdentifiers.push(identifier);
            }
          });
        }
        
        // Use better user info if available
        if (conversation.userInfo && conversation.userInfo.userId &&
            (!primaryConversation.userInfo || !primaryConversation.userInfo.userId)) {
          primaryConversation.userInfo = conversation.userInfo;
        }
      }
      
      // Sort messages by timestamp
      allMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
      // Update primary conversation
      primaryConversation.messages = allMessages;
      primaryConversation.identifiers = allIdentifiers;
      primaryConversation.lastUpdated = new Date();
      
      logger.info(`Merged conversation now has ${allMessages.length} total messages`);
      
      // Generate summary if enabled and we have enough messages
      if (config.summary && config.summary.enabled && allMessages.length >= (config.summary.minMessageCount || 5)) {
        try {
          logger.info('Generating summary for merged conversation');
          const generatedSummary = await summaryService.generateSummary(primaryConversation);
          if (generatedSummary) {
            primaryConversation.summary = generatedSummary;
            logger.info(`Added summary to merged conversation`);
          }
        } catch (summaryError) {
          logger.error('Error generating summary for merged conversation:', summaryError);
        }
      }
      
      // Save updated primary conversation
      await primaryConversation.save();
      
      // Delete merged conversations
      const idsToDelete = conversationsToMerge.map(conv => conv._id);
      await Conversation.deleteMany({ _id: { $in: idsToDelete } });
      logger.info(`Deleted ${idsToDelete.length} merged conversations`);
      
      return {
        conversation: primaryConversation,
        mergedCount: conversationsToMerge.length,
        mergedMessages: totalMergedMessages
      };
      
    } catch (error) {
      logger.error('Error merging conversations:', error);
      throw error;
    }
  },
  
  /**
   * Check if a conversation needs phone number identification
   * @param {Object} conversation - Conversation object
   * @returns {boolean} Whether identification is needed
   */
  needsPhoneIdentification(conversation) {
    if (!conversation || !conversation.identifiers) return false;
    
    // Check if we already have a phone identifier
    const hasPhoneIdentifier = conversation.identifiers.some(
      id => id.type === 'phone' || id.type === 'whatsapp_phone'
    );
    
    // If website session without phone identifier, we might want to ask
    const isWebsiteSession = conversation.identifiers.some(
      id => id.type === 'website_session'
    );
    
    return isWebsiteSession && !hasPhoneIdentifier && conversation.messages.length >= 3;
  }
};

// Add this to the bottom of services/identification-service.js, before module.exports

// Compatibility layer for session-manager.js
identificationService.PRIORITY = {
  SESSION: 10,
  PHONE: 70,
  USER_ID: 90,
  EMAIL: 60,
  NAME: 30
};

/**
 * Stub method for compatibility with session-manager.js
 * @param {string} text - Text to extract identifiers from
 * @returns {Array} Empty array (we don't need this functionality)
 */
identificationService.extractPotentialIdentifiers = function(text) {
  // Return empty array - we handle identification through the tool now
  return [];
};

/**
 * Stub method for compatibility with session-manager.js
 * @param {string} conversationId - Conversation ID
 * @param {Object} identifier - Identifier object
 * @param {boolean} attemptVerification - Whether to verify
 * @returns {Promise<Object>} Basic result object
 */
identificationService.processIdentifier = async function(conversationId, identifier, attemptVerification = false) {
  logger.info(`[Compatibility] processIdentifier called for ${conversationId} with ${identifier.type}:${identifier.value}`);
  
  // Just return a basic success result - real identification happens through the tool
  return {
    success: true,
    merged: false,
    conversation: await Conversation.findById(conversationId)
  };
};

/**
 * Stub method for compatibility with session-manager.js
 * @param {Object} conversation - Conversation object
 * @param {string} userMessage - User message
 * @returns {Promise<Object>} Assessment result
 */
identificationService.assessIdentificationNeeds = async function(conversation, userMessage) {
  logger.info(`[Compatibility] assessIdentificationNeeds called for conversation ${conversation._id}`);
  
  // Return that no identification is needed - the AI will handle this via the tool
  return {
    needed: false,
    reason: 'tool_based_identification',
    potentialIdentifiers: []
  };
};

module.exports = identificationService;