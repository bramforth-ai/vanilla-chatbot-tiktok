// services/openai-service.js
const { OpenAI } = require('openai');
const config = require('../config');
const logger = require('../utils/logger');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: config.openai.apiKey
});

/**
 * OpenAI Responses Service
 * Handles interactions with the OpenAI Responses API
 */
const openaiService = {
  /**
   * Process a user message and generate a response
   * @param {string} message - User message
   * @param {Array} history - Conversation history
   * @param {Object} userInfo - User information (optional)
   * @param {string} previousResponseId - Previous response ID (optional)
   * @param {Array} tools - Tools to make available (optional)
   * @returns {Promise<Object>} OpenAI response
   */
  async processMessage(message, history, userInfo = null, previousResponseId = null, tools = null) {
    try {
      logger.info('Processing message with OpenAI', {
        messageLength: message.length,
        historyLength: history ? history.length : 0,
        hasUserInfo: !!userInfo,
        hasPreviousResponseId: !!previousResponseId,
        hasTools: !!tools
      });

      // Construct system prompt with user info if available
      let systemPrompt = config.prompts.mainSystemPrompt;

      if (userInfo) {
        const userContext = this.constructUserContext(userInfo);
        systemPrompt = `${userContext}\n\n${systemPrompt}`;
      }

      // Build the input messages
      const input = [
        {
          role: "system",
          content: systemPrompt
        }
      ];

      // Add conversation history
      if (history && history.length > 0) {
        // Map and add history messages
        input.push(...history.map(msg => ({
          role: msg.role,
          content: msg.content
        })));
      }

      // Add the current user message
      input.push({
        role: "user",
        content: message
      });

      // Build the request options
      const requestOptions = {
        model: config.openai.model,
        input: input,
        temperature: 0.7
      };

      // Add previous response ID if available
      if (previousResponseId) {
        requestOptions.previous_response_id = previousResponseId;
      }

      // Add tools if available
      if (tools && tools.length > 0) {
        requestOptions.tools = tools;
      }

      // Make the API call
      const response = await openai.responses.create(requestOptions);

      logger.info('Received response from OpenAI', {
        responseId: response.id,
        outputLength: response.output ? response.output.length : 0,
        outputTypes: response.output ? response.output.map(item => item.type) : []
      });

      return response;
    } catch (error) {
      logger.error('Error processing message with OpenAI:', error);
      throw error;
    }
  },

  /**
 * Process an image message and generate a response
 * @param {string} message - Text message accompanying the image (optional)
 * @param {string} imageUrl - URL to the image
 * @param {Array} history - Conversation history
 * @param {Object} userInfo - User information (optional)
 * @param {string} previousResponseId - Previous response ID (optional)
 * @param {Array} tools - Tools to make available (optional)
 * @returns {Promise<Object>} OpenAI response
 */
  async processImageMessage(message, imageUrl, history, userInfo = null, previousResponseId = null, tools = null) {
    try {
      logger.info('Processing image message with OpenAI', {
        messageLength: message ? message.length : 0,
        imageUrlPreview: imageUrl ? `${imageUrl.substring(0, 20)}...` : 'none',
        historyLength: history ? history.length : 0,
        hasUserInfo: !!userInfo,
        hasPreviousResponseId: !!previousResponseId,
        hasTools: !!tools
      });

      // Construct system prompt with user info if available
      let systemPrompt = config.prompts.mainSystemPrompt;

      // Add image analysis instructions
      systemPrompt += '\n\nYou are also capable of analyzing images. When the user sends an image, examine it carefully and provide detailed and helpful information about what you see.';

      if (userInfo) {
        const userContext = this.constructUserContext(userInfo);
        systemPrompt = `${userContext}\n\n${systemPrompt}`;
      }

      // Build the input messages
      const input = [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: systemPrompt
            }
          ]
        }
      ];

      // Add conversation history
      if (history && history.length > 0) {
        // Map and add history messages
        input.push(...history.map(msg => ({
          role: msg.role,
          content: msg.content
        })));
      }

      // Add the current user message with image
      input.push({
        role: "user",
        content: [
          {
            type: "input_text",
            text: message || "Please analyze this image."
          },
          {
            type: "input_image",
            image_url: imageUrl
          }
        ]
      });

      // Build the request options
      const requestOptions = {
        model: config.openai.model,
        input: input,
        temperature: 0.7
      };

      // Add previous response ID if available
      if (previousResponseId) {
        requestOptions.previous_response_id = previousResponseId;
      }

      // Add tools if available
      if (tools && tools.length > 0) {
        requestOptions.tools = tools;
      }

      // Make the API call
      const response = await openai.responses.create(requestOptions);

      logger.info('Received response from OpenAI for image message', {
        responseId: response.id,
        outputLength: response.output ? response.output.length : 0,
        outputTypes: response.output ? response.output.map(item => item.type) : []
      });

      return response;
    } catch (error) {
      logger.error('Error processing image message with OpenAI:', error);
      throw error;
    }
  },

  /**
   * Process function calls and handle the response
   * @param {Object} response - OpenAI response with function calls
   * @param {Function} toolExecutor - Function to execute tool calls
   * @param {Object} context - Additional context for tool execution
   * @returns {Promise<Object>} Final response after function call handling
   */
  async processFunctionCalls(response, toolExecutor, context = {}) {
    try {
      // Check if there are any function calls
      if (!response.output || !response.output.length) {
        return response;
      }

      // Find function calls in the output
      const functionCalls = response.output.filter(item =>
        item.type === "function_call"
      );

      logger.info('Processing function calls', {
        functionCount: functionCalls.length,
        functionNames: functionCalls.map(call => call.name)
      });

      // Execute each function call in parallel
      const functionPromises = functionCalls.map(async functionCall => {
        try {
          // Execute the function
          const result = await toolExecutor(functionCall, context);

          return {
            call_id: functionCall.call_id,
            name: functionCall.name,
            result
          };
        } catch (error) {
          logger.error(`Error executing function ${functionCall.name}:`, error);

          // Return error result
          return {
            call_id: functionCall.call_id,
            name: functionCall.name,
            result: JSON.stringify({
              error: true,
              message: error.message
            })
          };
        }
      });

      // Wait for all function executions to complete
      const functionResults = await Promise.all(functionPromises);

      logger.info('Function execution results:', {
        resultsCount: functionResults.length,
        functionNames: functionResults.map(result => result.name)
      });

      // Create input with original messages
      // If response.input is not an array or is undefined, create an empty array
      const originalInput = Array.isArray(response.input) ? [...response.input] : [];
      const followUpInput = [...originalInput];

      // Add all function calls and results
      for (const functionCall of functionCalls) {
        // Add the function call
        followUpInput.push({
          type: "function_call",
          call_id: functionCall.call_id,
          name: functionCall.name,
          arguments: functionCall.arguments
        });

        // Find the corresponding result
        const resultEntry = functionResults.find(r => r.call_id === functionCall.call_id);

        // Add the function output
        if (resultEntry) {
          followUpInput.push({
            type: "function_call_output",
            call_id: functionCall.call_id,
            output: resultEntry.result
          });
        } else {
          logger.error(`No result found for function call ${functionCall.call_id}`);
        }
      }

      // Add tools if the original request had them
      const tools = response.tools || null;

      // Check for system instructions in function results
      const systemInstructions = [];

      // Track user creation if implemented
      let hasUserCreation = false;
      let newUserInfo = null;

      // Process each function result to find system instructions
      for (const resultEntry of functionResults) {
        try {
          // Parse the result if it's a string
          let resultData;
          if (typeof resultEntry.result === 'string') {
            resultData = JSON.parse(resultEntry.result);
          } else {
            resultData = resultEntry.result;
          }

          // Track user creation if implemented (for example with createUser function)
          if (resultEntry.name === 'createUser' && resultData && resultData.success) {
            hasUserCreation = true;
            // Store the new user info for fallback response
            if (resultData.user) {
              newUserInfo = {
                userId: resultData.user.userId || resultData.user.id,
                firstName: resultData.user.firstName,
                lastName: resultData.user.lastName
              };
              // Update context with user info
              if (!context.userInfo) context.userInfo = {};
              Object.assign(context.userInfo, newUserInfo);

              logger.info('Stored new user info from createUser response', {
                userId: newUserInfo.userId,
                name: `${newUserInfo.firstName} ${newUserInfo.lastName}`
              });
            }
          }

          // Check if the result contains a system_instruction
          if (resultData && resultData.system_instruction) {
            logger.info(`Found system instruction in ${resultEntry.name} result:`, {
              functionName: resultEntry.name,
              instruction: resultData.system_instruction
            });

            systemInstructions.push(resultData.system_instruction);
          }

          // Check if this is a knowledge base result with context
          if (resultEntry.name === 'queryKnowledgeBase' &&
            resultData &&
            resultData.success &&
            resultData.knowledgeFound &&
            resultData.context) {

            logger.info('Found knowledge base context in function result', {
              functionName: resultEntry.name,
              itemCount: resultData.itemCount
            });

            // Add the knowledge base context as a system message
            followUpInput.push({
              role: "system",
              content: resultData.context
            });
          }
        } catch (error) {
          logger.error(`Error parsing result to check for system_instruction or knowledge context:`, error);
        }
      }

      // If we found any system instructions, add them to the followUpInput
      if (systemInstructions.length > 0) {
        // Combine all instructions if there are multiple
        const combinedInstruction = systemInstructions.join("\n\n");

        // Add as a system message to guide the AI's next response
        followUpInput.push({
          role: "system",
          content: combinedInstruction
        });

        // Add a specific user message to prompt a response
        followUpInput.push({
          role: "user",
          content: "Please acknowledge and continue with the conversation."
        });

        logger.info('Added system instruction and prompt to follow-up request', {
          instructionCount: systemInstructions.length
        });
      }

      // Build follow-up request
      const followUpRequest = {
        model: response.model || config.openai.model,
        input: followUpInput,
        temperature: 0.7
      };

      // Add previous response ID if available
      if (response.id) {
        followUpRequest.previous_response_id = response.id;
      }

      // Add tools if available
      if (tools) {
        followUpRequest.tools = tools;
      }

      // Make the follow-up call
      logger.info('Making follow-up call to OpenAI', {
        inputLength: followUpInput.length,
        previousResponseId: followUpRequest.previous_response_id
      });

      const finalResponse = await openai.responses.create(followUpRequest);

      logger.info('Received final response from OpenAI', {
        responseId: finalResponse.id,
        outputLength: finalResponse.output ? finalResponse.output.length : 0,
        outputTypes: finalResponse.output ? finalResponse.output.map(item => item.type) : []
      });

      // Check for empty response and provide guaranteed fallback for user creation
      if (hasUserCreation && (!finalResponse.output ||
        finalResponse.output.length === 0 ||
        !finalResponse.output.some(item =>
          item.type === 'message' &&
          item.content &&
          item.content.some(c => c.type === 'output_text' && c.text && c.text.trim() !== '')
        ))) {

        logger.warn('Received empty response after user creation, using robust fallback');

        // Create a guaranteed fallback response that incorporates the user context
        let fallbackText = "Thank you! I've successfully created your profile.";

        // Add user name if available
        if (newUserInfo && newUserInfo.firstName) {
          fallbackText = `Thank you, ${newUserInfo.firstName}! I've successfully created your profile.`;
        }

        // Generic continuation prompt
        fallbackText += " How else can I assist you today?";

        // Build a proper response object
        return {
          id: 'user_creation_fallback_' + Date.now(),
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: fallbackText
                }
              ]
            }
          ]
        };
      }

      return finalResponse;
    } catch (error) {
      logger.error('Error processing function calls:', error);

      // Return a fallback response if there's an error
      return {
        id: 'error_fallback_' + Date.now(),
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: 'I experienced an error processing your request. Can you please try again?'
              }
            ]
          }
        ]
      };
    }
  },

  /**
   * Extract text content from OpenAI response
   * @param {Object} response - OpenAI response object
   * @param {string} channel - The channel ('website' or 'whatsapp')
   * @returns {string} Extracted text content
   */
  extractResponseText(response, channel = 'website') {
    logger.debug('Extracting text from response', {
      hasOutput: !!response.output,
      outputLength: response.output ? response.output.length : 0,
      outputTypes: response.output ? response.output.map(item => item.type) : []
    });

    if (!response.output || !response.output.length) {
      logger.warn('No output in response');
      return '';
    }

    let responseText = '';

    for (const outputItem of response.output) {
      if (outputItem.type === 'message' && outputItem.content && outputItem.content.length > 0) {
        for (const contentItem of outputItem.content) {
          if (contentItem.type === 'output_text') {
            responseText += contentItem.text;
          }
        }
      }
    }

    // If no text was found but function calls were executed, provide a fallback
    if (!responseText && response.input && Array.isArray(response.input)) {
      // Get all function_call_output items
      const functionOutputs = response.input.filter(item => item.type === 'function_call_output');

      if (functionOutputs.length > 0) {
        // Check for specific function types - can be customized for your tools

        // For example, for getCurrentTime
        const getCurrentTimeOutput = functionOutputs.find(item => item.name === 'getCurrentTime');
        if (getCurrentTimeOutput) {
          try {
            const outputData = JSON.parse(getCurrentTimeOutput.output);
            if (outputData.formatted) {
              responseText = `The current time is ${outputData.formatted} in the ${outputData.timezone} timezone.`;
              return responseText;
            }
          } catch (error) {
            logger.error('Error parsing getCurrentTime output:', error);
          }
        }

        // Add additional function-specific fallbacks here

        // Generic fallback for any function call if we still don't have a response
        if (!responseText) {
          responseText = "I've processed your request. Is there anything else you'd like to know?";
        }
      }
    }

    logger.debug('Extracted response text', {
      responseTextLength: responseText.length
    });

    return responseText;
  },

  /**
   * Construct user context from user info
   * @param {Object} userInfo - User information (optional)
   * @returns {string} User context string for AI prompt
   */
  constructUserContext(userInfo) {
    if (!userInfo) return '';

    const context = ['USER CONTEXT:'];

    if (userInfo.firstName || userInfo.lastName) {
      const name = `${userInfo.firstName || ''} ${userInfo.lastName || ''}`.trim();
      context.push(`You are speaking with ${name}.`);
      context.push(`Greet them by name when appropriate.`);
    }

    if (userInfo.phone) {
      context.push(`Their phone number is ${userInfo.phone}.`);
    }

    if (userInfo.email) {
      context.push(`Their email is ${userInfo.email}.`);
    }

    // Note: This system can be extended to include more user information
    context.push('DO NOT ask for information you already have.');

    return context.join(' ');
  }
};

module.exports = openaiService;