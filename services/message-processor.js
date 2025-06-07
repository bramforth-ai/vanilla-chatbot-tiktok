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

        if (config.summary && config.summary.enabled && conversation.summary && conversation.summary.text) {
          logger.info(`Using summary for WebSocket conversation ${conversation._id} (msgs: ${conversation.summary.messageCount}, lastId: ${conversation.summary.lastMessageId})`);
          messageHistory.push({
            role: "system",
            content: `CONVERSATION SUMMARY: ${conversation.summary.text}\n\nThe above is a summary of previous messages.`
          });
          if (conversation.summary.lastMessageId) {
            const lastSummarizedId = conversation.summary.lastMessageId;
            let lastMessageIndex = -1;
            for (let i = 0; i < conversation.messages.length; i++) {
              if (conversation.messages[i]._id.toString() === lastSummarizedId) {
                lastMessageIndex = i;
                break;
              }
            }
            if (lastMessageIndex >= 0) {
              const recentMessages = conversation.messages.slice(lastMessageIndex + 1).map(msg => ({ role: msg.role, content: msg.content }));
              messageHistory.push(...recentMessages);
              logger.info(`Added ${recentMessages.length} WebSocket messages after summary to history.`);
            } else {
              logger.warn(`Summary lastMessageId ${lastSummarizedId} not found in WebSocket conversation ${conversation._id}. History might be incomplete.`);
              if (conversation.messages.length > 0 && messageHistory.length > 0) {
                const lastConvMsg = conversation.messages[conversation.messages.length - 1];
                if (lastConvMsg.role === 'user' && lastConvMsg.content === message) {
                  const lastHistoryMsg = messageHistory[messageHistory.length - 1];
                  if (!(lastHistoryMsg.role === 'user' && lastHistoryMsg.content === message)) {
                    messageHistory.push({ role: 'user', content: message });
                  }
                }
              }
            }
          } else {
            logger.warn(`Summary text exists for WebSocket ${conversation._id} but no lastMessageId.`);
            if (conversation.messages.length > 0 && messageHistory.length > 0) {
              const lastConvMsg = conversation.messages[conversation.messages.length - 1];
              if (lastConvMsg.role === 'user' && lastConvMsg.content === message) {
                messageHistory.push({ role: 'user', content: message });
              }
            }
          }
        } else {
          const historyLimit = config.conversation.maxHistoryMessages || 10;
          messageHistory = conversation.messages
            .slice(-historyLimit)
            .map(msg => ({ role: msg.role, content: msg.content }));
          logger.info(`Using latest ${messageHistory.length} WebSocket messages as no summary found/enabled.`);
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
        logger.error(`Invalid 'from' number for WhatsApp image message: ${from}`);
        return 'There was an issue processing your sender information.';
      }
      logger.info(`Processing WhatsApp image message from ${cleanPhoneNumber}`);

      const identifier = { type: 'whatsapp_phone', value: cleanPhoneNumber };

      let conversation = await sessionManager.getOrCreateConversationByIdentifier(identifier.type, identifier.value);
      logger.info(`Initial conversation ID for ${cleanPhoneNumber} (image): ${conversation._id}`);

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

      if (config.summary && config.summary.enabled && conversation.summary && conversation.summary.text) {
        logger.info(`Using summary for WhatsApp conversation ${conversation._id} (image, msgs: ${conversation.summary.messageCount}, lastId: ${conversation.summary.lastMessageId})`);
        messageHistory.push({
          role: "system",
          content: `CONVERSATION SUMMARY: ${conversation.summary.text}\n\nThe above is a summary of previous messages.`
        });
        if (conversation.summary.lastMessageId) {
          const lastSummarizedId = conversation.summary.lastMessageId;
          let lastMessageIndex = -1;
          for (let i = 0; i < conversation.messages.length; i++) {
            if (conversation.messages[i]._id.toString() === lastSummarizedId) {
              lastMessageIndex = i;
              break;
            }
          }
          if (lastMessageIndex >= 0) {
            const recentMessages = conversation.messages.slice(lastMessageIndex + 1).map(msg => ({ role: msg.role, content: msg.content }));
            messageHistory.push(...recentMessages);
            logger.info(`Added ${recentMessages.length} WhatsApp messages after summary to history (image).`);
          } else {
            logger.warn(`Summary lastMessageId ${lastSummarizedId} not found in WhatsApp conversation ${conversation._id} (image).`);
            if (conversation.messages.length > 0 && messageHistory.length > 0) {
              const lastConvMsg = conversation.messages[conversation.messages.length - 1];
              const lastHistoryMsg = messageHistory[messageHistory.length - 1];
              if (!(lastHistoryMsg.role === 'user' && lastHistoryMsg.content === lastConvMsg.content)) {
                messageHistory.push({ role: lastConvMsg.role, content: lastConvMsg.content });
              }
            }
          }
        } else {
          logger.warn(`Summary text exists for WhatsApp ${conversation._id} (image) but no lastMessageId.`);
          if (conversation.messages.length > 0 && messageHistory.length > 0) {
            const lastConvMsg = conversation.messages[conversation.messages.length - 1];
            messageHistory.push({ role: lastConvMsg.role, content: lastConvMsg.content });
          }
        }
      } else {
        const historyLimit = config.conversation.maxHistoryMessages || 10;
        messageHistory = conversation.messages.slice(-historyLimit).map(msg => ({ role: msg.role, content: msg.content }));
        logger.info(`Using latest ${messageHistory.length} WhatsApp messages (image) as no summary found/enabled.`);
      }

      const openaiResponse = await openaiService.processImageMessage(
        message,
        mediaItem.url,
        messageHistory,
        userInfo,
        conversation.previousResponseId,
        config.tools
      );

      const responseText = openaiService.extractResponseText(openaiResponse, 'whatsapp');
      await sessionManager.addMessage(conversation._id, 'assistant', responseText || '', 'whatsapp');
      await sessionManager.updateResponseId(conversation._id, openaiResponse.id);

      logger.info(`Processed WhatsApp image message for ${cleanPhoneNumber}`, {
        conversationId: conversation._id,
        responseLength: responseText ? responseText.length : 0,
        summaryUsed: !!(conversation.summary && conversation.summary.text)
      });

      return responseText || 'I processed your image but have no specific response.';
    } catch (error) {
      logger.error(`Error processing WhatsApp image message from ${from}:`, error);
      return 'I encountered an error processing your image. Please try again.';
    }
  },

  async processWhatsAppMessage(from, message) {
    try {
      const cleanPhoneNumber = formatPhoneToE164(from);
      if (!cleanPhoneNumber) {
        logger.error(`Invalid 'from' number for WhatsApp message: ${from}`);
        return 'There was an issue processing your sender information.';
      }
      logger.info(`Processing WhatsApp message from ${cleanPhoneNumber} (text)`);

      const identifier = { type: 'whatsapp_phone', value: cleanPhoneNumber };

      let conversation = await sessionManager.getOrCreateConversationByIdentifier(identifier.type, identifier.value);
      logger.info(`Initial conversation ID for ${cleanPhoneNumber}: ${conversation._id}`);

      await sessionManager.addMessage(conversation._id, 'user', message, 'whatsapp');
      logger.info(`Added user message to conversation ${conversation._id}`);

      // Auto-merge: Check if there are existing conversations with this phone number
      try {
        const digits = cleanPhoneNumber.replace(/\D/g, '');
        const matchDigits = digits.slice(-9); // Last 9 digits for matching

        logger.info(`Auto-checking for existing conversations with phone ending: ...${matchDigits}`);

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

      // Extract phone number from conversation identifiers if not in userInfo
      const phoneIdentifier = conversation.identifiers.find(id =>
        id.type === 'whatsapp_phone' || id.type === 'phone'
      );
      if (phoneIdentifier && !userInfo.phone) {
        userInfo = { ...userInfo, phone: phoneIdentifier.value };
      }

      let messageHistory = [];

      if (config.summary && config.summary.enabled && conversation.summary && conversation.summary.text) {
        logger.info(`Using summary for WhatsApp conversation ${conversation._id} (text, msgs: ${conversation.summary.messageCount}, lastId: ${conversation.summary.lastMessageId})`);
        messageHistory.push({
          role: "system",
          content: `CONVERSATION SUMMARY: ${conversation.summary.text}\n\nThe above is a summary of previous messages.`
        });
        if (conversation.summary.lastMessageId) {
          const lastSummarizedId = conversation.summary.lastMessageId;
          let lastMessageIndex = -1;
          for (let i = 0; i < conversation.messages.length; i++) {
            if (conversation.messages[i]._id.toString() === lastSummarizedId) {
              lastMessageIndex = i;
              break;
            }
          }
          if (lastMessageIndex >= 0) {
            const recentMessages = conversation.messages.slice(lastMessageIndex + 1).map(msg => ({ role: msg.role, content: msg.content }));
            messageHistory.push(...recentMessages);
            logger.info(`Added ${recentMessages.length} WhatsApp messages after summary to history (text).`);
          } else {
            logger.warn(`Summary lastMessageId ${lastSummarizedId} not found in WhatsApp conversation ${conversation._id} (text).`);
            if (conversation.messages.length > 0 && messageHistory.length > 0) {
              const lastConvMsg = conversation.messages[conversation.messages.length - 1];
              const lastHistoryMsg = messageHistory[messageHistory.length - 1];
              if (!(lastHistoryMsg.role === 'user' && lastHistoryMsg.content === lastConvMsg.content)) {
                messageHistory.push({ role: lastConvMsg.role, content: lastConvMsg.content });
              }
            }
          }
        } else {
          logger.warn(`Summary text exists for WhatsApp ${conversation._id} (text) but no lastMessageId.`);
          if (conversation.messages.length > 0 && messageHistory.length > 0) {
            const lastConvMsg = conversation.messages[conversation.messages.length - 1];
            messageHistory.push({ role: lastConvMsg.role, content: lastConvMsg.content });
          }
        }
      } else {
        const historyLimit = config.conversation.maxHistoryMessages || 10;
        messageHistory = conversation.messages.slice(-historyLimit).map(msg => ({ role: msg.role, content: msg.content }));
        logger.info(`Using latest ${messageHistory.length} WhatsApp messages (text) as no summary found/enabled.`);
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

      logger.info(`Processed WhatsApp message for ${cleanPhoneNumber}`, {
        conversationId: conversation._id,
        responseLength: responseText ? responseText.length : 0,
        hadFunctionCalls: hasFunctionCalls,
        summaryUsed: !!(conversation.summary && conversation.summary.text)
      });

      return responseText || 'I processed your request but have no specific response.';
    } catch (error) {
      logger.error(`Error processing WhatsApp message from ${from}:`, error);
      return 'I encountered an error processing your message. Please try again.';
    }
  },

  setupThinkingIndicator(ws) {
    ws.send(JSON.stringify({ type: 'thinking_started', message: 'Thinking...' }));
    return setTimeout(() => {
      ws.send(JSON.stringify({ type: 'thinking_update', message: 'Still thinking...' }));
    }, 3000);
  }
};

module.exports = messageProcessor;