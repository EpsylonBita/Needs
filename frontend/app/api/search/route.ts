import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { withApiErrorHandler, ErrorFactory, createValidationError } from '@/lib/utils/error-handler';
import natural from 'natural';
import { rateLimitEnhanced, RateLimitConfigs } from '@/lib/utils/rate-limit-enhanced';
import { log } from '@/lib/utils/logger';

const ITEMS_PER_PAGE = 12;

// Initialize NLP tools
const tokenizer = new natural.WordTokenizer();
const TfIdf = natural.TfIdf;
const stemmer = natural.PorterStemmer;
const NGrams = natural.NGrams;

// Category-specific tags structure matching the frontend
type CategoryGroup = 'Electronics' | 'Home & Living' | 'Professional Services' | 'Home Services' | 'Personal Services' | 'Transportation & Delivery';
type CategoryTags = {
  [K in 'Items' | 'Services']: {
    tags: {
      [G in CategoryGroup]?: string[];
    };
  };
};

const categoryTags: CategoryTags = {
  'Items': {
    tags: {
      'Electronics': [
        // Audio & Sound
        'radio', 'speaker', 'headphones', 'earbuds', 'microphone', 'amplifier', 'stereo', 'audio',
        'sound system', 'bluetooth speaker', 'wireless speaker', 'home theater', 'subwoofer',
        'turntable', 'record player', 'vinyl player', 'mp3 player', 'audio interface',
        // Phones & Tablets
        'phone', 'iphone', 'android', 'samsung', 'apple', 'xiaomi', 'huawei', 'oneplus', 'google pixel',
        'tablet', 'ipad', 'galaxy tab', 'kindle', 'e-reader',
        // Computers & Laptops
        'computer', 'laptop', 'desktop', 'pc', 'macbook', 'imac', 'dell', 'hp', 'lenovo', 'asus',
        'monitor', 'keyboard', 'mouse', 'printer', 'scanner', 'webcam', 'hard drive', 'ssd',
        // TVs & Entertainment
        'tv', 'television', 'smart tv', 'projector', 'media player', 'streaming device', 'roku',
        'chromecast', 'apple tv', 'fire stick', 'gaming console', 'playstation', 'xbox', 'nintendo',
        // Cameras & Photography
        'camera', 'dslr', 'mirrorless', 'digital camera', 'video camera', 'action camera', 'gopro',
        'camera lens', 'tripod', 'flash', 'memory card',
        // Accessories & Components
        'charger', 'battery', 'power bank', 'cable', 'adapter', 'case', 'screen protector',
        'stand', 'mount', 'dock', 'remote control'
      ],
      'Home & Living': [
        // Furniture
        'furniture', 'sofa', 'chair', 'table', 'bed', 'desk', 'cabinet', 'wardrobe', 'shelf',
        'bookshelf', 'dresser', 'couch', 'armchair', 'dining table', 'coffee table', 'nightstand',
        'mattress', 'ottoman', 'bean bag', 'rocking chair', 'bench', 'stool', 'futon', 'daybed',
        'bunk bed', 'folding chair', 'office chair', 'dining chair', 'bar stool', 'storage bench',
        'tv stand', 'entertainment center', 'side table', 'console table', 'vanity'
      ]
    }
  },
  'Services': {
    tags: {
      'Professional Services': [
        // Technology
        'web development', 'mobile app development', 'software development', 'it support',
        'cybersecurity', 'data analysis', 'machine learning', 'ai development', 'cloud services',
        'devops', 'qa testing', 'database management', 'network setup', 'tech consulting',
        'system administration', 'it training', 'computer repair', 'virus removal',
        'data recovery', 'website maintenance',
        
        // Design & Creative
        'graphic design', 'ui design', 'ux design', 'logo design', 'branding', 'illustration',
        'animation', '3d modeling', 'video editing', 'photo editing', 'motion graphics',
        'product design', 'packaging design', 'print design', 'web design', 'app design',
        'interior design', 'architectural design', 'fashion design', 'game design',
        
        // Business Services
        'marketing', 'digital marketing', 'seo', 'social media management', 'content creation',
        'copywriting', 'email marketing', 'advertising', 'market research', 'business consulting',
        'accounting', 'bookkeeping', 'tax preparation', 'financial planning', 'legal services',
        'business planning', 'hr services', 'recruitment', 'virtual assistant', 'data entry'
      ],
      'Home Services': [
        // Maintenance & Repair
        'home maintenance', 'handyman', 'plumbing', 'electrical', 'hvac', 'roofing',
        'carpentry', 'painting', 'flooring', 'drywall', 'tile work', 'window repair',
        'door repair', 'fence repair', 'deck repair', 'garage door repair', 'appliance repair',
        'furniture repair', 'smart home installation', 'home automation',
        
        // Cleaning & Organization
        'house cleaning', 'deep cleaning', 'carpet cleaning', 'window cleaning',
        'pressure washing', 'pool cleaning', 'gutter cleaning', 'chimney cleaning',
        'organizing', 'decluttering', 'maid service', 'laundry service', 'dry cleaning',
        'car washing', 'boat cleaning', 'office cleaning', 'move in/out cleaning'
      ],
      'Personal Services': [
        // Health & Wellness
        'personal training', 'yoga instruction', 'fitness coaching', 'nutrition coaching',
        'massage therapy', 'physical therapy', 'mental health counseling', 'life coaching',
        'meditation guidance', 'wellness coaching', 'health consulting', 'personal chef',
        'meal prep', 'diet planning', 'stress management', 'sleep coaching',
        
        // Beauty & Care
        'hair styling', 'makeup artist', 'nail care', 'skincare', 'spa services',
        'barbering', 'hair coloring', 'waxing', 'facial treatment', 'eyelash extensions',
        'tattoo artist', 'permanent makeup', 'beauty consulting', 'image consulting'
      ],
      'Transportation & Delivery': [
        // Transportation
        'ride sharing', 'taxi service', 'airport transfer', 'shuttle service',
        'luxury car service', 'charter bus', 'boat charter', 'helicopter service',
        'moving service', 'furniture delivery', 'vehicle transport', 'bike courier',
        
        // Delivery & Logistics
        'package delivery', 'food delivery', 'grocery delivery', 'courier service',
        'same day delivery', 'international shipping', 'freight service',
        'warehousing', 'inventory management', 'order fulfillment', 'last mile delivery'
      ]
    }
  }
};

// AI-powered keyword extraction
function extractKeywords(text: string): string[] {
  // Tokenize and normalize the text
  const tokens = tokenizer.tokenize(text.toLowerCase()) || [];
  
  // Remove stopwords and short words
  const stopwords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'brand']);
  const filteredTokens = tokens.filter(token => 
    !stopwords.has(token) && token.length > 2
  );

  // Extract n-grams (1-3 words)
  const unigrams = filteredTokens;
  const bigrams = NGrams.bigrams(filteredTokens).map(pair => pair.join(' '));
  const trigrams = NGrams.trigrams(filteredTokens).map(triple => triple.join(' '));
  
  // Combine all n-grams
  return [...unigrams, ...bigrams, ...trigrams];
}

// Calculate semantic similarity between two strings
function calculateSemanticSimilarity(str1: string, str2: string): number {
  const tokens1 = new Set(tokenizer.tokenize(str1.toLowerCase()));
  const tokens2 = new Set(tokenizer.tokenize(str2.toLowerCase()));
  
  // Calculate Jaccard similarity
  const intersection = new Set(Array.from(tokens1).filter(x => tokens2.has(x)));
  const union = new Set([...Array.from(tokens1), ...Array.from(tokens2)]);
  
  return intersection.size / union.size;
}

// AI-powered tag suggestion system
function suggestTags(title: string, description: string, category: string) {
  const content = `${title} ${description}`.toLowerCase();
  
  // Extract keywords from the content
  const keywords = extractKeywords(content);
  
  // Get the relevant category structure
  const categoryStructure = categoryTags[category as keyof typeof categoryTags];
  if (!categoryStructure?.tags) return [];

  let suggestedTags = new Set<string>();
  let relevanceScores = new Map<string, number>();
  let categoryScores = new Map<CategoryGroup, number>();

  // Calculate category relevance using semantic similarity
  Object.entries(categoryStructure.tags).forEach(([category, tags]) => {
    let categoryScore = 0;
    keywords.forEach(keyword => {
      tags.forEach((tag: string) => {
        const similarity = calculateSemanticSimilarity(keyword, tag);
        categoryScore += similarity;
      });
    });
    categoryScores.set(category as CategoryGroup, categoryScore);
  });

  // Find the most relevant category
  let mostRelevantCategory = Array.from(categoryScores.entries())
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  if (mostRelevantCategory) {
    // Get tags from the most relevant category
    const primaryTags = categoryStructure.tags[mostRelevantCategory];
    
    // Only process if we have tags for this category
    if (primaryTags) {
      // Calculate tag relevance using semantic similarity
      primaryTags.forEach(tag => {
        let relevance = 0;
        keywords.forEach(keyword => {
          const similarity = calculateSemanticSimilarity(keyword, tag);
          relevance += similarity;
        });
        
        // Add tags with significant relevance
        if (relevance > 0.1) { // Threshold for relevance
          relevanceScores.set(tag, relevance * 1.5); // Boost primary category tags
          suggestedTags.add(tag);
        }
      });
    }

    // Add context-specific tags using pattern matching
    if (category === 'Items') {
      // Condition tags
      if (content.match(/new|brand new|sealed|unopened/)) {
        suggestedTags.add('brand new');
      }
      if (content.match(/used|second|pre owned|preowned|refurbished/)) {
        suggestedTags.add('used');
      }
      if (content.match(/broken|damaged|for parts|not working/)) {
        suggestedTags.add('for parts');
      }
      
      // Price-related tags
      if (content.match(/cheap|budget|affordable|low price/)) {
        suggestedTags.add('budget friendly');
      }
      if (content.match(/premium|luxury|high end|professional/)) {
        suggestedTags.add('premium');
      }
      
      // Availability tags
      if (content.match(/sell|selling|for sale/)) {
        suggestedTags.add('for sale');
      }
      if (content.match(/urgent|quick sale|must go/)) {
        suggestedTags.add('urgent sale');
      }
    }
  }

  // Sort tags by relevance score
  const sortedTags = Array.from(suggestedTags).sort((a, b) => {
    const scoreA = relevanceScores.get(a) || 0;
    const scoreB = relevanceScores.get(b) || 0;
    return scoreB - scoreA;
  });

  return sortedTags;
}

// GET method for searching listings
export const GET = withApiErrorHandler(async (request: NextRequest) => {
  try {
    // Rate limiting for search queries
    const ip = request.headers.get('x-forwarded-for') || 'unknown';
    const rateLimitKey = RateLimitConfigs.PUBLIC_API.key(ip);
    
    const rateLimitResult = await rateLimitEnhanced(
      rateLimitKey,
      RateLimitConfigs.PUBLIC_API.anonymousLimit,
      RateLimitConfigs.PUBLIC_API.windowMs,
      {
        message: RateLimitConfigs.PUBLIC_API.message,
        isAuthenticated: false // Public endpoint
      }
    );
    
    if (!rateLimitResult.allowed) {
      log('warn', 'search_rate_limit_exceeded', { 
        endpoint: 'search-listings',
        ip,
        retryAfter: rateLimitResult.retryAfter 
      });
      
      const headers: Record<string, string> = rateLimitResult.retryAfter ? {
        'Retry-After': rateLimitResult.retryAfter.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': rateLimitResult.resetAt?.toISOString() || ''
      } : {};
      
      return NextResponse.json(
        { 
          error: rateLimitResult.message || 'Rate limit exceeded. Please try again later.' 
        }, 
        { 
          status: 429,
          headers
        }
      );
    }
    
    throw ErrorFactory.system('Search endpoint not implemented')
  } catch (error) {
    log('error', 'search_error', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      ip: request.headers.get('x-forwarded-for') 
    });
    
    return NextResponse.json(
      { error: 'Search service temporarily unavailable' },
      { status: 503 }
    );
  }
})

// POST method for tag suggestions
export const POST = withApiErrorHandler(async (request: NextRequest) => {
  try {
    // Rate limiting for tag suggestions
    const ip = request.headers.get('x-forwarded-for') || 'unknown';
    const rateLimitKey = RateLimitConfigs.PUBLIC_API.key(ip);
    
    const rateLimitResult = await rateLimitEnhanced(
      rateLimitKey,
      RateLimitConfigs.PUBLIC_API.anonymousLimit,
      RateLimitConfigs.PUBLIC_API.windowMs,
      {
        message: RateLimitConfigs.PUBLIC_API.message,
        isAuthenticated: false // Public endpoint
      }
    );
    
    if (!rateLimitResult.allowed) {
      log('warn', 'search_rate_limit_exceeded', { 
        endpoint: 'tag-suggestions',
        ip,
        retryAfter: rateLimitResult.retryAfter 
      });
      
      const headers: Record<string, string> = rateLimitResult.retryAfter ? {
        'Retry-After': rateLimitResult.retryAfter.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': rateLimitResult.resetAt?.toISOString() || ''
      } : {};
      
      return NextResponse.json(
        { 
          error: rateLimitResult.message || 'Rate limit exceeded. Please try again later.' 
        }, 
        { 
          status: 429,
          headers
        }
      );
    }
    
    const body = await request.json();
    const { title, description, category } = body;

    if (!title && !description) {
      throw createValidationError('title', 'Title or description is required')
    }

    if (!category) {
      throw createValidationError('category', 'Category is required')
    }

    // Check if category exists in our structure
    if (!categoryTags[category as keyof typeof categoryTags]) {
      throw createValidationError('category', `Invalid category: ${category}`)
    }

    const suggestions = suggestTags(title || '', description || '', category);
    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error('Error in tag suggestions:', error);
    throw error
  }
})
