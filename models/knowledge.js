// models/knowledge.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const config = require('../config');

// Get collection name from config, which should be loaded from environment variables
const KNOWLEDGE_COLLECTION = config.mongodb.knowledgeCollection || 'knowledge_items';

// Schema for knowledge items
const knowledgeItemSchema = new Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  content: {
    type: String,
    required: true
  },
  categories: [{
    type: String,
    trim: true
  }],
  tags: [{
    type: String,
    trim: true
  }],
  contentType: {
    type: String,
    enum: ['service', 'policy', 'faq', 'location', 'general'],
    default: 'general'
  },
  priority: {
    type: Number,
    default: 50,
    min: 1,
    max: 100
  },
  metadata: {
    type: Map,
    of: Schema.Types.Mixed,
    default: {}
  }
}, { 
  timestamps: true,
  collection: KNOWLEDGE_COLLECTION
});

// Add text index for knowledge search
knowledgeItemSchema.index({ 
  title: 'text', 
  content: 'text',
  categories: 'text',
  tags: 'text'
}, {
  weights: {
    title: 10,
    content: 5,
    categories: 3,
    tags: 2
  }
});

// Create model
const KnowledgeItem = mongoose.model('KnowledgeItem', knowledgeItemSchema);

module.exports = KnowledgeItem;