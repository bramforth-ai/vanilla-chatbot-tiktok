// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const config = require('./config');
const sessionManager = require('./services/session-manager');
const logger = require('./utils/logger');
const messageProcessor = require('./services/message-processor');
const twilioWebhookRouter = require('./routes/twilio-webhook');

// Initialize Express app
const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

// Import security packages
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// ===================================================================
// 🛡️ SECURITY CONFIGURATION - EDUCATIONAL APPROACH
// ===================================================================
// This section demonstrates security best practices while being 
// educational-friendly for course participants.

// 🎓 LEARNING MODE vs 🔒 PRODUCTION MODE
// Set these environment variables to enable production-level security:
const enableStrictCors = process.env.ENABLE_STRICT_CORS === 'true';
const enableTwilioValidation = process.env.ENABLE_TWILIO_VALIDATION === 'true';
const enableHttpsRedirect = process.env.ENABLE_HTTPS_REDIRECT === 'true';

logger.info('🔒 Security Configuration:', {
  strictCors: enableStrictCors ? 'ENABLED' : 'DISABLED (Learning Mode)',
  twilioValidation: enableTwilioValidation ? 'ENABLED' : 'DISABLED (Learning Mode)',
  httpsRedirect: enableHttpsRedirect ? 'ENABLED' : 'DISABLED (Learning Mode)',
  environment: config.environment
});

// ===================================================================
// 🛡️ HTTPS ENFORCEMENT (Production Security Feature)
// ===================================================================
// In production, always use HTTPS to encrypt data in transit
// This prevents credentials and messages from being intercepted
if (enableHttpsRedirect && config.environment === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      logger.warn(`🔒 Redirecting HTTP to HTTPS: ${req.url}`);
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
  logger.info('🔒 HTTPS enforcement enabled');
}

// ===================================================================
// 🛡️ SECURITY HEADERS (Always Enabled)
// ===================================================================
// Helmet adds security headers to protect against common attacks:
// - XSS attacks (Cross-Site Scripting)
// - Clickjacking attacks
// - MIME type sniffing
// - And many other web vulnerabilities
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],                    // Only load resources from same origin
      styleSrc: ["'self'", "'unsafe-inline'"],  // Allow inline CSS (needed for many UIs)
      scriptSrc: ["'self'"],                     // Only run scripts from same origin
      imgSrc: ["'self'", "data:", "https:"],    // Allow images from safe sources
      connectSrc: ["'self'", "wss:", "ws:"],    // Allow WebSocket connections
      fontSrc: ["'self'"],                       // Only fonts from same origin
      objectSrc: ["'none'"],                     // Block plugins like Flash
      mediaSrc: ["'self'"],                      // Only media from same origin
      frameSrc: ["'none'"],                      // Prevent iframe embedding
    },
  },
  crossOriginEmbedderPolicy: false // Disabled for WebSocket compatibility
}));

// ===================================================================
// 🌐 CORS (Cross-Origin Resource Sharing) CONFIGURATION
// ===================================================================
// CORS determines which websites can make requests to your API
// 🎓 LEARNING MODE: Allows all origins for easy development and testing
// 🔒 PRODUCTION MODE: Only allows specific, trusted domains
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, testing tools)
    if (!origin) return callback(null, true);
    
    // 🎓 DEVELOPMENT: Always allow localhost and ngrok for learning
    if (config.environment === 'development') {
      if (origin.includes('localhost') || origin.includes('ngrok') || origin.includes('127.0.0.1')) {
        return callback(null, true);
      }
    }
    
    // Check environment variable for specifically allowed origins
    const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // 🎓 LEARNING MODE vs 🔒 PRODUCTION MODE
    if (enableStrictCors && config.environment === 'production') {
      // 🔒 PRODUCTION: Reject unknown origins for security
      logger.warn(`🔒 CORS blocked unknown origin: ${origin}`);
      callback(new Error('Not allowed by CORS - configure ALLOWED_ORIGINS'));
    } else {
      // 🎓 LEARNING: Allow all origins for easy development
      if (config.environment === 'development') {
        logger.debug(`🎓 CORS allowing origin (learning mode): ${origin}`);
      }
      callback(null, true);
    }
  },
  credentials: true,        // Allow cookies and authorization headers
  optionsSuccessStatus: 200 // Some legacy browsers need this
};

app.use(cors(corsOptions));

// ===================================================================
// 🛡️ RATE LIMITING (DDoS Protection)
// ===================================================================
// Rate limiting prevents abuse by limiting how many requests each IP can make
// This protects against Denial of Service (DoS) attacks

// General API rate limiter (100 requests per 15 minutes per IP)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,  // Return rate limit info in headers
  legacyHeaders: false,   // Disable legacy headers
  handler: (req, res) => {
    logger.warn(`🛡️ Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({ 
      error: 'Too many requests, please slow down',
      retryAfter: '15 minutes'
    });
  }
});

// Webhook-specific rate limiter (60 requests per minute)
// Webhooks should be more frequent but from trusted sources only
const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // Limit to 60 requests per minute (1 per second average)
  message: {
    error: 'Webhook rate limit exceeded'
  },
  handler: (req, res) => {
    logger.warn(`🛡️ Webhook rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({ error: 'Webhook rate limit exceeded' });
  }
});

// Apply rate limiting to different endpoints
app.use('/twilio', webhookLimiter);  // Stricter limits for webhooks
app.use('/api', apiLimiter);         // Standard limits for API routes
app.use(apiLimiter);                 // Apply to all other routes

// ===================================================================
// 📝 BODY PARSING WITH SIZE LIMITS
// ===================================================================
// Limit request body size to prevent memory exhaustion attacks
app.use(express.json({ 
  limit: '10mb', // Maximum JSON payload size
  verify: (req, res, buf) => {
    // Store raw body for webhook signature verification
    req.rawBody = buf;
  }
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: '10mb' // Maximum form data size
}));

// Serve static files (CSS, JS, images for web interface)
app.use(express.static(path.join(__dirname, 'public')));

// ===================================================================
// 🗄️ DATABASE CONNECTION
// ===================================================================
// Connect to MongoDB with error handling
mongoose.connect(config.mongodb.uri, config.mongodb.options)
  .then(() => {
    logger.info(`✅ Connected to MongoDB database: ${config.mongodb.databaseName}`);
  })
  .catch(err => {
    logger.error('❌ MongoDB connection error:', err);
    // In production, you might want to exit the process here
    // process.exit(1);
  });

// ===================================================================
// 🏥 HEALTH CHECK ENDPOINT
// ===================================================================
// This endpoint allows monitoring systems to check if your app is running
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    environment: config.environment,
    timestamp: new Date().toISOString(),
    security: {
      strictCors: enableStrictCors,
      twilioValidation: enableTwilioValidation,
      httpsRedirect: enableHttpsRedirect
    }
  });
});

// ===================================================================
// 📱 TWILIO WEBHOOK ROUTES
// ===================================================================
// Mount the Twilio webhook router for WhatsApp message handling
app.use('/twilio', twilioWebhookRouter);
logger.info('📱 Mounted Twilio webhook router at /twilio');

// ===================================================================
// 🔌 WEBSOCKET SERVER SETUP
// ===================================================================
// WebSocket server for real-time chat communication with web clients
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  const session = sessionManager.createSession(ws);
  logger.info(`🔌 New WebSocket connection established with session ID: ${session.id}`);

  // Send confirmation to client
  ws.send(JSON.stringify({
    type: 'connection_established',
    sessionId: session.id,
    message: 'Connected to chat server'
  }));

  // Handle incoming WebSocket messages
  ws.on('message', async (message) => {
    try {
      // 🛡️ SECURITY: Parse and validate JSON structure
      let data;
      try {
        data = JSON.parse(message);
      } catch (parseError) {
        logger.warn(`🛡️ Invalid JSON from session ${session.id}:`, parseError.message);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid message format'
        }));
        return;
      }

      // 🛡️ SECURITY: Validate basic message structure
      if (!data || typeof data !== 'object') {
        logger.warn(`🛡️ Invalid data structure from session ${session.id}`);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid message structure'
        }));
        return;
      }

      // 🛡️ SECURITY: Validate message type exists and is valid
      if (!data.type || typeof data.type !== 'string') {
        logger.warn(`🛡️ Missing or invalid type from session ${session.id}`);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Message type required'
        }));
        return;
      }

      // Process different message types
      if (data.type === 'chat_message') {
        // 🛡️ SECURITY: Validate chat message content
        if (!data.message || typeof data.message !== 'string') {
          logger.warn(`🛡️ Invalid message content from session ${session.id}`);
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Message content must be text'
          }));
          return;
        }

        // 🛡️ SECURITY: Prevent excessively long messages (DoS protection)
        if (data.message.length > 2000) {
          logger.warn(`🛡️ Message too long from session ${session.id}: ${data.message.length} chars`);
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Message too long (max 2000 characters)'
          }));
          return;
        }

        // 🛡️ SECURITY: Prevent empty messages (spam protection)
        if (data.message.trim().length === 0) {
          logger.warn(`🛡️ Empty message from session ${session.id}`);
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Message cannot be empty'
          }));
          return;
        }

        logger.info(`✅ Valid message from session ${session.id}:`, {
          type: data.type,
          messageLength: data.message.length,
          messagePreview: data.message.substring(0, 50)
        });

        // Process the validated message
        await messageProcessor.processWebSocketMessage(ws, session.id, data.message);
      } else {
        logger.warn(`🛡️ Unknown message type from session ${session.id}: ${data.type}`);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Unknown message type'
        }));
      }
    } catch (error) {
      logger.error(`❌ Error processing WebSocket message from session ${session.id}:`, error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Error processing your message'
      }));
    }
  });

  // Handle WebSocket disconnection
  ws.on('close', () => {
    logger.info(`🔌 WebSocket connection closed for session: ${session.id}`);
    sessionManager.removeSession(session.id);
  });
});

// ===================================================================
// 🚀 START SERVER (FIXED VERSION)
// ===================================================================
server.listen(config.port, () => {
  logger.info(`🚀 Server running on port ${config.port}`);
  logger.info(`🌍 Environment: ${config.environment}`);
  logger.info(`🤖 OpenAI model: ${config.openai.model || 'default'}`);
  
  // Display ACTUAL security status reading from environment variables
  logger.info('🔒 Current Security Configuration:');
  logger.info(`   ENABLE_STRICT_CORS=${process.env.ENABLE_STRICT_CORS || 'false'}`);
  logger.info(`   ENABLE_TWILIO_VALIDATION=${process.env.ENABLE_TWILIO_VALIDATION || 'false'}`);
  logger.info(`   ENABLE_HTTPS_REDIRECT=${process.env.ENABLE_HTTPS_REDIRECT || 'false'}`);
  
  // Show the parsed boolean values for clarity
  logger.info('🔒 Parsed Security Settings:');
  logger.info(`   Strict CORS: ${enableStrictCors ? 'ENABLED' : 'DISABLED'}`);
  logger.info(`   Twilio Validation: ${enableTwilioValidation ? 'ENABLED' : 'DISABLED'}`);
  logger.info(`   HTTPS Redirect: ${enableHttpsRedirect ? 'ENABLED' : 'DISABLED'}`);
  
  // Educational message based on actual settings
  if (enableStrictCors || enableTwilioValidation || enableHttpsRedirect) {
    logger.info('🔒 Some production security features are enabled');
  } else {
    logger.info('🎓 Running in full learning mode - all security features disabled');
    logger.info('🔒 To enable production security, set environment variables to true');
  }
});

// ===================================================================
// 🛑 GRACEFUL SHUTDOWN
// ===================================================================
// Handle server shutdown gracefully (close connections, save data, etc.)
process.on('SIGTERM', () => {
  logger.info('🛑 SIGTERM received, shutting down gracefully');
  server.close(() => {
    mongoose.connection.close(false, () => {
      logger.info('✅ Server shut down complete');
      process.exit(0);
    });
  });
});