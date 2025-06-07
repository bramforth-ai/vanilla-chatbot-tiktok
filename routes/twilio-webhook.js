// routes/twilio-webhook.js
const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const sessionManager = require('../services/session-manager');
const messageProcessor = require('../services/message-processor');
const logger = require('../utils/logger');
const config = require('../config');

// Twilio TwiML response generator
const MessagingResponse = twilio.twiml.MessagingResponse;

/**
 * POST endpoint for Twilio WhatsApp webhook
 * This handles incoming WhatsApp messages via Twilio
 */
router.post('/whatsapp',
    // Debug logging to help troubleshoot
    (req, res, next) => {
        logger.debug('[Twilio Debug] Webhook hit at /twilio/whatsapp');
        logger.debug('[Twilio Debug] Headers:', JSON.stringify(req.headers, null, 2));
        logger.debug('[Twilio Debug] URL:', req.originalUrl);
        next();
    },
    // Parse URL-encoded bodies (needed for Twilio webhook)
    express.urlencoded({ extended: false }),
    // Debug logging after body parsing
    (req, res, next) => {
        logger.debug('[Twilio Debug] Body after parsing:', req.body);
        next();
    },
    // Twilio webhook signature validation
    (req, res, next) => {
        const enableTwilioValidation = process.env.ENABLE_TWILIO_VALIDATION === 'true';
        
        if (enableTwilioValidation && config.environment === 'production') {
            logger.debug('[Twilio Security] Validating webhook signature');
            
            // Extract signature from headers
            const twilioSignature = req.headers['x-twilio-signature'];
            
            if (!twilioSignature) {
                logger.error('[Twilio Security] Missing webhook signature header');
                return res.status(403).send('Forbidden - Missing signature');
            }
            
            // Construct webhook URL for validation
            const webhookUrl = `${config.twilio.baseUrl}/twilio/whatsapp`;
            
            if (!config.twilio.baseUrl) {
                logger.error('[Twilio Security] TWILIO_BASE_URL not configured for webhook validation');
                return res.status(500).send('Server configuration error');
            }
            
            try {
                // Validate the request signature
                const isValid = twilio.validateRequest(
                    config.twilio.authToken,
                    twilioSignature,
                    webhookUrl,
                    req.body
                );
                
                if (!isValid) {
                    logger.error('[Twilio Security] Invalid webhook signature - request rejected');
                    return res.status(403).send('Forbidden - Invalid signature');
                }
                
                logger.debug('[Twilio Security] Webhook signature validated successfully');
                
            } catch (validationError) {
                logger.error('[Twilio Security] Signature validation error:', validationError.message);
                return res.status(403).send('Forbidden - Validation error');
            }
        } else {
            if (config.environment === 'development') {
                logger.debug('[Twilio Debug] Skipping validation in development mode');
            } else if (!enableTwilioValidation) {
                logger.debug('[Twilio Debug] Validation disabled via ENABLE_TWILIO_VALIDATION=false');
            }
        }
        
        next();
    },
    async (req, res) => {
        // Extract and validate basic webhook structure
        const incomingMsg = req.body;

        if (!incomingMsg || typeof incomingMsg !== 'object') {
            logger.error('[Twilio Webhook] Invalid webhook body structure');
            const twiml = new MessagingResponse();
            res.writeHead(200, { 'Content-Type': 'text/xml' });
            res.end(twiml.toString());
            return;
        }

        // Validate required Twilio fields
        const userWpNumberWithPrefix = incomingMsg.From;
        const userMessage = incomingMsg.Body;
        const messageSid = incomingMsg.MessageSid;

        // Validate phone number
        if (!userWpNumberWithPrefix || typeof userWpNumberWithPrefix !== 'string') {
            logger.error('[Twilio Webhook] Missing or invalid From field');
            const twiml = new MessagingResponse();
            res.writeHead(200, { 'Content-Type': 'text/xml' });
            res.end(twiml.toString());
            return;
        }

        // Validate message SID
        if (!messageSid || typeof messageSid !== 'string') {
            logger.error('[Twilio Webhook] Missing or invalid MessageSid');
            const twiml = new MessagingResponse();
            res.writeHead(200, { 'Content-Type': 'text/xml' });
            res.end(twiml.toString());
            return;
        }

        // Validate media count
        let numMedia = parseInt(incomingMsg.NumMedia || '0', 10);
        if (isNaN(numMedia) || numMedia < 0) {
            logger.error('[Twilio Webhook] Invalid NumMedia value:', incomingMsg.NumMedia);
            const twiml = new MessagingResponse();
            res.writeHead(200, { 'Content-Type': 'text/xml' });
            res.end(twiml.toString());
            return;
        }

        // Validate message content - either text or media must be present
        const hasValidText = userMessage && typeof userMessage === 'string' && userMessage.trim().length > 0;
        const hasMedia = numMedia > 0;

        if (!hasValidText && !hasMedia) {
            logger.error('[Twilio Webhook] Message has no text content and no media');
            const twiml = new MessagingResponse();
            res.writeHead(200, { 'Content-Type': 'text/xml' });
            res.end(twiml.toString());
            return;
        }

        // Validate text message length if present
        if (hasValidText && userMessage.length > 1600) { // WhatsApp has ~1600 char limit
            logger.warn(`[Twilio Webhook] Message too long: ${userMessage.length} chars from ${userWpNumberWithPrefix}`);
            // Don't reject, but truncate and log
            userMessage = userMessage.substring(0, 1600) + '... [truncated]';
        }

        // Validate media items if present
        const mediaItems = [];
        if (hasMedia) {
            for (let i = 0; i < numMedia; i++) {
                const contentType = incomingMsg[`MediaContentType${i}`];
                const mediaUrl = incomingMsg[`MediaUrl${i}`];

                // Validate media fields
                if (!contentType || !mediaUrl) {
                    logger.warn(`[Twilio Webhook] Invalid media item ${i}: contentType=${contentType}, url=${!!mediaUrl}`);
                    continue; // Skip invalid media items
                }

                // Basic content type validation
                if (typeof contentType !== 'string' || typeof mediaUrl !== 'string') {
                    logger.warn(`[Twilio Webhook] Invalid media types for item ${i}`);
                    continue;
                }

                mediaItems.push({
                    contentType: contentType,
                    url: mediaUrl
                });

                logger.info(`[Twilio Webhook] Valid media ${i}: ${contentType} at ${mediaUrl}`);
            }

            // Update numMedia to reflect valid items only
            numMedia = mediaItems.length;
        }

        logger.info(`[Twilio Webhook] Validated message SID ${messageSid} from ${userWpNumberWithPrefix}`, {
            hasText: hasValidText,
            textLength: hasValidText ? userMessage.length : 0,
            mediaCount: numMedia
        });

        // Continue with existing webhook acknowledgment and processing...
        try {
            const twiml = new MessagingResponse();
            res.writeHead(200, { 'Content-Type': 'text/xml' });
            res.end(twiml.toString());
        } catch (responseError) {
            logger.error('[Twilio Webhook] Error sending TwiML response:', responseError);
            res.status(200).send('');
            return;
        }

        // --- 2. Process Asynchronously ---
        try {
            // If no media (text-only message) AND no text, then fail
            if (numMedia === 0 && !userMessage) {
                logger.error('[Twilio Webhook] Text-only message with missing Body.');
                return; // Already responded to Twilio
            }

            // Extract clean phone number
            const userPhoneNumber = userWpNumberWithPrefix.replace('whatsapp:', ''); // -> +447973629596

            let responseText;

            // Process differently based on message type (text or image)
            if (numMedia > 0 && mediaItems.length > 0) {
                // Simple response for images since we don't need image analysis
                responseText = "I can see you've sent an image, but I'm currently set up to help with text-based questions only. Please describe what you need help with in a text message.";
            } else {
                // Process as regular text message
                responseText = await messageProcessor.processWhatsAppMessage(
                    userPhoneNumber,
                    userMessage
                );
            }

            // Send the response back to the user via Twilio
            if (responseText) {
                await sendWhatsAppReply(userPhoneNumber, responseText);
                logger.info(`Sent WhatsApp reply to ${userPhoneNumber}`);
            } else {
                logger.warn(`No response text generated for WhatsApp message`);
            }
        } catch (error) {
            // Catch errors in the overall processing block (after Twilio ACK)
            logger.error('[Twilio Webhook] Unhandled error processing incoming message:', error);

            // Try to send an error message to the user
            try {
                await sendWhatsAppReply(userWpNumberWithPrefix, "I'm sorry, I encountered an error processing your request. Please try again later.");
            } catch (sendError) {
                logger.error(`Error sending error message to WhatsApp:`, sendError);
            }
        }
    }
);

/**
 * Format phone number to E.164 format
 * @param {string} phoneNumber - Phone number to format
 * @returns {string} Formatted phone number
 */
function formatPhoneToE164(phoneNumber) {
    // Remove any 'whatsapp:' prefix
    let formattedNumber = phoneNumber.replace('whatsapp:', '');

    // Ensure it starts with +
    if (!formattedNumber.startsWith('+')) {
        // If it starts with a 0, assume it's a UK number and replace the 0 with +44
        if (formattedNumber.startsWith('0')) {
            formattedNumber = '+44' + formattedNumber.substring(1);
        } else {
            // Otherwise, just add + if it's missing
            formattedNumber = '+' + formattedNumber;
        }
    }

    // Remove any spaces, dashes, or parentheses
    formattedNumber = formattedNumber.replace(/[\s\-\(\)]/g, '');

    logger.info(`Formatted phone number from ${phoneNumber} to ${formattedNumber}`);

    return formattedNumber;
}

/**
 * Send a WhatsApp message via Twilio
 * @param {string} phoneNumber - Recipient's phone number
 * @param {string} message - Message to send
 * @returns {Promise<boolean>} Success status
 */
async function sendWhatsAppReply(phoneNumber, message) {
    try {
        // Get Twilio credentials from config
        const accountSid = config.twilio.accountSid;
        const authToken = config.twilio.authToken;
        const twilioWhatsappNumber = config.twilio.whatsappNumber;

        if (!accountSid || !authToken || !twilioWhatsappNumber) {
            logger.error('[Twilio] Missing required Twilio credentials');
            return false;
        }

        // Create a Twilio client
        const twilioClient = twilio(accountSid, authToken);

        // Ensure phone number has WhatsApp prefix
        const to = phoneNumber.startsWith('whatsapp:') ? phoneNumber : `whatsapp:${phoneNumber}`;

        // Send the message
        logger.info(`Sending WhatsApp message to ${to} using ${twilioWhatsappNumber}`);

        await twilioClient.messages.create({
            body: message,
            from: twilioWhatsappNumber,
            to: to
        });

        logger.info(`Successfully sent WhatsApp reply to ${to}`);
        return true;
    } catch (error) {
        logger.error('[Twilio] Error sending WhatsApp reply:', error);
        logger.error('[Twilio] Error details:', error.message);
        if (error.code) {
            logger.error('[Twilio] Error code:', error.code);
        }
        return false;
    }
}

module.exports = router;