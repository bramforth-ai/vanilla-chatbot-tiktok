// services/summary-service.js
const config = require('../config');
const logger = require('../utils/logger');
const openaiService = require('./openai-service');
const Conversation = require('../models/conversation');

/**
 * Service for generating conversation summaries
 */
const summaryService = {
  /**
   * Generate a summary for a conversation
   * @param {mongoose.Document} conversation - Conversation document
   * @returns {Promise<Object>} Generated summary
   */
  async generateSummary(conversation) {
    try {
      logger.info(`=== SUMMARY GENERATION STARTED ===`);
      logger.info(`Generating summary for conversation ID: ${conversation._id}`);
      logger.info(`Message count: ${conversation.messages.length}`);

      // Check if we have enough messages to summarize
      const minMessageCount = config.summary?.minMessageCount || 5;
      logger.info(`Minimum required messages: ${minMessageCount}`);

      if (conversation.messages.length < minMessageCount) {
        logger.info(`NOT ENOUGH MESSAGES: ${conversation.messages.length} < ${minMessageCount}`);
        return null;
      }

      // Check if OpenAI client is available
      if (!openaiService.getOpenAIClient) {
        logger.error(`ERROR: openaiService.getOpenAIClient method is not defined!`);
        logger.error(`Make sure to add this method to openai-service.js`);
        return null;
      }

      // Format messages for summarization
      const messages = conversation.messages.map(msg => ({
        role: msg.role,
        content: msg.content
      }));
      logger.info(`Formatted ${messages.length} messages for summarization`);

      // Create a system prompt for summarization
      const summaryPrompt = this.createSummaryPrompt(conversation);
      logger.info(`Created system prompt for summarization (${summaryPrompt.length} chars)`);

      // Use OpenAI to generate the summary
      const model = config.openai.summaryModel || config.openai.model;
      logger.info(`Using model for summarization: ${model}`);

      // Prepare the request
      const input = [
        { role: "system", content: summaryPrompt },
        ...messages,
        {
          role: "user",
          content: "Please create a comprehensive summary of this conversation following the guidelines in the system prompt."
        }
      ];
      logger.info(`Prepared input with ${input.length} messages`);

      // Call OpenAI API
      logger.info(`Calling OpenAI API for summary generation...`);
      const openai = openaiService.getOpenAIClient();

      if (!openai) {
        logger.error(`ERROR: openaiService.getOpenAIClient() returned null or undefined`);
        return null;
      }

      const response = await openai.responses.create({
        model: model,
        input: input,
        temperature: 0.3
      });

      logger.info(`Received OpenAI response with ID: ${response.id}`);

      // Extract summary text from the response
      const summaryText = this.extractSummaryText(response);

      if (!summaryText) {
        logger.warn(`Failed to extract summary text from OpenAI response`);
        logger.warn(`Response structure: ${JSON.stringify(response.output ? {
          outputLength: response.output.length,
          types: response.output.map(item => item.type)
        } : 'No output field')}`);
        return null;
      }

      logger.info(`Successfully extracted summary (${summaryText.length} chars)`);

      // Validate the last message has an _id
      const lastMessage = conversation.messages[conversation.messages.length - 1];
      if (!lastMessage || !lastMessage._id) {
        logger.error(`Last message is missing or has no _id property`);
        return null;
      }

      // Create the summary object
      const summary = {
        text: summaryText,
        createdAt: new Date(),
        lastMessageId: lastMessage._id.toString(),
        messageCount: conversation.messages.length,
        modelUsed: model
      };

      logger.info(`Summary object created with lastMessageId: ${summary.lastMessageId}`);
      logger.info(`=== SUMMARY GENERATION COMPLETED ===`);

      return summary;
    } catch (error) {
      logger.error(`=== SUMMARY GENERATION ERROR ===`);
      logger.error(`Error generating summary for conversation ${conversation._id}:`, error);
      logger.error(`Stack trace: ${error.stack}`);
      return null;
    }
  },
  
  /**
   * Create a system prompt for the summarization
   * @param {mongoose.Document} conversation - Conversation document
   * @returns {string} System prompt
   */
  createSummaryPrompt(conversation) {
    // Get user info for context
    const userInfo = conversation.userInfo;
    let userContext = '';
    
    if (userInfo) {
      userContext = `This conversation is with a user named ${userInfo.firstName || ''} ${userInfo.lastName || ''}.`;
      if (userInfo.userId) {
        userContext += ` Their User ID is ${userInfo.userId}.`;
      }
    }
    
    // Create the summarization prompt
    return `
    Create a concise summary of this conversation between an AI assistant and a user. ${userContext}

    This conversation may contain messages from multiple channels (WhatsApp, website chat) that have been merged together based on phone number identification.

    Focus on:
    1. User identity and contact information (phone numbers, names mentioned)
    2. Specific topics, questions, or problems the user discussed
    3. Actual information, answers, or solutions provided by the AI
    4. Any services, products, or assistance the user was seeking
    5. Current status - what has been resolved and what may still be pending
    6. Important context about how the user contacted you (WhatsApp, website, phone number verification)

    Write the summary as if you are briefing another AI assistant who needs to continue this conversation seamlessly. Include specific details that would help maintain conversation continuity.

    Be specific rather than generic. Instead of "user asked questions" say "user asked about pricing for product X and delivery to London".

    Keep under 500 words but prioritize actionable details over generic statements.
    `;
  },
  
  /**
   * Extract the summary text from an OpenAI response
   * @param {Object} response - OpenAI API response
   * @returns {string|null} Extracted summary text
   */
  extractSummaryText(response) {
    try {
      if (!response.output || !response.output.length) {
        return null;
      }
      
      let summaryText = '';
      
      for (const outputItem of response.output) {
        if (outputItem.type === 'message' && outputItem.content && outputItem.content.length > 0) {
          for (const contentItem of outputItem.content) {
            if (contentItem.type === 'output_text') {
              summaryText += contentItem.text;
            }
          }
        }
      }
      
      return summaryText || null;
    } catch (error) {
      logger.error('Error extracting summary text:', error);
      return null;
    }
  }
};

module.exports = summaryService;