const { OpenAI } = require('openai');
const { query } = require('../db/db');

// Initialize OpenAI client if API key is set
let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
} else {
  console.log('ℹ️ Email Generation Service running in MOCK mode (Template-based generation)');
}

// Default A/B Templates for rule-based mock generation
const TEMPLATES = {
  initial_outreach: {
    A: {
      subject: 'Quick question regarding {company}',
      body: 'Hi {name},\n\nI noticed you are working as {title} at {company}. Keeping sales pipelines full can be demanding. Our platform automates lead capturing and follow-ups in the background so your team can focus on closing deals.\n\nDo you have 10 minutes for a brief chat next Tuesday?',
    },
    B: {
      subject: '{title} role at {company}',
      body: 'Hi {name},\n\nAs the {title} at {company}, you know how vital clean pipeline operations are. We help SaaS teams capture, score, and automate follow-ups with high-priority leads automatically.\n\nCould we jump on a quick call this Thursday?',
    },
  },
  follow_up_1: {
    A: {
      subject: 'Re: Quick question regarding {company}',
      body: 'Hi {name},\n\nFollowing up on my note about {pain_point}.\n\nAre you free for 5 minutes this week?',
    },
    B: {
      subject: 'Re: {title} role at {company}',
      body: 'Hi {name},\n\nFollowing up on my note about {pain_point}.\n\nAre you free for 5 minutes this week?',
    },
  },
  follow_up_2: {
    A: {
      subject: 'Following up on lead capture',
      body: 'Hi {name},\n\nI know you\'re busy at {company}. I wanted to see if pipeline automation is on your roadmap this quarter.\n\nDo you have time for a brief chat?',
    },
    B: {
      subject: 'Lead workflow at {company}',
      body: 'Hi {name},\n\nI\'m following up on my previous note. Our AI helps reps prioritize and follow up on leads automatically.\n\nWorth a 5-minute call?',
    },
  },
  breakup: {
    A: {
      subject: 'Moving on from {company}',
      body: 'Hi {name},\n\nIt seems this isn\'t the right time to connect. I will stop reaching out. If pipeline automation becomes a priority in the future, let me know.\n\nAll the best.',
    },
    B: {
      subject: 'Closing the file - {company}',
      body: 'Hi {name},\n\nI\'ve tried connecting a few times but haven\'t heard back, so I assume this isn\'t a priority right now. I\'ll close our correspondence.\n\nWish you much success.',
    },
  },
};

/**
 * Handles exponential backoff and retries for OpenAI API calls (HTTP 429).
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
 * Filters generated text for hallucinated company references and strips/corrects them.
 */
function applyHallucinationGuard(body, lead, sender) {
  let cleanBody = body;
  let flagged = false;
  const rationale = [];

  // Match potential company name indicators
  const companyMentions = cleanBody.match(/\b[A-Za-z0-9]+\s+(Technologies|Inc|Corp|LLC|Software|Group|Co|SaaS)\b/gi) || [];
  
  for (const mention of companyMentions) {
    const cleanMention = mention.trim().toLowerCase();
    const leadCompany = (lead.company || '').toLowerCase();
    const senderCompany = (sender.companyName || '').toLowerCase();
    
    // Check if the company referenced matches neither the lead's nor sender's company
    const matchesLead = leadCompany && (leadCompany.includes(cleanMention) || cleanMention.includes(leadCompany));
    const matchesSender = senderCompany && (senderCompany.includes(cleanMention) || cleanMention.includes(senderCompany));
    
    if (!matchesLead && !matchesSender) {
      cleanBody = cleanBody.replace(mention, lead.company || 'your organization');
      flagged = true;
      rationale.push(`Hallucination Guard: Replaced ungrounded company reference '${mention}' with lead's company.`);
    }
  }

  // Reject generic openers if present
  const genericOpeners = [
    /hope this finds you well/i,
    /hope you are doing well/i,
    /hope you are doing great/i,
    /hope this email finds you well/i
  ];

  for (const opener of genericOpeners) {
    if (opener.test(cleanBody)) {
      cleanBody = cleanBody.replace(opener, '');
      flagged = true;
      rationale.push('Hallucination Guard: Stripped generic email opener.');
    }
  }

  return { cleanBody, flagged, rationale: rationale.join(' ') };
}

/**
 * Generates outreach emails using lead and sender data (Mock Mode).
 * Evaluates alternating A/B template brackets.
 */
function generateMockEmail(lead, sender, template_type, version) {
  const templates = TEMPLATES[template_type] || TEMPLATES.initial_outreach;
  const activeTemplate = templates[version] || templates.A;

  let subject = activeTemplate.subject;
  let body = activeTemplate.body;

  // Interpolate fields safely
  const company = lead.company || 'your organization';
  const name = lead.name || 'there';
  const title = lead.title || 'team member';
  
  // Resolve pain point (use first array element or notes, defaulting to 'lead follow-up')
  const painPointsList = lead.painPoints || [];
  const pain_point = Array.isArray(lead.painPoints) && lead.painPoints.length > 0 ? lead.painPoints.join(' and ') : 'lead follow-up';

  subject = subject.replace(/{company}/g, company).replace(/{name}/g, name).replace(/{title}/g, title);
  body = body.replace(/{company}/g, company).replace(/{name}/g, name).replace(/{title}/g, title).replace(/{pain_point}/g, pain_point);

  // Set mock confidence score (Breakups trigger human review with < 0.7 score)
  const confidence_score = template_type === 'breakup' ? 0.65 : 0.92;
  const rationale = `Mock Engine CoT Analysis: Target has title ${title} at company ${company}. Pain point: ${pain_point}. Version ${version} matching CTA rules.`;

  return { subject, body, confidence_score, rationale };
}

/**
 * Primary function to compose a highly targeted outreach draft.
 */
async function generateEmail(lead, sender, template_type, previous_emails = []) {
  // Retrieve active tenantId context from AsyncLocalStorage
  const { tenantStorage } = require('../db/db');
  const { retrieveContext } = require('./ragService');
  
  const store = tenantStorage.getStore();
  const tenantId = store ? store.tenantId : null;

  // 1. Fetch grounded RAG context segments from tenant's knowledge base
  let contextChunks = [];
  if (tenantId) {
    const queryText = `${lead.title || ''} ${lead.company || ''} ${lead.notes || ''} ${Array.isArray(lead.painPoints) ? lead.painPoints.join(' ') : (lead.painPoints || '')}`;
    try {
      contextChunks = await retrieveContext(tenantId, queryText);
    } catch (err) {
      console.error('⚠️ RAG context retrieval warning:', err.message);
    }
  }
  const source_ids = contextChunks.map(chunk => chunk.id);

  // Determine A/B test version systematically (A vs B)
  const version = Math.random() < 0.5 ? 'A' : 'B';
  const template_version = `v1-${version}`;

  if (!openai) {
    const mockDraft = generateMockEmail(lead, sender, template_type, version);
    const { cleanBody, flagged, rationale: guardRationale } = applyHallucinationGuard(mockDraft.body, lead, sender);
    
    let rationale = mockDraft.rationale;
    if (contextChunks.length > 0) {
      rationale += ` | Grounded in knowledge source: ${contextChunks[0].source} (ID: ${contextChunks[0].id})`;
    }

    return {
      subject: mockDraft.subject,
      body: cleanBody.trim(),
      confidence_score: flagged ? 0.60 : mockDraft.confidence_score,
      template_version,
      rationale: rationale + (guardRationale ? ` | ${guardRationale}` : ''),
      source_ids,
    };
  }

  // Format RAG chunks context block for injection
  let contextSnippet = '';
  if (contextChunks.length > 0) {
    contextSnippet = "\n\nRetrieved grounding context from company documents:\n" +
      contextChunks.map((chunk, i) => `[Source ID: ${chunk.id}, File: ${chunk.source}] ${chunk.content}`).join('\n') +
      "\nEnsure any claims made in the email copy are strictly grounded in these company facts. Avoid hallucinating unconfirmed offers.";
  }

  const systemPrompt = `You are a targeted B2B SaaS outreach generator.
You must construct the generated email in valid JSON format matching this schema:
{
  "rationale": "Identify lead's role and notes/pain points first, analyzing their challenges BEFORE drafting the email.",
  "subject": "Compelling subject line specifically referencing the lead's company or role, avoiding generic hooks",
  "body": "Personalized email copy specifically referencing the lead's role/company, ending with a single soft CTA",
  "confidence_score": 0.95
}

Constraints:
1. Identify the lead's pain point in the "rationale" BEFORE writing the email copy (Chain-of-thought).
2. Avoid generic openers like 'I hope this finds you well', 'Hope you are doing great', 'Hope this email finds you well'. Start directly with a relevant observation about their company or role.
3. Length constraint: Initial outreach emails MUST be under 100 words. Follow-up or breakup emails MUST be under 60 words.
4. End with exactly one single, soft Call to Action (CTA) (e.g. asking for a brief 5-10 minute call, or if this is on their roadmap).
5. Ensure all claims about the sender's offering are strictly grounded in their value proposition.${contextSnippet}

Context:
Lead: ${JSON.stringify(lead)}
Sender: ${JSON.stringify(sender)}
Template Type: ${template_type}
Previous Emails: ${JSON.stringify(previous_emails)}
`;

  try {
    const response = await callWithRetry(async () => {
      return await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'system', content: systemPrompt }],
        response_format: { type: 'json_object' },
      });
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    
    // Pass output through hallucination guard
    const { cleanBody, flagged, rationale: guardRationale } = applyHallucinationGuard(parsed.body, lead, sender);
    
    let confidence = parsed.confidence_score || 0.85;
    if (flagged) {
      confidence = Math.min(0.65, confidence - 0.20);
    }

    // Word count validation
    const words = cleanBody.split(/\s+/).length;
    const isInitial = template_type === 'initial_outreach';
    const limit = isInitial ? 100 : 60;
    if (words > limit) {
      confidence = Math.min(0.68, confidence); // lower confidence if word counts are violated
    }

    return {
      subject: parsed.subject,
      body: cleanBody.trim(),
      confidence_score: confidence,
      template_version,
      rationale: parsed.rationale + (guardRationale ? ` | ${guardRationale}` : ''),
      source_ids,
    };
  } catch (err) {
    console.error('GPT-4 email generation failed, falling back to rule-based template builder:', err.message);
    const mockDraft = generateMockEmail(lead, sender, template_type, version);
    return {
      subject: mockDraft.subject,
      body: mockDraft.body.trim(),
      confidence_score: mockDraft.confidence_score,
      template_version,
      rationale: mockDraft.rationale + ` | Fallback Triggered: ${err.message}`,
      source_ids,
    };
  }
}

module.exports = {
  generateEmail,
  applyHallucinationGuard,
  TEMPLATES,
};
