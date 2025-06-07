// config/tools.js

/**
 * Tool definitions for OpenAI Responses API
 */
const tools = [
  {
    "type": "function",
    "name": "getCurrentTime",
    "description": "Returns the current date and time.",
    "parameters": {
      "type": "object",
      "properties": {
        "timezone": {
          "type": "string",
          "description": "Timezone to get current time in (e.g., 'Europe/London'). Defaults to UK time if not specified."
        }
      },
      "required": []
    },
    "strict": false
  },
  {
    "type": "function",
    "name": "queryKnowledgeBase",
    "description": "Search the knowledge base for information.",
    "parameters": {
      "type": "object",
      "properties": {
        "text": {
          "type": "string",
          "description": "Text to search for in the knowledge base. This can be keywords, phrases, or questions."
        },
        "category": {
          "type": "string",
          "description": "Optional category to filter results by."
        },
        "tag": {
          "type": "string",
          "description": "Optional tag to filter results by."
        },
        "contentType": {
          "type": "string",
          "description": "Optional type of content to filter by: 'service', 'policy', 'faq', 'location', or 'general'."
        },
        "limit": {
          "type": "number",
          "description": "Maximum number of knowledge items to return. Default is 5."
        }
      },
      "required": ["text"],
      "additionalProperties": false
    },
    "strict": false
  },
  {
    "type": "function",
    "name": "searchPreviousConversations",
    "description": "Search for previous conversations using a phone number. Use this when a user mentions they have contacted you before and provides their phone number.",
    "parameters": {
      "type": "object",
      "properties": {
        "phoneNumber": {
          "type": "string",
          "description": "Phone number provided by the user in any format (with or without country code, spaces, dashes, etc.)"
        }
      },
      "required": ["phoneNumber"],
      "additionalProperties": false
    },
    "strict": true
  }
];

module.exports = tools;