// services/tools-executor.js
const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const knowledgeService = require('./knowledge-service');
const Conversation = require('../models/conversation');
const identificationService = require('./identification-service');

// Tool registry
const toolRegistry = new Map();

/**
 * Tools Executor
 * Handles execution of function calls
 */
const toolsExecutor = {
  /**
   * Register a tool handler
   * @param {string} name - Tool name
   * @param {Function} handler - Function handler
   */
  registerTool(name, handler) {
    logger.info(`Registering tool: ${name}`);
    toolRegistry.set(name, handler);
  },

  /**
   * List registered tools
   * @returns {Array} List of registered tool names
   */
  listRegisteredTools() {
    return Array.from(toolRegistry.keys());
  },

  /**
   * Execute a tool call
   * @param {Object} toolCall - Tool call object from OpenAI
   * @param {Object} context - Additional context for execution
   * @returns {Promise<string>} Tool execution result as JSON string
   */
  async executeTool(toolCall, context = {}) {
    const { name, arguments: argsString, call_id } = toolCall;

    logger.info(`Executing tool: ${name}`, {
      call_id,
      context: Object.keys(context)
    });

    try {
      // Get the tool handler
      const handler = toolRegistry.get(name);

      if (!handler) {
        return JSON.stringify({
          success: false,
          error: true,
          message: `No handler registered for tool: ${name}`,
          code: 'UNKNOWN_TOOL'
        });
      }

      // Parse arguments safely
      let args;
      try {
        args = typeof argsString === 'string' ? JSON.parse(argsString) : argsString;
      } catch (parseError) {
        logger.error(`Error parsing arguments for tool ${name}:`, parseError.message);
        return JSON.stringify({
          success: false,
          error: true,
          message: `Invalid arguments: ${parseError.message}`,
          code: 'INVALID_ARGUMENTS',
          user_message: "I couldn't process your request due to an error. Please try again with clearer information."
        });
      }

      // Validate arguments structure
      if (!args || typeof args !== 'object') {
        logger.error(`Invalid arguments structure for tool ${name}:`, typeof args);
        return JSON.stringify({
          success: false,
          error: true,
          message: 'Arguments must be an object',
          code: 'INVALID_ARGUMENTS_STRUCTURE',
          user_message: "I couldn't process your request due to invalid parameters."
        });
      }

      // Tool-specific validation
      const validationResult = this.validateToolArguments(name, args);
      if (!validationResult.valid) {
        logger.error(`Tool argument validation failed for ${name}:`, validationResult.error);
        return JSON.stringify({
          success: false,
          error: true,
          message: validationResult.error,
          code: 'INVALID_TOOL_ARGUMENTS',
          user_message: validationResult.userMessage || "I couldn't process your request due to invalid parameters."
        });
      }

      // Execute the tool with context
      const result = await handler(args, context);

      // Ensure result is a string with proper error handling
      let resultString;
      try {
        resultString = typeof result === 'string' ? result : JSON.stringify(result);
      } catch (stringifyError) {
        logger.error(`Error stringifying result for tool ${name}:`, stringifyError.message);
        return JSON.stringify({
          success: false,
          error: true,
          message: `Error formatting result: ${stringifyError.message}`,
          code: 'RESULT_FORMAT_ERROR',
          user_message: "I processed your request but encountered an error with the result. Please try again."
        }, (key, value) => {
          if (key === 'cause' || key === 'stack' || key === 'request' || key === 'response') {
            return undefined;
          }
          return value;
        });
      }

      logger.info(`Tool ${name} executed successfully`, {
        call_id,
        resultLength: resultString.length
      });

      return resultString;
    } catch (error) {
      logger.error(`Error executing tool ${name}:`, error.message);
      logger.error(`Stack trace:`, error.stack);

      // Return a properly formatted error response
      return JSON.stringify({
        success: false,
        error: true,
        message: error.message || 'Tool execution failed',
        code: error.code || 'EXECUTION_ERROR',
        user_message: "I encountered an error while processing your request. Please try again or provide more information."
      }, (key, value) => {
        // Prevent circular references
        if (key === 'cause' || key === 'stack' || key === 'request' || key === 'response' || key === 'config') {
          return undefined;
        }
        return value;
      });
    }
  },

  /**
   * Validate arguments for specific tools
   * @param {string} toolName - Name of the tool
   * @param {Object} args - Arguments to validate
   * @returns {Object} Validation result
   */
  validateToolArguments(toolName, args) {
    switch (toolName) {
      case 'getCurrentTime':
        return this.validateGetCurrentTimeArgs(args);

      case 'queryKnowledgeBase':
        return this.validateQueryKnowledgeBaseArgs(args);

      case 'searchPreviousConversations':
        return this.validateSearchPreviousConversationsArgs(args);

      default:
        return { valid: true };
    }
  },

  /**
 * Validate searchPreviousConversations arguments
 */
  validateSearchPreviousConversationsArgs(args) {
    if (!args.phoneNumber || typeof args.phoneNumber !== 'string') {
      return {
        valid: false,
        error: 'Phone number is required and must be a string',
        userMessage: 'I need a phone number to search for previous conversations.'
      };
    }

    if (args.phoneNumber.trim().length < 5) {
      return {
        valid: false,
        error: 'Phone number too short',
        userMessage: 'That phone number seems too short. Could you provide your full phone number?'
      };
    }

    return { valid: true };
  },

  /**
   * Validate getCurrentTime arguments
   */
  validateGetCurrentTimeArgs(args) {
    // timezone is optional
    if (args.timezone !== undefined) {
      if (typeof args.timezone !== 'string') {
        return {
          valid: false,
          error: 'Timezone must be a string',
          userMessage: 'Invalid timezone format specified.'
        };
      }

      if (args.timezone.length > 50) {
        return {
          valid: false,
          error: 'Timezone string too long',
          userMessage: 'Timezone specification too long.'
        };
      }
    }

    return { valid: true };
  },

  /**
   * Validate queryKnowledgeBase arguments
   */
  validateQueryKnowledgeBaseArgs(args) {
    // At least one search parameter is required
    const hasText = args.text && typeof args.text === 'string' && args.text.trim().length > 0;
    const hasCategory = args.category && typeof args.category === 'string';
    const hasTag = args.tag && typeof args.tag === 'string';
    const hasContentType = args.contentType && typeof args.contentType === 'string';

    if (!hasText && !hasCategory && !hasTag && !hasContentType) {
      return {
        valid: false,
        error: 'At least one search parameter (text, category, tag, or contentType) is required',
        userMessage: 'I need something to search for in the knowledge base.'
      };
    }

    // Validate text length if provided
    if (args.text && typeof args.text === 'string' && args.text.length > 500) {
      return {
        valid: false,
        error: 'Search text too long (max 500 characters)',
        userMessage: 'Your search query is too long. Please make it more concise.'
      };
    }

    // Validate limit if provided
    if (args.limit !== undefined) {
      if (typeof args.limit !== 'number' || !Number.isInteger(args.limit)) {
        return {
          valid: false,
          error: 'Limit must be an integer',
          userMessage: 'Invalid search limit specified.'
        };
      }

      if (args.limit < 1 || args.limit > 20) {
        return {
          valid: false,
          error: 'Limit must be between 1 and 20',
          userMessage: 'Search limit must be between 1 and 20 results.'
        };
      }
    }

    // Validate contentType values if provided
    if (args.contentType) {
      const validContentTypes = ['service', 'policy', 'faq', 'location', 'general'];
      if (!validContentTypes.includes(args.contentType)) {
        return {
          valid: false,
          error: `Invalid contentType. Must be one of: ${validContentTypes.join(', ')}`,
          userMessage: 'Invalid content type specified for search.'
        };
      }
    }

    return { valid: true };
  },

  /**
   * Make an HTTP request to an external API
   * @param {string} url - API endpoint URL
   * @param {string} method - HTTP method
   * @param {Object} params - Request parameters or body
   * @param {Object} headers - Request headers
   * @returns {Promise<Object>} API response
   */
  async callExternalAPI(url, method, params, headers = {}) {
    try {
      logger.info(`Calling external API: ${url}`, {
        method,
        paramsKeys: Object.keys(params)
      });

      // Build request configuration
      const requestConfig = {
        method,
        url,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        timeout: 30000 // 30 second timeout
      };

      // Add parameters based on method
      if (method === 'GET') {
        requestConfig.params = params;
      } else {
        requestConfig.data = params;
      }

      // Make the request
      const response = await axios(requestConfig);

      logger.info(`External API call successful`, {
        status: response.status,
        dataKeys: Object.keys(response.data)
      });

      return response.data;
    } catch (error) {
      logger.error(`Error calling external API ${url}:`, error.message);
      if (error.response) {
        logger.error(`Response status: ${error.response.status}, data:`, error.response.data);
      }

      // Extract error details from Axios error
      let errorMessage = 'Error calling external service';
      let errorCode = 'SERVICE_ERROR';
      let userMessage = "I'm sorry, there was an issue connecting to the service. Please try again or contact support.";

      if (error.response) {
        // Server responded with error
        errorMessage = error.response.data?.message || error.response.data?.error || errorMessage;
        errorCode = error.response.status.toString();

        // Add user-friendly messages for common errors
        if (error.response.status === 404) {
          userMessage = "I couldn't find the information you're looking for. Please check the details and try again.";
        } else if (error.response.status === 400) {
          userMessage = "There seems to be an issue with the information provided. Please check and try again.";
        } else if (error.response.status >= 500) {
          userMessage = "The service is experiencing technical difficulties. Please try again later.";
        }
      } else if (error.request) {
        // No response received
        errorMessage = 'No response received from service';
        errorCode = 'TIMEOUT_ERROR';
        userMessage = "The service is taking too long to respond. Please try again later.";
      }

      // Return a properly formatted error response instead of throwing
      return {
        success: false,
        error: true,
        message: errorMessage,
        code: errorCode,
        user_message: userMessage
      };
    }
  },

  /**
   * Validate arguments for specific tools
   * @param {string} toolName - Name of the tool
   * @param {Object} args - Arguments to validate
   * @returns {Object} Validation result
   */
  validateToolArguments(toolName, args) {
    switch (toolName) {
      case 'getCurrentTime':
        return this.validateGetCurrentTimeArgs(args);

      case 'queryKnowledgeBase':
        return this.validateQueryKnowledgeBaseArgs(args);

      default:
        return { valid: true };
    }
  },

  /**
   * Validate getCurrentTime arguments
   */
  validateGetCurrentTimeArgs(args) {
    if (args.timezone !== undefined) {
      if (typeof args.timezone !== 'string') {
        return {
          valid: false,
          error: 'Timezone must be a string',
          userMessage: 'Invalid timezone format specified.'
        };
      }

      if (args.timezone.length > 50) {
        return {
          valid: false,
          error: 'Timezone string too long',
          userMessage: 'Timezone specification too long.'
        };
      }
    }

    return { valid: true };
  },

  /**
   * Validate queryKnowledgeBase arguments
   */
  validateQueryKnowledgeBaseArgs(args) {
    const hasText = args.text && typeof args.text === 'string' && args.text.trim().length > 0;
    const hasCategory = args.category && typeof args.category === 'string';
    const hasTag = args.tag && typeof args.tag === 'string';
    const hasContentType = args.contentType && typeof args.contentType === 'string';

    if (!hasText && !hasCategory && !hasTag && !hasContentType) {
      return {
        valid: false,
        error: 'At least one search parameter required',
        userMessage: 'I need something to search for in the knowledge base.'
      };
    }

    if (args.text && typeof args.text === 'string' && args.text.length > 500) {
      return {
        valid: false,
        error: 'Search text too long (max 500 characters)',
        userMessage: 'Your search query is too long. Please make it more concise.'
      };
    }

    if (args.limit !== undefined) {
      if (typeof args.limit !== 'number' || !Number.isInteger(args.limit)) {
        return {
          valid: false,
          error: 'Limit must be an integer',
          userMessage: 'Invalid search limit specified.'
        };
      }

      if (args.limit < 1 || args.limit > 20) {
        return {
          valid: false,
          error: 'Limit must be between 1 and 20',
          userMessage: 'Search limit must be between 1 and 20 results.'
        };
      }
    }

    if (args.contentType) {
      const validContentTypes = ['service', 'policy', 'faq', 'location', 'general'];
      if (!validContentTypes.includes(args.contentType)) {
        return {
          valid: false,
          error: `Invalid contentType. Must be one of: ${validContentTypes.join(', ')}`,
          userMessage: 'Invalid content type specified for search.'
        };
      }
    }

    return { valid: true };
  }
};

// Register the getCurrentTime tool
toolsExecutor.registerTool('getCurrentTime', async (args) => {
  const timezone = args.timezone || 'Europe/London';
  const now = new Date();

  try {
    const formatted = now.toLocaleString('en-GB', {
      timeZone: timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

    return {
      success: true,
      iso: now.toISOString(),
      timezone: timezone,
      formatted: formatted,
      user_message: `Current time: ${formatted} (${timezone})`
    };
  } catch (error) {
    logger.error('Error formatting time:', error.message);
    return {
      success: true,
      iso: now.toISOString(),
      timezone: 'UTC',
      formatted: now.toUTCString(),
      user_message: `Current time: ${now.toUTCString()} (UTC - timezone error occurred)`
    };
  }
});

/**
 * Helper function to extract search terms from user message
 * @param {string} message - User message text
 * @returns {string} - Extracted search terms
 */
function extractSearchTerms(message) {
  if (!message) return '';

  // Remove common question words and conversational elements
  const cleanedMessage = message.replace(/tell me about|what is|do you have|can you tell me about|i want to know about|information on|info about/gi, '').trim();

  // Return the cleaned message or the original if nothing remains
  return cleanedMessage || message;
}

// Register the queryKnowledgeBase tool
toolsExecutor.registerTool('queryKnowledgeBase', async (args, context) => {
  try {
    // Enhanced logging with actual parameter values
    logger.info('Knowledge base query tool called with args:', {
      argsKeys: Object.keys(args),
      text: args.text,
      category: args.category,
      tag: args.tag,
      contentType: args.contentType
    });

    // Handle empty search parameters
    if ((!args.text || args.text.trim() === '') && !args.category && !args.tag && !args.contentType) {
      // Extract search terms from the user's message context if available
      if (context && context.userMessage) {
        const userMessage = context.userMessage;
        logger.info(`No search parameters provided, extracting from user message: "${userMessage}"`);

        // Extract potential search terms using helper function
        args.text = extractSearchTerms(userMessage);
        logger.info(`Extracted search terms: "${args.text}"`);
      } else {
        logger.warn('No search parameters and no user message context available');
      }
    }

    // Extract parameters with fallbacks
    const {
      text = '',
      category = null,
      tag = null,
      contentType = null,
      limit = 5
    } = args;

    // Build query object
    const query = {};
    if (text) query.text = text;
    if (category) query.category = category;
    if (tag) query.tag = tag;
    if (contentType) query.contentType = contentType;

    // Log the final query being sent to the knowledge service
    logger.info('Sending knowledge base search query:', query);

    // Search knowledge base
    const knowledgeItems = await knowledgeService.search(query, limit);

    // Format results for AI context
    const formattedContext = knowledgeService.formatKnowledgeContext(knowledgeItems);

    // Log search results summary
    logger.info(`Knowledge base search results: ${knowledgeItems.length} items found, context length: ${formattedContext.length} chars`);

    // Return the knowledge items and formatted context
    return {
      success: true,
      itemCount: knowledgeItems.length,
      hasResults: knowledgeItems.length > 0,
      context: formattedContext,
      knowledgeFound: formattedContext.length > 30 // Basic check that we found something
    };
  } catch (error) {
    logger.error('Error executing queryKnowledgeBase tool:', error);

    return {
      success: false,
      error: true,
      message: error.message || 'Knowledge base query failed',
      code: 'KNOWLEDGE_QUERY_ERROR',
      user_message: "I couldn't retrieve that information right now. Could you try asking in a different way?"
    };
  }
});

// Register the searchPreviousConversations tool
toolsExecutor.registerTool('searchPreviousConversations', async (args, context) => {
  try {
    const { phoneNumber } = args;

    logger.info('Search previous conversations tool called with:', { phoneNumber: phoneNumber?.substring(0, 5) + '...' });

    // Extract just the digits
    const digits = phoneNumber.replace(/\D/g, '');

    if (digits.length < 7) {
      return {
        success: false,
        found: false,
        message: 'Phone number too short',
        user_message: "That phone number seems too short. Could you provide your full phone number?"
      };
    }

    // Take last 9 digits for matching (good balance of uniqueness vs compatibility)
    const matchDigits = digits.slice(-9);

    logger.info(`Searching for conversations with phone ending in: ...${matchDigits}`);

    // Get current conversation ID from context
    const currentConversationId = context.conversationId;

    if (!currentConversationId) {
      return {
        success: false,
        found: false,
        message: 'No conversation context available',
        user_message: "I couldn't access the current conversation. Please try again."
      };
    }

    // Search for WhatsApp conversations with matching phone endings
    const matchingConversations = await Conversation.find({
      _id: { $ne: currentConversationId }, // Exclude current conversation
      'identifiers': {
        $elemMatch: {
          'type': 'whatsapp_phone',
          'value': { $regex: `${matchDigits}$` } // Ends with these digits
        }
      }
    });

    if (matchingConversations.length === 0) {
      logger.info(`No previous conversations found for phone ending in: ...${matchDigits}`);

      // Add the phone number as identifier to current conversation for future linking
      try {
        const currentConversation = await Conversation.findById(currentConversationId);
        if (currentConversation) {
          currentConversation.addIdentifier('phone', phoneNumber, 70, false);
          await currentConversation.save();
          logger.info(`Added phone identifier ${phoneNumber} to conversation ${currentConversationId} for future linking`);
        }
      } catch (error) {
        logger.error('Error adding phone identifier to conversation:', error);
      }

      return {
        success: true,
        found: false,
        phoneAdded: true,
        message: 'No previous conversations found but phone number saved',
        user_message: "I couldn't find any previous conversations with that phone number. This might be your first time contacting us. I've noted your number so if you contact us through WhatsApp in the future, I'll be able to connect your conversations."
      };
    }

    logger.info(`Found ${matchingConversations.length} previous conversations to merge`);

    // Use the identification service to merge the conversations
    const mergeResult = await identificationService.mergeConversations(currentConversationId, matchingConversations);

    // Format the last activity date for user feedback
    const lastActivity = matchingConversations[0].lastActivity || matchingConversations[0].lastUpdated;
    const activityDate = lastActivity ? new Date(lastActivity).toLocaleDateString() : 'recently';

    return {
      success: true,
      found: true,
      merged: true,
      conversationCount: matchingConversations.length,
      messageCount: mergeResult.mergedMessages,
      lastActivity: activityDate,
      user_message: `Perfect! I found your previous WhatsApp conversation from ${activityDate}. I can now see your full conversation history with ${mergeResult.mergedMessages} previous messages. How can I help you today?`
    };

  } catch (error) {
    logger.error('Error searching previous conversations:', error);
    return {
      success: false,
      found: false,
      error: true,
      message: error.message || 'Search failed',
      user_message: "I encountered an error while searching for your previous conversations. Please try again."
    };
  }
});

module.exports = toolsExecutor;