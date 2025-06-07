// scripts/import-knowledge.js
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const KnowledgeItem = require('../models/knowledge');

// Configuration - can be changed for different data sources
const DEFAULT_CONFIG = {
  dataFile: path.join(__dirname, '../data/knowledge.json'),
  batchSize: 100, // Process in batches to avoid memory issues
  defaultPriority: 50,
  defaultContentType: 'general'
};

async function importKnowledge(customConfig = {}) {
  const importConfig = { ...DEFAULT_CONFIG, ...customConfig };
  
  try {
    console.log('Starting knowledge base import...');
    console.log(`Data file: ${importConfig.dataFile}`);
    
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(config.mongodb.uri);
    console.log(`Connected to MongoDB database: ${config.mongodb.databaseName}`);
    console.log(`Using collection: ${config.mongodb.knowledgeCollection}`);

    // Check if data file exists
    if (!fs.existsSync(importConfig.dataFile)) {
      throw new Error(`Data file not found: ${importConfig.dataFile}`);
    }

    // Read and parse JSON data
    console.log('Reading knowledge data...');
    const rawData = fs.readFileSync(importConfig.dataFile, 'utf8');
    let data;
    
    try {
      data = JSON.parse(rawData);
    } catch (parseError) {
      throw new Error(`Invalid JSON in data file: ${parseError.message}`);
    }

    // Clear existing knowledge base (optional - comment out to append instead)
    const existingCount = await KnowledgeItem.countDocuments();
    if (existingCount > 0) {
      console.log(`Found ${existingCount} existing knowledge items.`);
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise(resolve => {
        readline.question('Clear existing data? (y/N): ', resolve);
      });
      readline.close();
      
      if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
        console.log('Clearing existing knowledge base...');
        await KnowledgeItem.deleteMany({});
        console.log('Existing data cleared.');
      }
    }

    // Process data based on structure
    const knowledgeItems = processKnowledgeData(data, importConfig);
    
    console.log(`Processing ${knowledgeItems.length} knowledge items...`);

    // Insert in batches to avoid memory issues
    let insertedCount = 0;
    for (let i = 0; i < knowledgeItems.length; i += importConfig.batchSize) {
      const batch = knowledgeItems.slice(i, i + importConfig.batchSize);
      await KnowledgeItem.insertMany(batch);
      insertedCount += batch.length;
      console.log(`Inserted batch: ${insertedCount}/${knowledgeItems.length}`);
    }

    console.log(`Successfully imported ${insertedCount} knowledge items!`);
    
    // Show sample of imported data
    const samples = await KnowledgeItem.find().limit(3);
    console.log('\nSample imported items:');
    samples.forEach((item, index) => {
      console.log(`${index + 1}. ${item.title} (${item.contentType})`);
      console.log(`   Categories: ${item.categories.join(', ')}`);
      console.log(`   Content preview: ${item.content.substring(0, 100)}...`);
    });

  } catch (error) {
    console.error('Error importing knowledge:', error.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
  }
}

/**
 * Process different JSON data structures into knowledge items
 */
function processKnowledgeData(data, config) {
  const knowledgeItems = [];

  // Handle array of objects (most common scraper output)
  if (Array.isArray(data)) {
    console.log('Processing array format data...');
    data.forEach(item => {
      const knowledgeItem = createKnowledgeItem(item, config);
      if (knowledgeItem) {
        knowledgeItems.push(knowledgeItem);
      }
    });
  }
  // Handle object with items array
  else if (data.items && Array.isArray(data.items)) {
    console.log('Processing object.items format data...');
    data.items.forEach(item => {
      const knowledgeItem = createKnowledgeItem(item, config);
      if (knowledgeItem) {
        knowledgeItems.push(knowledgeItem);
      }
    });
  }
  // Handle nested structure (like the medical format)
  else if (data.sections && Array.isArray(data.sections)) {
    console.log('Processing nested sections format data...');
    data.sections.forEach(section => {
      // Add section as general item
      if (section.heading) {
        knowledgeItems.push({
          title: section.heading,
          content: section.content || section.heading,
          categories: ['General'],
          tags: [slugify(section.heading)],
          contentType: 'general',
          priority: 90
        });
      }

      // Process subsections
      if (section.subheadings && Array.isArray(section.subheadings)) {
        section.subheadings.forEach(sub => {
          knowledgeItems.push({
            title: sub.heading || sub.title,
            content: sub.content,
            categories: [section.heading],
            tags: [slugify(sub.heading || sub.title)],
            contentType: determineContentType(sub.heading || sub.title),
            priority: determinePriority(sub.heading || sub.title)
          });
        });
      }
    });
  }
  // Handle simple object format
  else if (typeof data === 'object') {
    console.log('Processing single object format data...');
    const knowledgeItem = createKnowledgeItem(data, config);
    if (knowledgeItem) {
      knowledgeItems.push(knowledgeItem);
    }
  }
  else {
    throw new Error('Unsupported data format. Expected array or object with items/sections.');
  }

  return knowledgeItems;
}

/**
 * Create a knowledge item from various input formats
 */
function createKnowledgeItem(item, config) {
  // Skip invalid items
  if (!item || typeof item !== 'object') {
    return null;
  }

  // Extract title (try different field names)
  const title = item.title || item.heading || item.name || item.subject || 'Untitled';
  
  // Extract content (try different field names)
  const content = item.content || item.text || item.description || item.body || title;
  
  // Skip if no meaningful content
  if (!content || content.trim().length < 10) {
    console.warn(`Skipping item with insufficient content: ${title}`);
    return null;
  }

  // Extract categories
  let categories = [];
  if (item.categories) {
    categories = Array.isArray(item.categories) ? item.categories : [item.categories];
  } else if (item.category) {
    categories = [item.category];
  } else if (item.section) {
    categories = [item.section];
  } else {
    categories = ['General'];
  }

  // Extract tags
  let tags = [];
  if (item.tags) {
    tags = Array.isArray(item.tags) ? item.tags : [item.tags];
  } else if (item.keywords) {
    tags = Array.isArray(item.keywords) ? item.keywords : [item.keywords];
  } else {
    tags = [slugify(title)];
  }

  return {
    title: title.trim(),
    content: content.trim(),
    categories: categories.filter(cat => cat && cat.trim()),
    tags: tags.filter(tag => tag && tag.trim()),
    contentType: item.contentType || item.type || determineContentType(title),
    priority: item.priority || determinePriority(title),
    metadata: item.metadata || {}
  };
}

/**
 * Determine content type based on title/content
 */
function determineContentType(title) {
  if (!title) return 'general';
  
  const titleLower = title.toLowerCase();
  
  if (titleLower.includes('faq') || titleLower.includes('question')) {
    return 'faq';
  }
  if (titleLower.includes('policy') || titleLower.includes('rule') || titleLower.includes('guideline')) {
    return 'policy';
  }
  if (titleLower.includes('service') || titleLower.includes('product') || titleLower.includes('offer')) {
    return 'service';
  }
  if (titleLower.includes('location') || titleLower.includes('address') || titleLower.includes('contact')) {
    return 'location';
  }
  
  return 'general';
}

/**
 * Determine priority based on content type and title
 */
function determinePriority(title) {
  if (!title) return 50;
  
  const titleLower = title.toLowerCase();
  
  // High priority for important content
  if (titleLower.includes('important') || titleLower.includes('urgent') || 
      titleLower.includes('policy') || titleLower.includes('faq')) {
    return 80;
  }
  
  // Medium priority for services and products
  if (titleLower.includes('service') || titleLower.includes('product')) {
    return 70;
  }
  
  // Default priority
  return 50;
}

/**
 * Convert text to URL-friendly slug
 */
function slugify(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

// Run the import if called directly
if (require.main === module) {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const customConfig = {};
  
  // Allow custom data file via command line
  if (args.length > 0) {
    customConfig.dataFile = path.resolve(args[0]);
  }
  
  importKnowledge(customConfig)
    .then(() => {
      console.log('Import completed successfully!');
      process.exit(0);
    })
    .catch(err => {
      console.error('Import failed:', err.message);
      process.exit(1);
    });
}

module.exports = { importKnowledge, processKnowledgeData };