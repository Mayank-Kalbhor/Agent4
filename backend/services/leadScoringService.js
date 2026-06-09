const { OpenAI } = require('openai');
const { Pinecone } = require('@pinecone-database/pinecone');
const { query } = require('../db/db');

// Default Ideal Customer Profile (ICP) for fallback and mock checks
const DEFAULT_ICP = {
  titles: ['vp', 'director', 'cto', 'ceo', 'founder', 'manager'],
  industries: ['tech', 'software', 'saas', 'finance', 'healthcare'],
  companySizes: ['10-50', '51-200', '201-500'],
  painPoints: ['pipeline automation', 'lead capture', 'sales conversion', 'automated outreach'],
};

// Initialize OpenAI client if API key is set
let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
} else {
  console.log('ℹ️ Lead Scoring Service running in MOCK mode (Rule-based keyword evaluation)');
}

// Initialize Pinecone client if API key is set
let pineconeIndex = null;
if (process.env.PINECONE_API_KEY) {
  try {
    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    const indexName = process.env.PINECONE_INDEX || 'leads';
    pineconeIndex = pinecone.index(indexName);
  } catch (err) {
    console.error('⚠️ Pinecone initialization error:', err.message);
  }
}

/**
 * Executes a function with exponential backoff and jitter for handling rate limits (HTTP 429).
 */
async function callWithRetry(fn, maxRetries = 5) {
  let delay = 1000;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err.status === 429 || 
                          (err.message && (err.message.includes('429') || err.message.toLowerCase().includes('rate limit')));
      if (isRateLimit && attempt < maxRetries) {
        const jitter = Math.random() * 500;
        console.warn(`[API Rate Limit] Attempt ${attempt} failed. Retrying in ${Math.round(delay + jitter)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay + jitter));
        delay *= 2;
      } else {
        throw err;
      }
    }
  }
}

/**
 * Builds a descriptive text string representing the target Ideal Customer Profile (ICP).
 */
function getIcpText(icp) {
  const activeIcp = icp || DEFAULT_ICP;
  const titles = (activeIcp.titles || []).join(', ');
  const industries = (activeIcp.industries || []).join(', ');
  const sizes = (activeIcp.companySizes || []).join(', ');
  const painPoints = (activeIcp.painPoints || []).join(', ');
  return `Target ICP Profile job titles: ${titles}. Key industries/companies: ${industries}. Company size brackets: ${sizes}. Specific client pain points: ${painPoints}.`;
}

/**
 * Builds a descriptive text string representing a Lead's characteristics.
 */
function getLeadText(lead) {
  const companySize = lead.enrichment_data?.company_size || '';
  return `Lead Details: Name: ${lead.name || ''}. Job Title: ${lead.title || ''}. Company: ${lead.company || ''}. Industry: ${lead.company || ''}. Size: ${companySize}. Notes and Pain Points: ${lead.notes || ''}.`;
}

/**
 * Fetches OpenAI text embedding vector (dimension 1536) for a given text.
 */
async function getEmbedding(text) {
  if (!openai) throw new Error('OpenAI key is missing');
  return callWithRetry(async () => {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  });
}

/**
 * Computes cosine similarity between two numeric vectors.
 */
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0.0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Upserts a lead embedding vector into a namespaced Pinecone index.
 */
async function upsertLeadVector(tenantId, leadId, vector, metadata = {}) {
  if (!pineconeIndex) return;
  try {
    await callWithRetry(async () => {
      await pineconeIndex.namespace(tenantId).upsert([{
        id: leadId,
        values: vector,
        metadata
      }]);
    });
  } catch (err) {
    console.error(`[Pinecone Upsert Warning] Lead vector indexing failed for ${leadId}:`, err.message);
  }
}

/**
 * Realistically and deterministically calculates lead-ICP similarity using keyword rules.
 * Fails over to this when API credentials are not set.
 */
function calculateMockScore(lead, icp) {
  const activeIcp = icp || DEFAULT_ICP;
  let matches = 0;

  const title = (lead.title || '').toLowerCase();
  const company = (lead.company || '').toLowerCase();
  const notes = (lead.notes || '').toLowerCase();

  if (activeIcp.titles && activeIcp.titles.length > 0) {
    if (activeIcp.titles.some(t => title.includes(t.toLowerCase()))) matches++;
  }

  if (activeIcp.industries && activeIcp.industries.length > 0) {
    if (activeIcp.industries.some(ind => company.includes(ind.toLowerCase()) || title.includes(ind.toLowerCase()))) matches++;
  }

  if (activeIcp.painPoints && activeIcp.painPoints.length > 0) {
    if (activeIcp.painPoints.some(p => notes.includes(p.toLowerCase()))) matches++;
  }

  // Adjusted keyword weights so 1 match = 0.65 (Medium), 2 matches = 0.80 (High), 3 matches = 0.95 (High), 0 matches = 0.50 (Low)
  let similarity = 0.50;
  if (matches > 0) {
    similarity += matches * 0.15;
  }
  
  similarity = parseFloat(Math.min(0.95, Math.max(0.35, similarity)).toFixed(4));

  let score = 'low';
  let rationale = `Similarity score: ${similarity}. Lead shows weak keyword alignment with active ICP setting.`;

  if (similarity >= 0.8) {
    score = 'high';
    rationale = `Similarity score: ${similarity}. Strong keyword overlap matching job titles and pain points.`;
  } else if (similarity >= 0.6) {
    score = 'medium';
    rationale = `Similarity score: ${similarity}. Moderate keyword overlap matching ideal customer segment.`;
  }

  return { score, similarity, rationale };
}

/**
 * Main function to evaluate and score an individual lead.
 */
async function scoreLead(tenantId, lead, explicitIcp = null) {
  let icp = explicitIcp;
  if (!icp) {
    const tenants = await query('SELECT settings FROM tenants WHERE id = $1', [tenantId], false);
    icp = tenants.rows[0]?.settings?.icp || DEFAULT_ICP;
  }

  // Fallback to rule-based mock engine if API credentials are not active
  if (!openai) {
    return calculateMockScore(lead, icp);
  }

  try {
    const icpText = getIcpText(icp);
    const icpEmbedding = await getEmbedding(icpText);

    const leadText = getLeadText(lead);
    const leadEmbedding = await getEmbedding(leadText);

    const similarity = parseFloat(cosineSimilarity(leadEmbedding, icpEmbedding).toFixed(4));

    let score = 'low';
    let rationale = `Vector similarity: ${similarity}. Core profile characteristics score below target ICP thresholds.`;

    if (similarity >= 0.8) {
      score = 'high';
      rationale = `Vector similarity: ${similarity}. Outstanding match with high semantic priority ranking.`;
    } else if (similarity >= 0.6) {
      score = 'medium';
      rationale = `Vector similarity: ${similarity}. Stable semantic profile alignment with ideal SaaS segment.`;
    }

    // Attempt backend Pinecone vector index checkout in background
    upsertLeadVector(tenantId, lead.id, leadEmbedding, {
      tenant_id: tenantId,
      lead_id: lead.id,
      name: lead.name || '',
      score
    }).catch(() => {});

    return { score, similarity, rationale };
  } catch (err) {
    console.error('AI Vector Lead Scoring failed, using deterministic keyword fallback:', err.message);
    return calculateMockScore(lead, icp);
  }
}

/**
 * Processes list of leads in concurrent chunks of 20.
 */
async function scoreLeadsBatch(tenantId, leads, explicitIcp = null) {
  const results = [];
  const chunkSize = 20;

  for (let i = 0; i < leads.length; i += chunkSize) {
    const chunk = leads.slice(i, i + chunkSize);

    const chunkPromises = chunk.map(async (lead) => {
      const scoring = await module.exports.scoreLead(tenantId, lead, explicitIcp);
      return { lead, scoring };
    });

    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);
  }

  return results;
}

/**
 * Re-scores all leads for a tenant inside a transactional atomic execution.
 */
async function rescoreAllTenantLeads(tenantId, updatedIcp) {
  const leadsRes = await query('SELECT * FROM leads WHERE tenant_id = $1', [tenantId], false);
  const leads = leadsRes.rows;

  if (leads.length === 0) {
    return { rescored: 0 };
  }

  // Generate scores for all records in parallel chunks of 20
  const scoringResults = await module.exports.scoreLeadsBatch(tenantId, leads, updatedIcp);

  // Update leads database records in transactional pipeline
  const { pool } = require('../db/db');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const res of scoringResults) {
      const { id, enrichment_data } = res.lead;
      const { score, similarity, rationale } = res.scoring;

      const currentEnrichment = enrichment_data || {};
      const updatedEnrichment = {
        ...currentEnrichment,
        ai_score_reason: rationale,
        similarity
      };

      const updateSql = `
        UPDATE leads
        SET score = $1, similarity = $2, enrichment_data = $3
        WHERE id = $4 AND tenant_id = $5
      `;
      await client.query(updateSql, [
        score,
        similarity,
        JSON.stringify(updatedEnrichment),
        id,
        tenantId
      ]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { rescored: leads.length };
}

module.exports = {
  scoreLead,
  scoreLeadsBatch,
  rescoreAllTenantLeads,
  cosineSimilarity,
  DEFAULT_ICP
};
