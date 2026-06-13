const { OpenAI } = require('openai');
const { query } = require('../db/db');
const { retrieveContext } = require('./ragService');

// Initialize OpenAI client if API key is set
let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

/**
 * Main service method to generate responses for the AI Sales Copilot
 * @param {string} tenantId - The authenticated tenant ID
 * @param {string} message - The user's prompt
 * @param {Array} history - Array of previous chat messages: [{ role: 'user' | 'assistant', content: string }]
 */
async function generateResponse(tenantId, message, history = []) {
  // 1. Fetch leads context for this tenant
  const leadsCountRes = await query('SELECT COUNT(*)::int as count FROM leads WHERE tenant_id = $1', [tenantId], false);
  const totalLeads = leadsCountRes.rows[0]?.count || 0;

  const leadsScoreRes = await query(
    'SELECT score, COUNT(*)::int as count FROM leads WHERE tenant_id = $1 GROUP BY score',
    [tenantId],
    false
  );
  const scoreCounts = { high: 0, medium: 0, low: 0 };
  leadsScoreRes.rows.forEach(r => {
    if (r.score && scoreCounts[r.score.toLowerCase()] !== undefined) {
      scoreCounts[r.score.toLowerCase()] = r.count;
    }
  });

  const topLeadsRes = await query(
    "SELECT name, company, email, score, status FROM leads WHERE tenant_id = $1 ORDER BY CASE WHEN score = 'high' THEN 1 WHEN score = 'medium' THEN 2 ELSE 3 END ASC, created_at DESC LIMIT 5",
    [tenantId],
    false
  );
  const topLeads = topLeadsRes.rows || [];

  // 2. Fetch upcoming meetings context
  const meetingsRes = await query(
    `SELECT m.scheduled_at, COALESCE(m.meeting_metadata->>'title', 'Scheduled Meeting') as title, l.name as lead_name 
     FROM meetings m 
     JOIN leads l ON m.lead_id = l.id 
     WHERE m.tenant_id = $1 AND m.scheduled_at >= NOW() 
     ORDER BY m.scheduled_at ASC 
     LIMIT 5`,
    [tenantId],
    false
  );
  const upcomingMeetings = meetingsRes.rows || [];

  // 3. Fetch RAG knowledge base context matching the message
  const ragContext = await retrieveContext(tenantId, message);

  // Determine if we run in LIVE or MOCK mode
  if (openai) {
    return runLiveCompletion(message, history, {
      totalLeads,
      scoreCounts,
      topLeads,
      upcomingMeetings,
      ragContext,
    });
  } else {
    return runMockCompletion(message, {
      totalLeads,
      scoreCounts,
      topLeads,
      upcomingMeetings,
      ragContext,
    });
  }
}

/**
 * Live completion via OpenAI GPT API
 */
async function runLiveCompletion(message, history, context) {
  const formattedLeads = context.topLeads
    .map(l => `- **${l.name}** (${l.company}) - Score: ${l.score}, Status: ${l.status}`)
    .join('\n');

  const formattedMeetings = context.upcomingMeetings
    .map(m => `- **${m.title || 'Scheduled Meeting'}** with ${m.lead_name} at ${new Date(m.scheduled_at).toLocaleString()}`)
    .join('\n');

  const formattedRag = context.ragContext
    .map((chunk, i) => `[Document ${i + 1} - Source: ${chunk.source}]\n${chunk.content}`)
    .join('\n\n');

  const systemPrompt = `You are the AI Sales Copilot, an expert virtual assistant integrated directly into the CRM portal of a Multi-Tenant AI Sales SaaS.
Your job is to assist sales representatives and administrators by answering questions, summarizing leads, checking upcoming meetings, recommending sales processes, or retrieving internal documents.

Here is the live contextual data for the active Tenant:
- **Total Leads in CRM:** ${context.totalLeads} (High: ${context.scoreCounts.high}, Medium: ${context.scoreCounts.medium}, Low: ${context.scoreCounts.low})
- **Top / Important Leads:**
${formattedLeads || 'No leads in CRM currently.'}
- **Upcoming Scheduled Meetings:**
${formattedMeetings || 'No meetings scheduled in the future.'}

Here is the relevant grounded knowledge retrieved from the tenant's uploaded knowledge base (RAG):
${formattedRag || 'No relevant internal documents matched.'}

Instructions:
1. Always base your answers on the provided context where appropriate.
2. If the user asks about pricing, support, features, or company-specific policies, utilize the RAG documents above.
3. If they ask about lead prioritization or metrics, use the CRM lead numbers above.
4. Keep your replies concise, helpful, and highly structured (use markdown bullet points, tables, and bold formatting).
5. If the knowledge base or CRM data doesn't contain the answer, answer politely based on general sales best practices while noting that specific records were not found.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: message }
  ];

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.7,
      max_tokens: 500,
    });
    return response.choices[0]?.message?.content || 'Sorry, I encountered an issue generating a response.';
  } catch (err) {
    console.error('[AI Assistant OpenAI Error]:', err.message);
    throw err;
  }
}

/**
 * Mock completion using rule-based keyword routing
 */
function runMockCompletion(message, context) {
  const msgLower = message.toLowerCase();

  // Route 1: Leads and prospects
  if (msgLower.includes('lead') || msgLower.includes('prospect') || msgLower.includes('contact')) {
    let reply = `Based on your CRM data, you have **${context.totalLeads}** total leads. Here is a breakdown by score:\n`;
    reply += `- **High Priority:** ${context.scoreCounts.high}\n`;
    reply += `- **Medium Priority:** ${context.scoreCounts.medium}\n`;
    reply += `- **Low Priority:** ${context.scoreCounts.low}\n\n`;

    if (context.topLeads.length > 0) {
      reply += `### Top High-Priority Leads\n\n`;
      reply += `| Name | Company | Email | Score | Status |\n`;
      reply += `|---|---|---|---|---|\n`;
      context.topLeads.forEach(l => {
        reply += `| **${l.name}** | ${l.company} | ${l.email} | \`${l.score.toUpperCase()}\` | *${l.status}* |\n`;
      });
      reply += `\nWould you like me to draft an email or a WhatsApp outreach message for any of these leads?`;
    } else {
      reply += `There are currently no leads registered in your pipeline.`;
    }
    return reply;
  }

  // Route 2: Meetings
  if (msgLower.includes('meeting') || msgLower.includes('schedule') || msgLower.includes('calendar') || msgLower.includes('appointment')) {
    let reply = `Checking your calendar... You have **${context.upcomingMeetings.length}** upcoming meetings scheduled:\n\n`;

    if (context.upcomingMeetings.length > 0) {
      context.upcomingMeetings.forEach((m, idx) => {
        const dateStr = new Date(m.scheduled_at).toLocaleString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short'
        });
        reply += `${idx + 1}. **${m.title || 'Scheduled Meeting'}** with *${m.lead_name}* on \`${dateStr}\`\n`;
      });
      reply += `\nI can help you review lead details or draft pre-meeting research briefs. Let me know what you need!`;
    } else {
      reply += `No meetings found in the calendar. You can schedule new meetings with your leads from the Lead Manager tab.`;
    }
    return reply;
  }

  // Route 3: RAG Grounded Query
  if (context.ragContext.length > 0) {
    const primaryDoc = context.ragContext[0];
    let reply = `Here is what I found in our internal knowledge base (from document **${primaryDoc.source}**):\n\n`;
    reply += `> ${primaryDoc.content.trim()}\n\n`;
    if (context.ragContext.length > 1) {
      reply += `Additional context found in **${context.ragContext[1].source}**:\n`;
      reply += `> ${context.ragContext[1].content.trim()}\n\n`;
    }
    reply += `I hope this helps! Let me know if you need any other details.`;
    return reply;
  }

  // Route 4: General Helper Fallback
  return `Hello! I am your **AI Sales Copilot**. I have access to your leads database, meeting calendar, and uploaded knowledge documents.

You can ask me questions like:
- "Who are my top leads right now?"
- "Do I have any meetings coming up?"
- "How can we refine our ICP settings?" (or other knowledge base topics)

Feel free to write a message below and I'll assist you!`;
}

module.exports = {
  generateResponse,
};
