# WhatsApp AI Chatbot Server

A sophisticated multi-channel AI chatbot that seamlessly handles both WhatsApp (via Twilio) and web chat conversations. Features intelligent cross-channel conversation merging, knowledge base integration, and extensible tool system.

## 🌟 Key Features

- **🔄 Cross-Channel Conversations**: Automatically merges WhatsApp and web chat conversations based on phone number identification
- **🤖 AI-Powered Responses**: OpenAI integration with function calling capabilities
- **📚 Knowledge Base**: Intelligent search and retrieval system with relevance scoring
- **🛠️ Extensible Tools**: Easy-to-add custom functions for the AI to use
- **📱 Multi-Format Support**: Handles international phone numbers with smart matching
- **🔒 Production Ready**: Comprehensive security, rate limiting, and input validation
- **📊 Conversation Summaries**: Automatic summarization for token optimization
- **🎓 Educational Approach**: Learning-friendly defaults with production security options

## 🚀 Quick Start

### Prerequisites

- Node.js 16+ 
- MongoDB database
- OpenAI API key
- Twilio account with WhatsApp Business API

### Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd whatsapp-chatbot-server
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure environment variables**
Create a `.env` file (copy from `.env.example`):
```bash
# ===================================
# 🎓 LEARNING MODE CONFIGURATION
# ===================================
# This configuration is perfect for learning, development, and testing
# Security features are disabled by default for easy setup

# Server Configuration
PORT=5000
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/
MONGODB_DATABASE_NAME=vanilla_chatbot
MONGODB_KNOWLEDGE_COLLECTION=knowledge_base

# OpenAI
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4o-mini-2024-07-18
OPENAI_SUMMARY_MODEL=gpt-4o-mini-2024-07-18

# Twilio WhatsApp
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_WHATSAPP_NUMBER=whatsapp:+1234567890
TWILIO_BASE_URL=https://your-domain.com

# 🎓 LEARNING MODE: Security features disabled for easy development
ENABLE_STRICT_CORS=false
ENABLE_TWILIO_VALIDATION=false
ENABLE_HTTPS_REDIRECT=false

# Optional: Allowed origins (only used when ENABLE_STRICT_CORS=true)
ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com

# Features
ENABLE_SUMMARIES=true
SUMMARY_MIN_MESSAGE_COUNT=5
SUMMARY_MAX_LENGTH=500
LOG_LEVEL=info
DISABLE_VERBOSE_LOGS=false
```

4. **Set up MongoDB**
Ensure MongoDB is running and accessible. The application will create collections automatically.

5. **Import knowledge base** (Optional)
```bash
# Prepare your knowledge base JSON file
node scripts/import-knowledge.js data/your-knowledge.json
```

6. **Start the server**
```bash
npm start
```

You should see logs like this for learning mode:
```
🚀 Server running on port 5000
🌍 Environment: development
🔒 Current Security Configuration:
   ENABLE_STRICT_CORS=false
   ENABLE_TWILIO_VALIDATION=false
   ENABLE_HTTPS_REDIRECT=false
🎓 Running in full learning mode - all security features disabled
```

## 🔒 Security Configuration

This chatbot is designed with an **educational approach** - easy to learn with, but production-ready when properly configured.

### 🎓 Learning Mode (Default)
Perfect for development, testing, and following tutorials:

```bash
# Easy setup - no CORS issues, works locally, ngrok-friendly
ENABLE_STRICT_CORS=false
ENABLE_TWILIO_VALIDATION=false  
ENABLE_HTTPS_REDIRECT=false
NODE_ENV=development
```

**Benefits:**
- ✅ Works with localhost, ngrok, any domain
- ✅ Easy webhook testing without signature validation
- ✅ Detailed error messages for debugging
- ✅ No complex CORS configuration needed

### 🔒 Production Mode
Enable security features for live deployment:

```bash
# Full production security
ENABLE_STRICT_CORS=true
ENABLE_TWILIO_VALIDATION=true
ENABLE_HTTPS_REDIRECT=true
NODE_ENV=production

# Required for production security
ALLOWED_ORIGINS=https://yourdomain.com
TWILIO_BASE_URL=https://yourdomain.com
```

**Security Features:**
- 🛡️ **Strict CORS**: Only allows requests from specified domains
- 🔐 **Twilio Validation**: Verifies webhook signatures to prevent fake messages
- 🔒 **HTTPS Redirect**: Forces secure connections in production
- 🚫 **Rate Limiting**: Prevents abuse and DoS attacks
- 🛡️ **Input Validation**: Sanitizes all user inputs

### 🎚️ Progressive Security (Recommended Learning Path)

**Week 1 - Learn the Basics:**
```bash
# All security disabled - focus on functionality
ENABLE_STRICT_CORS=false
ENABLE_TWILIO_VALIDATION=false
ENABLE_HTTPS_REDIRECT=false
```

**Week 2 - Understand CORS:**
```bash
# Enable CORS protection, learn about origins
ENABLE_STRICT_CORS=true
ALLOWED_ORIGINS=https://yourtestsite.com
ENABLE_TWILIO_VALIDATION=false
ENABLE_HTTPS_REDIRECT=false
```

**Week 3 - Full Production Security:**
```bash
# Enable all security features
ENABLE_STRICT_CORS=true
ENABLE_TWILIO_VALIDATION=true
ENABLE_HTTPS_REDIRECT=true
NODE_ENV=production
```

## 📋 Twilio Setup

### 1. WhatsApp Business API
- Enable WhatsApp Business API in your Twilio console
- Configure webhook URL: `https://your-domain.com/twilio/whatsapp`
- Set HTTP method to POST

### 2. Webhook Configuration
- **URL**: `https://your-domain.com/twilio/whatsapp`
- **Method**: POST
- **Events**: Incoming messages

### 3. Security Settings

**For Learning/Testing:**
```bash
ENABLE_TWILIO_VALIDATION=false
```
This allows webhook testing without signature validation.

**For Production:**
```bash
ENABLE_TWILIO_VALIDATION=true
TWILIO_BASE_URL=https://your-actual-domain.com
```
This enables signature validation to prevent fake webhooks.

### 4. Phone Number
Update your `.env` file with your Twilio WhatsApp number:
```bash
TWILIO_WHATSAPP_NUMBER=whatsapp:+1234567890
```

## 💡 How It Works

### Cross-Channel Magic
1. **User starts on website** → Gets a session ID
2. **AI asks for phone number** → Stores it in the conversation
3. **User later contacts via WhatsApp** → System automatically finds and merges the conversations
4. **Full context maintained** → AI remembers the entire conversation history

### Phone Number Matching
The system uses intelligent "last 9 digits" matching to handle different phone number formats:
- `+44 7123 456789` ↔ `07123456789` ✅
- `+1-555-123-4567` ↔ `(555) 123-4567` ✅
- Works with any international format!

## 🔧 Available Tools

The AI has access to these built-in tools:

### `getCurrentTime`
Provides current date and time with timezone support.

**Usage**: When users ask "What time is it?" or "What's the date?"

### `queryKnowledgeBase`
Searches the knowledge base for relevant information.

**Usage**: Automatically triggered when users ask about topics in your knowledge base.

### `searchPreviousConversations`
Looks up previous conversations using phone numbers.

**Usage**: When AI asks "Have you contacted us before?" and user provides phone number.

## 📁 Knowledge Base

### Supported JSON Formats

**Simple Array Format**:
```json
[
  {
    "title": "Product Information",
    "content": "Details about our products...",
    "categories": ["products"],
    "tags": ["info", "pricing"],
    "contentType": "service"
  }
]
```

**Nested Sections Format**:
```json
{
  "sections": [
    {
      "heading": "Services",
      "subheadings": [
        {
          "heading": "Consultation",
          "content": "We offer free consultations..."
        }
      ]
    }
  ]
}
```

### Content Types
- `service` - Products/services offered
- `policy` - Rules and policies  
- `faq` - Frequently asked questions
- `location` - Address/contact information
- `general` - General information

### Import Knowledge Base
```bash
# Import from JSON file
node scripts/import-knowledge.js data/my-knowledge.json

# Check imported data
node scripts/check-knowledge.js

# Test search functionality
node scripts/test-knowledge.js
```

## 🔌 Adding Custom Tools

Create new AI capabilities by adding tools:

1. **Define the tool in `config/tools.js`**:
```javascript
{
  "type": "function",
  "name": "myCustomTool",
  "description": "What this tool does",
  "parameters": {
    "type": "object",
    "properties": {
      "parameter1": {
        "type": "string",
        "description": "What this parameter is for"
      }
    },
    "required": ["parameter1"]
  }
}
```

2. **Register the tool in `services/tools-executor.js`**:
```javascript
toolsExecutor.registerTool('myCustomTool', async (args, context) => {
  // Your tool logic here
  const { parameter1 } = args;
  
  // Do something useful
  const result = await someAsyncOperation(parameter1);
  
  return {
    success: true,
    data: result,
    user_message: "Completed successfully!"
  };
});
```

3. **Add validation** (optional but recommended):
```javascript
// In validateToolArguments method
case 'myCustomTool':
  return this.validateMyCustomToolArgs(args);
```

## 🌐 Web Chat Integration

Include the WebSocket client in your webpage:

```html
<!DOCTYPE html>
<html>
<head>
    <title>Chat</title>
</head>
<body>
    <div id="chat-container">
        <div id="messages"></div>
        <input type="text" id="message-input" placeholder="Type a message...">
        <button onclick="sendMessage()">Send</button>
    </div>

    <script>
        const ws = new WebSocket('ws://localhost:5000');
        
        ws.onmessage = function(event) {
            const data = JSON.parse(event.data);
            if (data.type === 'chat_response') {
                addMessage('Assistant: ' + data.message);
            }
        };
        
        function sendMessage() {
            const input = document.getElementById('message-input');
            const message = input.value.trim();
            if (message) {
                ws.send(JSON.stringify({
                    type: 'chat_message',
                    message: message
                }));
                addMessage('You: ' + message);
                input.value = '';
            }
        }
        
        function addMessage(message) {
            const messages = document.getElementById('messages');
            const div = document.createElement('div');
            div.textContent = message;
            messages.appendChild(div);
            messages.scrollTop = messages.scrollHeight;
        }
        
        // Send message on Enter key
        document.getElementById('message-input').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
    </script>
</body>
</html>
```

## 📊 Monitoring & Debugging

### Logging
The application uses structured logging with different levels:

```bash
# View real-time logs
npm start

# Key log events:
# - Message processing
# - Conversation merging
# - Tool execution
# - Database operations
# - Security events
```

### Security Status Logging
Monitor your security configuration:
```
🔒 Current Security Configuration:
   ENABLE_STRICT_CORS=false
   ENABLE_TWILIO_VALIDATION=false
   ENABLE_HTTPS_REDIRECT=false
🔒 Parsed Security Settings:
   Strict CORS: DISABLED
   Twilio Validation: DISABLED
   HTTPS Redirect: DISABLED
```

### Health Check
Monitor server status:
```bash
curl http://localhost:5000/health
```

Response includes security status:
```json
{
  "status": "healthy",
  "environment": "development",
  "timestamp": "2025-06-07T16:30:00.000Z",
  "security": {
    "strictCors": false,
    "twilioValidation": false,
    "httpsRedirect": false
  }
}
```

## 🚨 Troubleshooting

### Environment Variable Issues

**"Security settings not matching .env file"**
1. Check `.env` file is in the root directory
2. Restart the server after changing `.env`
3. Verify no `.env.local` or `.env.production` overrides
4. Check for typos in variable names (case-sensitive)

**"CORS errors when testing locally"**
```bash
# Quick fix for development
ENABLE_STRICT_CORS=false
```

**"Twilio webhooks not working"**
```bash
# For testing/development
ENABLE_TWILIO_VALIDATION=false

# For production (requires proper TWILIO_BASE_URL)
ENABLE_TWILIO_VALIDATION=true
TWILIO_BASE_URL=https://your-actual-domain.com
```

### Common Issues

**"Cannot read properties of undefined (reading 'SESSION')"**
- Usually indicates old identification logic conflicts
- Check that all old CRM-focused code has been removed

**"Conversation not merging across channels"**
- Verify phone numbers are being stored correctly
- Check that both channels are using the same digit extraction logic
- Ensure MongoDB queries are case-sensitive

**"Tools not executing"**
- Verify tool definitions in `config/tools.js`
- Check tool registration in `tools-executor.js`
- Validate OpenAI API key and model permissions

**"WhatsApp messages not received"**
- Verify Twilio webhook URL configuration
- Check `.env` Twilio credentials
- Ensure server is accessible from internet (for webhooks)
- If testing: Set `ENABLE_TWILIO_VALIDATION=false`

### Development vs Production

**Development Mode** (`NODE_ENV=development`):
- Relaxed CORS policy
- Twilio signature validation optional
- Detailed error messages
- Console logging enabled
- Easy local testing

**Production Mode** (`NODE_ENV=production`):
- Strict security policies when enabled
- Twilio webhook verification when enabled
- Minimal error exposure
- Performance optimizations
- Security headers enforced

### Environment Variable Debugging

Add temporary debug logging to check variable loading:
```javascript
// Add to server.js for debugging
console.log('ENV DEBUG:', {
  ENABLE_STRICT_CORS: process.env.ENABLE_STRICT_CORS,
  ENABLE_TWILIO_VALIDATION: process.env.ENABLE_TWILIO_VALIDATION,
  ENABLE_HTTPS_REDIRECT: process.env.ENABLE_HTTPS_REDIRECT,
  NODE_ENV: process.env.NODE_ENV
});
```

## 📈 Performance Optimization

### Conversation Summaries
- Automatic summarization after 5+ messages (configurable)
- Reduces OpenAI token usage for long conversations
- Maintains context while improving response times

### Database Indexing
Recommended MongoDB indexes:
```javascript
// Identifier lookups
db.conversations.createIndex({"identifiers.type": 1, "identifiers.value": 1})

// Knowledge base search
db.knowledge_items.createIndex({"$**": "text"})
```

### Rate Limiting
- Prevents abuse and protects OpenAI API quotas
- Configurable limits based on usage patterns
- Per-IP tracking with automatic blocking

## 🎓 Educational Progression

This codebase is designed for learning. Here's the recommended progression:

### Phase 1: Basic Setup (Week 1)
```bash
ENABLE_STRICT_CORS=false
ENABLE_TWILIO_VALIDATION=false
ENABLE_HTTPS_REDIRECT=false
```
- Focus on getting basic functionality working
- Learn about WebSocket connections
- Understand message processing flow

### Phase 2: Security Awareness (Week 2)
```bash
ENABLE_STRICT_CORS=true
ALLOWED_ORIGINS=https://yoursite.com
```
- Learn about CORS and why it matters
- Understand origin-based security
- Test with different domains

### Phase 3: Production Readiness (Week 3)
```bash
ENABLE_STRICT_CORS=true
ENABLE_TWILIO_VALIDATION=true
ENABLE_HTTPS_REDIRECT=true
NODE_ENV=production
```
- Enable all security features
- Learn about webhook validation
- Understand HTTPS importance

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes with tests
4. Submit a pull request

### Code Style
- Use ES6+ features
- Follow existing naming conventions
- Add JSDoc comments for new functions
- Include error handling and logging

## 📄 License

This project is provided as-is for educational purposes. Please ensure you comply with:
- OpenAI API Terms of Service
- Twilio Terms of Service  
- MongoDB licensing terms
- Any applicable data protection regulations

## 🆘 Support

For issues and questions:
1. Check the troubleshooting section above
2. Review environment variable configuration
3. Test with learning mode first (all security disabled)
4. Check server logs for security status

## 🏗️ Architecture Notes

This server implements a sophisticated cross-channel conversation management system with educational security. Key architectural decisions:

- **Educational by default**: Security features disabled for easy learning
- **Production ready**: Environment variables enable full security
- **Phone number matching**: Uses "last 9 digits" approach for international compatibility
- **Tool-based identification**: AI-driven conversation merging rather than automatic scanning
- **Service-oriented design**: Clear separation of concerns between routing, processing, and storage
- **Security-first when needed**: Multiple layers of configurable protection

## 🌟 Community & Support

- **Skool Community**: Join our AI Freedom Finders community for support, discussions, and updates: [https://www.skool.com/ai-freedom-finders](https://www.skool.com/ai-freedom-finders)

- **TikTok**: Follow for AI tutorials, tips, and behind-the-scenes content: [https://www.tiktok.com/@ai_entrepreneur_educator](https://www.tiktok.com/@ai_entrepreneur_educator)

---

**Brought to you by [bramforth.ai](https://bramforth.ai)**

*Built with ❤️ for the AI community. Happy coding!*