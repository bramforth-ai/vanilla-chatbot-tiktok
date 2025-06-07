// services/message-processor.js
const sessionManager = require('./session-manager');
const openaiService = require('./openai-service');
const toolsExecutor = require('./tools-executor');
const config = require('../config');
const logger = require('../utils/logger');
const Conversation = require('../models/conversation');

// Helper function (can be moved to a utils file if used elsewhere)
function formatPhoneToE164(phoneNumber) {
  if (!phoneNumber) return null;
  let formattedNumber = phoneNumber.replace('whatsapp:', '');
  if (!formattedNumber.startsWith('+')) {
    if (formattedNumber.startsWith('0')) {
      formattedNumber = '+44' + formattedNumber.substring(1);
    } else {
      if (!/^\d+$/.test(formattedNumber) || formattedNumber.length < 9) {
      } else {
        formattedNumber = '+44' + formattedNumber;
      }
    }
  }
  return formattedNumber.replace(/[\s\-\(\)]/g, '');
}

// ADDED: Simple phone masking function for privacy
function maskPhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') return '[INVALID_PHONE]';
  if (phone.length < 8) return '[SHORT_PHONE]';
  const cleaned = phone.replace(/[^\d+]/g, '');
  if (cleaned.length <= 9) return cleaned.substring(0, 2) + '***' + cleaned.slice(-2);
  return cleaned.substring(0, 5) + '***' + cleaned.slice(-4);
}

/**
 * Message Processor
 * Handles processing of incoming messages
 */
const messageProcessor = {
  /**
   * Process a message from WebSocket
   * @param {WebSocket} ws - WebSocket connection
   * @param {string} sessionId - Session ID
   * @param {string} message - User message
   * @returns {Promise<void>}
   */
  async processWebSocketMessage(ws, sessionId, message) {
    try {
      logger.info(`Processing WebSocket message from session ${sessionId}`);

      const thinkingTimer = this.setupThinkingIndicator(ws);

      try {
        let conversation = await sessionManager.getOrCreateConversation(sessionId);
        logger.info(`Initial conversation ID for session ${sessionId}: ${conversation._id}`);

        await sessionManager.addMessage(conversation._id, 'user', message, 'website');
        logger.info(`Added user message to conversation ${conversation._id}`);

        // Re-fetch conversation to ensure latest state
        conversation = await sessionManager.getConversationById(conversation._id);

        const userInfo = conversation.userInfo;
        let messageHistory = [];

        // IMPROVED: Simple summary + recent messages approach
        if (config.summary && config.summary.enabled && conversation.summary && conversation.summary.text) {
          logger.info(`Using summary + ${config.summary.recentMessageCount || 20} recent messages`);

          messageHistory.push({
            role: "system",
            content: `CONVERSATION SUMMARY: ${conversation.summary.text}\n\nThe above is a summary of previous messages. The following are the most recent messages.`
          });

          const recentMessages = conversation.messages
            .slice(-(config.summary.recentMessageCount || 20))
            .map(msg => ({ role: msg.role, content: msg.content }));
          messageHistory.push(...recentMessages);

        } else {
          const historyLimit = config.conversation.maxHistoryMessages || 10;
          messageHistory = conversation.messages
            .slice(-historyLimit)
            .map(msg => ({ role: msg.role, content: msg.content }));
        }

        let openaiResponse = await openaiService.processMessage(
          message,
          messageHistory,
          userInfo,
          conversation.previousResponseId,
          config.tools
        );

        const hasFunctionCalls = openaiResponse.output && openaiResponse.output.some(item => item.type === 'function_call');
        if (hasFunctionCalls) {
          openaiResponse = await openaiService.processFunctionCalls(
            openaiResponse,
            (functionCall, toolContext) => toolsExecutor.executeTool(functionCall, {
              conversationId: conversation._id,
              sessionId,
              userMessage: message,
              ...toolContext
            })
          );
        }

        const responseText = openaiService.extractResponseText(openaiResponse, 'website');
        clearTimeout(thinkingTimer);

        ws.send(JSON.stringify({
          type: 'chat_response',
          message: responseText || 'I performed an action but have no further response.',
          sessionId
        }));

        await sessionManager.addMessage(conversation._id, 'assistant', responseText || '', 'website');
        await sessionManager.updateResponseId(conversation._id, openaiResponse.id);

        logger.info(`Processed WebSocket message from session ${sessionId}`, {
          conversationId: conversation._id,
          responseLength: responseText ? responseText.length : 0,
          hadFunctionCalls: hasFunctionCalls,
          summaryUsed: !!(conversation.summary && conversation.summary.text)
        });

      } catch (error) {
        clearTimeout(thinkingTimer);
        ws.send(JSON.stringify({ type: 'error', message: 'I encountered an error processing your request. Please try again.' }));
        throw error;
      }
    } catch (error) {
      logger.error(`Error in processWebSocketMessage for session ${sessionId}:`, error);
    }
  },

  async processWhatsAppImageMessage(from, message, mediaItems) {
    try {
      const cleanPhoneNumber = formatPhoneToE164(from);
      if (!cleanPhoneNumber) {
        logger.error(`Invalid 'from' number for WhatsApp image message: ${maskPhoneNumber(from)}`);
        return 'There was an issue processing your sender information.';
      }
      logger.info(`Processing WhatsApp image message from ${maskPhoneNumber(cleanPhoneNumber)}`);

      const identifier = { type: 'whatsapp_phone', value: cleanPhoneNumber };

      let conversation = await sessionManager.getOrCreateConversationByIdentifier(identifier.type, identifier.value);
      logger.info(`Initial conversation ID for phone ending ***${cleanPhoneNumber.slice(-4)} (image): ${conversation._id}`);

      const mediaItem = mediaItems[0];
      const userMessageWithImage = `[Image sent]${message ? `: ${message}` : ''}`;
      await sessionManager.addMessage(conversation._id, 'user', userMessageWithImage, 'whatsapp', {
        mediaUrl: mediaItem.url,
        mediaContentType: mediaItem.contentType
      });
      logger.info(`Added user image message to conversation ${conversation._id}`);

      conversation = await sessionManager.getConversationById(conversation._id);

      const userInfo = conversation.userInfo;
      let messageHistory = [];

      // IMPROVED: Simple summary + recent messages approach
      if (config.summary && config.summary.enabled && conversation.summary && conversation.summary.text) {
        logger.info(`Using summary + ${config.summary.recentMessageCount || 20} recent messages`);

        messageHistory.push({
          role: "system",
          content: `CONVERSATION SUMMARY: ${conversation.summary.text}\n\nThe above is a summary of previous messages. The following are the most recent messages.`
        });

        const recentMessages = conversation.messages
          .slice(-(config.summary.recentMessageCount || 20))
          .map(msg => ({ role: msg.role, content: msg.content }));
        messageHistory.push(...recentMessages);

      } else {
        const historyLimit = config.conversation.maxHistoryMessages || 10;
        messageHistory = conversation.messages
          .slice(-historyLimit)
          .map(msg => ({ role: msg.role, content: msg.content }));
      }

      // ENHANCED: Process image with function calling capabilities
      let openaiResponse = await openaiService.processImageMessage(
        message,
        mediaItem.url,
        messageHistory,
        userInfo,
        conversation.previousResponseId,
        config.tools
      );

      // ENHANCED: Handle function calls in image responses (for technical support context)
      const hasFunctionCalls = openaiResponse.output && openaiResponse.output.some(item => item.type === 'function_call');
      if (hasFunctionCalls) {
        logger.info('Image message triggered function calls - processing...');

        openaiResponse = await openaiService.processFunctionCalls(
          openaiResponse,
          (functionCall, toolContext) => toolsExecutor.executeTool(functionCall, {
            conversationId: conversation._id,
            userMessage: message || '[Image analysis]',
            ...toolContext
          })
        );
      }

      const responseText = openaiService.extractResponseText(openaiResponse, 'whatsapp');
      await sessionManager.addMessage(conversation._id, 'assistant', responseText || '', 'whatsapp');
      await sessionManager.updateResponseId(conversation._id, openaiResponse.id);

      logger.info(`Processed WhatsApp image message for phone ending ***${cleanPhoneNumber.slice(-4)}`, {
        conversationId: conversation._id,
        responseLength: responseText ? responseText.length : 0,
        hadFunctionCalls: hasFunctionCalls,
        summaryUsed: !!(conversation.summary && conversation.summary.text)
      });

      return responseText || 'I processed your image but have no specific response.';
    } catch (error) {
      logger.error(`Error processing WhatsApp image message from ${maskPhoneNumber(from)}:`, error);
      return 'I encountered an error processing your image. Please try again.';
    }
  },

  async processWhatsAppMessage(from, message) {
    try {
      const cleanPhoneNumber = formatPhoneToE164(from);
      if (!cleanPhoneNumber) {
        logger.error(`Invalid 'from' number for WhatsApp message: ${maskPhoneNumber(from)}`);
        return 'There was an issue processing your sender information.';
      }
      logger.info(`Processing WhatsApp message from ${maskPhoneNumber(cleanPhoneNumber)} (text)`);

      const identifier = { type: 'whatsapp_phone', value: cleanPhoneNumber };

      let conversation = await sessionManager.getOrCreateConversationByIdentifier(identifier.type, identifier.value);
      logger.info(`Initial conversation ID for phone ending ***${cleanPhoneNumber.slice(-4)}: ${conversation._id}`);

      await sessionManager.addMessage(conversation._id, 'user', message, 'whatsapp');
      logger.info(`Added user message to conversation ${conversation._id}`);

      // ADDED: Auto-merge logic for cross-channel conversations
      try {
        const digits = cleanPhoneNumber.replace(/\D/g, '');
        const matchDigits = digits.slice(-9); // Last 9 digits for matching

        logger.info(`Auto-checking for existing conversations with phone ending: ***${matchDigits.slice(-4)}`);

        // Look for conversations with 'phone' identifiers (from WebSocket) that match
        const existingConversations = await Conversation.find({
          _id: { $ne: conversation._id },
          'identifiers': {
            $elemMatch: {
              'type': 'phone', // Look for WebSocket conversations with phone identifiers
              'value': { $regex: `${matchDigits}$` }
            }
          }
        });

        if (existingConversations.length > 0) {
          logger.info(`Auto-merge: Found ${existingConversations.length} existing conversations to merge`);

          // Import identification service locally to ensure it's available
          const identService = require('./identification-service');

          if (identService && identService.mergeConversations) {
            const mergeResult = await identService.mergeConversations(conversation._id, existingConversations);
            conversation = mergeResult.conversation; // Update conversation reference

            logger.info(`Auto-merged ${existingConversations.length} conversations with ${mergeResult.mergedMessages} messages`);
          } else {
            logger.error('Auto-merge: identificationService.mergeConversations not available');
          }
        }
      } catch (autoMergeError) {
        logger.error('Error in auto-merge process:', autoMergeError);
        // Continue processing even if auto-merge fails
      }

      conversation = await sessionManager.getConversationById(conversation._id);

      let userInfo = conversation.userInfo || {};

      // ADDED: Extract phone number from conversation identifiers if not in userInfo
      const phoneIdentifier = conversation.identifiers.find(id =>
        id.type === 'whatsapp_phone' || id.type === 'phone'
      );
      if (phoneIdentifier && !userInfo.phone) {
        userInfo = { ...userInfo, phone: phoneIdentifier.value };
      }

      // Professional logging - removed debug console.log
      logger.debug('UserInfo prepared for conversation processing', {
        hasPhone: !!userInfo.phone,
        hasName: !!(userInfo.firstName || userInfo.lastName),
        identifierCount: conversation.identifiers.length
      });

      let messageHistory = [];

      // IMPROVED: Simple summary + recent messages approach
      if (config.summary && config.summary.enabled && conversation.summary && conversation.summary.text) {
        logger.info(`Using summary + ${config.summary.recentMessageCount || 20} recent messages`);

        messageHistory.push({
          role: "system",
          content: `CONVERSATION SUMMARY: ${conversation.summary.text}\n\nThe above is a summary of previous messages. The following are the most recent messages.`
        });

        const recentMessages = conversation.messages
          .slice(-(config.summary.recentMessageCount || 20))
          .map(msg => ({ role: msg.role, content: msg.content }));
        messageHistory.push(...recentMessages);

      } else {
        const historyLimit = config.conversation.maxHistoryMessages || 10;
        messageHistory = conversation.messages
          .slice(-historyLimit)
          .map(msg => ({ role: msg.role, content: msg.content }));
      }

      let openaiResponse = await openaiService.processMessage(
        message,
        messageHistory,
        userInfo,
        conversation.previousResponseId,
        config.tools
      );

      const hasFunctionCalls = openaiResponse.output && openaiResponse.output.some(item => item.type === 'function_call');
      if (hasFunctionCalls) {
        openaiResponse = await openaiService.processFunctionCalls(
          openaiResponse,
          (functionCall, toolContext) => toolsExecutor.executeTool(functionCall, {
            conversationId: conversation._id,
            userMessage: message,
            ...toolContext
          })
        );
      }

      const responseText = openaiService.extractResponseText(openaiResponse, 'whatsapp');
      await sessionManager.addMessage(conversation._id, 'assistant', responseText || '', 'whatsapp');
      await sessionManager.updateResponseId(conversation._id, openaiResponse.id);

      logger.info(`Processed WhatsApp message for phone ending ***${cleanPhoneNumber.slice(-4)}`, {
        conversationId: conversation._id,
        responseLength: responseText ? responseText.length : 0,
        hadFunctionCalls: hasFunctionCalls,
        summaryUsed: !!(conversation.summary && conversation.summary.text)
      });

      return responseText || 'I processed your request but have no specific response.';
    } catch (error) {
      logger.error(`Error processing WhatsApp message from ${maskPhoneNumber(from)}:`, error);
      return 'I encountered an error processing your message. Please try again.';
    }
  },

  setupThinkingIndicator(ws) {
    ws.send(JSON.stringify({ type: 'thinking_started', message: 'Thinking...' }));
    return setTimeout(() => {
      ws.send(JSON.stringify({ type: 'thinking_update', message: 'Still thinking...' }));
    }, 3000);
  },
};

module.exports = messageProcessor;