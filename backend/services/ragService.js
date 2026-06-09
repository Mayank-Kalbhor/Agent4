const { OpenAI } = require('openai');
const { Pinecone } = require('@pinecone-database/pinecone');
const { query } = require('../db/db');

// Initialize OpenAI client if API key is set
let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// Initialize Pinecone client if API key is set
let pineconeIndex = null;
if (process.env.PINECONE_API_KEY) {
  try {
    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    const indexName = process.env.PINECONE_INDEX || 'leads';
    pineconeIndex = pinecone.index(indexName);
  } catch (err) {
    console.error('⚠️ Pinecone RAG initialization error:', err.message);
  }
}

/**
 * Splits raw document text into chunks of ~300 words (representing ~400 tokens)
 * with a ~38-word (~50 tokens) overlap to retain context across chunk boundaries.
 */
function chunkText(text, maxTokens = 400, overlap = 50) {
  const words = text.trim().split(/\s+/);
  const chunks = [];
  const chunkSize = Math.round(maxTokens * 0.75); // ~300 words
  const overlapSize = Math.round(overlap * 0.75); // ~38 words

  if (words.length <= chunkSize) {
    return [text];
  }

  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length);
    const chunkWords = words.slice(start, end);
    chunks.push(chunkWords.join(' '));

    if (end === words.length) break;
    start = start + chunkSize - overlapSize;
  }

  return chunks;
}

/**
 * Encodes text into a 1536-dimensional OpenAI vector embedding.
 */
async function getEmbedding(text) {
  if (!openai) throw new Error('OpenAI key is missing');
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return response.data[0].embedding;
}

/**
 * Dynamic keyword relevance search for Mock Mode.
 * Scans DB and computes word overlap frequency against tenant knowledge base.
 */
async function calculateMockKeywordRetrieval(tenantId, queryText) {
  const sql = 'SELECT * FROM knowledge_base WHERE tenant_id = $1';
  const res = await query(sql, [tenantId], false);
  const chunks = res.rows;

  if (chunks.length === 0) return [];

  // Exclude tiny search words
  const queryWords = queryText.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const matches = [];

  for (const chunk of chunks) {
    const contentLower = chunk.content.toLowerCase();
    let matchCount = 0;

    for (const word of queryWords) {
      if (contentLower.includes(word)) {
        matchCount++;
      }
    }

    if (matchCount > 0) {
      matches.push({
        id: chunk.id,
        source: chunk.source,
        type: chunk.type,
        content: chunk.content,
        similarity: parseFloat(Math.min(0.95, 0.4 + (matchCount / queryWords.length) * 0.5).toFixed(4)),
      });
    }
  }

  // Sort descending and return top-3 matching segments
  return matches.sort((a, b) => b.similarity - a.similarity).slice(0, 3);
}

/**
 * Ingestion pipeline to chunk uploaded document text and save chunks.
 */
async function ingestDocument(tenantId, source, type, text) {
  const chunks = chunkText(text, 400, 50);
  const savedChunks = [];

  for (const chunk of chunks) {
    // 1. Persist chunk records inside PostgreSQL database (bypassing active RLS)
    const sql = `
      INSERT INTO knowledge_base (tenant_id, source, type, content)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;
    const res = await query(sql, [tenantId, source, type, chunk]);
    const chunkRecord = res.rows[0];
    savedChunks.push(chunkRecord);

    // 2. Embed and upload vectors to tenant's namespaced Pinecone index in Live Mode
    if (openai && pineconeIndex) {
      try {
        const vector = await getEmbedding(chunk);
        await pineconeIndex.namespace(tenantId).upsert([{
          id: chunkRecord.id, // Vector ID maps exactly to SQL record UUID
          values: vector,
          metadata: {
            tenant_id: tenantId,
            source,
            type,
            content: chunk,
          },
        }]);
      } catch (err) {
        console.error(`[RAG Pinecone Ingestion Error] Upsert failed for chunk ${chunkRecord.id}:`, err.message);
      }
    }
  }

  return { source, chunks: savedChunks.length };
}

/**
 * Retrieval pipeline to fetch top-3 grounded chunks matching the query context.
 */
async function retrieveContext(tenantId, queryText) {
  // Direct fallback to keyword overlap matches if keys are missing
  if (!openai || !pineconeIndex) {
    return calculateMockKeywordRetrieval(tenantId, queryText);
  }

  try {
    const queryVector = await getEmbedding(queryText);

    // Query Pinecone scoped strictly by namespace = tenantId
    const results = await pineconeIndex.namespace(tenantId).query({
      vector: queryVector,
      topK: 3,
      includeMetadata: true,
    });

    return (results.matches || []).map(match => ({
      id: match.id,
      source: match.metadata?.source || 'unknown',
      type: match.metadata?.type || 'unknown',
      content: match.metadata?.content || '',
      similarity: match.score || 0.0,
    }));
  } catch (err) {
    console.error('[RAG Retrieval Error] Falling back to keyword search:', err.message);
    return calculateMockKeywordRetrieval(tenantId, queryText);
  }
}

module.exports = {
  ingestDocument,
  retrieveContext,
  chunkText,
  calculateMockKeywordRetrieval,
};
