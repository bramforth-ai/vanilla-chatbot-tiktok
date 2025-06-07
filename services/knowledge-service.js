// services/knowledge-service.js
const KnowledgeItem = require('../models/knowledge');
const logger = require('../utils/logger');

/**
 * Knowledge Service
 * Handles retrieval and formatting of knowledge base content
 */
const knowledgeService = {
  /**
   * Find knowledge items by exact category match
   * @param {string} category - Category to search for
   * @param {number} limit - Maximum number of results to return
   * @returns {Promise<Array>} - Array of matching knowledge items
   */
  async findByCategory(category, limit = 5) {
    try {
      logger.info(`Searching knowledge base for category: ${category}`);
      
      const items = await KnowledgeItem.find({
        categories: category
      })
      .sort({ priority: -1 })
      .limit(limit);
      
      logger.info(`Found ${items.length} items in category: ${category}`);
      return items;
    } catch (error) {
      logger.error('Error finding knowledge by category:', error);
      throw error;
    }
  },
  
  /**
   * Find knowledge items by exact tag match
   * @param {string} tag - Tag to search for
   * @param {number} limit - Maximum number of results to return
   * @returns {Promise<Array>} - Array of matching knowledge items
   */
  async findByTag(tag, limit = 5) {
    try {
      logger.info(`Searching knowledge base for tag: ${tag}`);
      
      const items = await KnowledgeItem.find({
        tags: tag
      })
      .sort({ priority: -1 })
      .limit(limit);
      
      logger.info(`Found ${items.length} items with tag: ${tag}`);
      return items;
    } catch (error) {
      logger.error('Error finding knowledge by tag:', error);
      throw error;
    }
  },
  
  /**
   * Search knowledge items by text content
   * @param {string} text - Text to search for
   * @param {number} limit - Maximum number of results to return
   * @returns {Promise<Array>} - Array of matching knowledge items
   */
  async searchByText(text, limit = 5) {
    try {
      logger.info(`Performing text search in knowledge base: "${text}"`);
      
      const items = await KnowledgeItem.find(
        { $text: { $search: text } },
        { score: { $meta: "textScore" } }
      )
      .sort({ score: { $meta: "textScore" }, priority: -1 })
      .limit(limit);
      
      logger.info(`Found ${items.length} items matching text: "${text}"`);
      return items;
    } catch (error) {
      logger.error('Error searching knowledge by text:', error);
      throw error;
    }
  },
  
  /**
   * Extract meaningful words from a search query
   * @param {string} text - The search text
   * @param {number} minWordLength - Minimum word length to consider
   * @returns {Array<string>} - Array of meaningful words
   */
  extractSearchTerms(text, minWordLength = 3) {
    if (!text) return [];
    
    // Remove special characters and split into words
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length >= minWordLength);
    
    // Remove common stop words that don't add search value
    const stopWords = ['the', 'and', 'for', 'with', 'what', 'where', 'when', 'how', 'why', 'who'];
    return words.filter(word => !stopWords.includes(word));
  },
  
  /**
   * Escape special characters in a string for use in regex
   * @param {string} string - String to escape
   * @returns {string} - Escaped string safe for regex
   */
  escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  },
  
  /**
   * Multi-faceted search for knowledge items with disjunctive logic and relevance scoring
   * @param {Object} query - Search parameters
   * @param {string} query.text - Optional text to search for
   * @param {string} query.category - Optional category to filter by
   * @param {string} query.tag - Optional tag to filter by
   * @param {string} query.contentType - Optional content type to filter by
   * @param {number} limit - Maximum number of results to return
   * @returns {Promise<Array>} - Array of matching knowledge items
   */
  async search(query, limit = 5) {
    try {
      logger.info('Performing knowledge base search with disjunctive logic:', query);
      
      // Extract search terms from text for potential regex matching
      const searchTerms = query.text ? this.extractSearchTerms(query.text) : [];
      logger.debug(`Extracted search terms: [${searchTerms.join(', ')}]`);
      
      // First try with MongoDB aggregation and scoring
      const results = await this.performScoredSearch(query, searchTerms, limit);
      
      // If we got results, return them
      if (results.length > 0) {
        logger.info(`Found ${results.length} items using scored search`);
        return results;
      }
      
      // If no results, try progressive fallback search
      logger.info('No results from primary search, trying fallback search');
      return await this.performFallbackSearch(query, searchTerms, limit);
    } catch (error) {
      logger.error('Error performing knowledge base search:', error);
      throw error;
    }
  },
  
  /**
   * Performs a scored search using aggregation pipeline
   * @param {Object} query - Search parameters
   * @param {Array<string>} searchTerms - Extracted search terms
   * @param {number} limit - Maximum number of results
   * @returns {Promise<Array>} - Search results
   */
  async performScoredSearch(query, searchTerms, limit) {
    // Build the aggregation pipeline
    const pipeline = [];
    
    // Track which search components are active
    const searchComponents = {
      hasText: Boolean(query.text),
      hasCategory: Boolean(query.category),
      hasTag: Boolean(query.tag),
      hasContentType: Boolean(query.contentType)
    };
    
    // Create match conditions for OR logic
    const orConditions = [];
    
    // Text search - use $text operator if available
    if (searchComponents.hasText) {
      // Add text search as a stage (MongoDB requires $text in its own $match stage)
      pipeline.push({
        $match: { $text: { $search: query.text } }
      });
      
      // We don't add text to orConditions since it's handled in its own stage
    }
    
    // Category match
    if (searchComponents.hasCategory) {
      orConditions.push({ categories: query.category });
    }
    
    // Tag match
    if (searchComponents.hasTag) {
      orConditions.push({ tags: query.tag });
    }
    
    // Content type match
    if (searchComponents.hasContentType) {
      orConditions.push({ contentType: query.contentType });
    }
    
    // Word-level text matches for more flexible matching
    if (searchTerms.length > 0) {
      // Create regex patterns for each search term
      const regexPatterns = searchTerms.map(term => 
        new RegExp(this.escapeRegExp(term), 'i')
      );
      
      // Add regex conditions for title and content
      orConditions.push({ title: { $in: regexPatterns } });
      orConditions.push({ content: { $in: regexPatterns } });
    }
    
    // Add the combined $or conditions if we have any
    if (orConditions.length > 0) {
      pipeline.push({
        $match: { $or: orConditions }
      });
    }
    
    // Add scoring calculations
    pipeline.push({
      $addFields: {
        scores: {
          // Text match score (from MongoDB text index) - highest weight
          textScore: searchComponents.hasText ? { $meta: "textScore" } : 0,
          
          // Category match score
          categoryScore: searchComponents.hasCategory ? {
            $cond: {
              if: { $in: [query.category, "$categories"] },
              then: 5,
              else: 0
            }
          } : 0,
          
          // Tag match score
          tagScore: searchComponents.hasTag ? {
            $cond: {
              if: { $in: [query.tag, "$tags"] },
              then: 3,
              else: 0
            }
          } : 0,
          
          // Content type match score
          contentTypeScore: searchComponents.hasContentType ? {
            $cond: {
              if: { $eq: ["$contentType", query.contentType] },
              then: 2,
              else: 0
            }
          } : 0
        }
      }
    });
    
    // Calculate total score
    pipeline.push({
      $addFields: {
        totalScore: {
          $add: [
            { $multiply: ["$scores.textScore", 10] }, // Weight text score higher
            "$scores.categoryScore",
            "$scores.tagScore",
            "$scores.contentTypeScore",
            { $divide: ["$priority", 10] } // Factor in item priority (scaled down)
          ]
        }
      }
    });
    
    // Sort by total score (descending)
    pipeline.push({
      $sort: { totalScore: -1 }
    });
    
    // Limit results
    pipeline.push({
      $limit: limit
    });
    
    // Run the aggregation
    const results = await KnowledgeItem.aggregate(pipeline);
    
    // Log scoring info for debugging
    if (results.length > 0) {
      logger.debug(`Top result: "${results[0].title}" with score ${results[0].totalScore}`);
    }
    
    return results;
  },
  
  /**
   * Performs a fallback search when primary search returns no results
   * @param {Object} query - Search parameters
   * @param {Array<string>} searchTerms - Extracted search terms
   * @param {number} limit - Maximum number of results
   * @returns {Promise<Array>} - Search results
   */
  async performFallbackSearch(query, searchTerms, limit) {
    // Try a series of progressively more lenient searches
    
    // 1. Try individual search terms with regex if we have search terms
    if (searchTerms.length > 0) {
      logger.debug('Trying fallback with individual search terms');
      
      // Create a regex that matches ANY of the search terms
      const regexPattern = new RegExp(searchTerms.map(term => 
        this.escapeRegExp(term)).join('|'), 'i');
      
      const regexResults = await KnowledgeItem.find({
        $or: [
          { title: regexPattern },
          { content: regexPattern },
          { categories: regexPattern }
        ]
      })
      .sort({ priority: -1 })
      .limit(limit);
      
      if (regexResults.length > 0) {
        logger.info(`Found ${regexResults.length} items using regex fallback search`);
        return regexResults;
      }
    }
    
    // 2. If category is provided, try category-only search
    if (query.category) {
      logger.debug('Trying fallback with category-only search');
      const categoryResults = await this.findByCategory(query.category, limit);
      
      if (categoryResults.length > 0) {
        return categoryResults;
      }
    }
    
    // 3. If tag is provided, try tag-only search
    if (query.tag) {
      logger.debug('Trying fallback with tag-only search');
      const tagResults = await this.findByTag(query.tag, limit);
      
      if (tagResults.length > 0) {
        return tagResults;
      }
    }
    
    // 4. If content type is provided, try content-type only search
    if (query.contentType) {
      logger.debug('Trying fallback with contentType-only search');
      const contentTypeResults = await KnowledgeItem.find({
        contentType: query.contentType
      })
      .sort({ priority: -1 })
      .limit(limit);
      
      if (contentTypeResults.length > 0) {
        logger.info(`Found ${contentTypeResults.length} items using contentType fallback search`);
        return contentTypeResults;
      }
    }
    
    // 5. Last resort: return highest priority items if everything else failed
    logger.debug('All fallback searches failed, returning high priority items');
    const defaultResults = await KnowledgeItem.find()
      .sort({ priority: -1 })
      .limit(limit);
    
    logger.info(`Returning ${defaultResults.length} default high-priority items`);
    return defaultResults;
  },
  
  /**
   * Format knowledge items into context for AI prompt
   * @param {Array} items - Knowledge items to format
   * @returns {string} - Formatted context string
   */
  formatKnowledgeContext(items) {
    if (!items || items.length === 0) {
      return '';
    }
    
    let context = 'KNOWLEDGE BASE INFORMATION:\n\n';
    
    items.forEach((item, index) => {
      context += `[${index + 1}] ${item.title.toUpperCase()}\n`;
      context += `${item.content}\n\n`;
      
      // Add any relevant metadata that should be included
      if (item.metadata && (item.metadata.size > 0 || Object.keys(item.metadata).length > 0)) {
        // Handle both Map and regular object forms of metadata
        const metadataObj = item.metadata instanceof Map ? 
          Object.fromEntries(item.metadata) : item.metadata;
        
        // Add important metadata fields if available
        Object.entries(metadataObj).forEach(([key, value]) => {
          if (value && typeof value !== 'object') {
            context += `${key}: ${value}\n`;
          }
        });
      }
      
      context += '---\n\n';
    });
    
    context += 'USE THE ABOVE INFORMATION TO ANSWER THE USER\'S QUESTION. IF THE KNOWLEDGE BASE DOESN\'T CONTAIN RELEVANT INFORMATION, ACKNOWLEDGE THAT AND OFFER TO HELP IN OTHER WAYS.\n';
    
    return context;
  }
};

module.exports = knowledgeService;