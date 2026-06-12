const { generateEmail } = require('../services/emailGenerationService');

// 10 Fixture Leads spanning different companies, roles, and pain points
const fixtureLeads = [
  { name: 'John Doe', company: 'Stripe', title: 'VP of Engineering', painPoints: ['pipeline bottlenecks'] },
  { name: 'Alice Smith', company: 'Netflix', title: 'Director of DevOps', painPoints: ['manual deployments'] },
  { name: 'Bob Johnson', company: 'Google', title: 'Tech Lead', painPoints: ['developer velocity'] },
  { name: 'Emily Davis', company: 'FastGrowth', title: 'CEO', painPoints: ['outreach response rates'] },
  { name: 'Charlie Brown', company: 'Innovate Labs', title: 'CTO', painPoints: ['cold emailing latency'] },
  { name: 'David Lee', company: 'FinTech', title: 'VP Product', painPoints: ['customer segmentation'] },
  { name: 'Sarah Connor', company: 'Cyberdyne', title: 'VP Operations', painPoints: ['identity access management'] },
  { name: 'Bruce Wayne', company: 'Wayne Enterprises', title: 'CEO', painPoints: ['supplier delays'] },
  { name: 'Tony Stark', company: 'Stark Industries', title: 'Chief Architect', painPoints: ['parallel database queries'] },
  { name: 'Walter White', company: 'BreakingTech', title: 'Chief Chemist', painPoints: ['chemical quality metrics'] }
];

const sender = {
  companyName: 'AI Sales Agent SaaS',
  senderName: 'Sales Specialist'
};

// Mock RAG retrieval for evaluation purposes
jest.mock('../services/ragService', () => ({
  retrieveContext: jest.fn().mockResolvedValue([]),
}));

describe('AI Email Generation Fixtures Evaluation', () => {
  fixtureLeads.forEach((lead, index) => {
    it(`should successfully validate formatting for Lead #${index + 1}: ${lead.name} (${lead.company})`, async () => {
      const draft = await generateEmail(lead, sender, 'initial_outreach');
      
      const { subject, body } = draft;

      // 1. Assert subject line is strictly under 60 characters
      expect(subject.length).toBeLessThan(60);

      // 2. Assert no unfilled variables in subject or body (e.g. no {company} or {name})
      const variablePattern = /{[a-zA-Z0-9_]+}/;
      expect(subject).not.toMatch(variablePattern);
      expect(body).not.toMatch(variablePattern);

      // 3. Assert no hallucinated company names
      // Extract matches of company name patterns (e.g. Stripe, Wayne Enterprises, Stark Industries)
      const companyMentions = body.match(/\b[A-Za-z0-9]+\s+(Technologies|Inc|Corp|LLC|Software|Group|Co|SaaS)\b/gi) || [];
      companyMentions.forEach(mention => {
        const lowerMention = mention.toLowerCase();
        const leadCompany = lead.company.toLowerCase();
        const senderCompany = sender.companyName.toLowerCase();
        
        const isAllowed = lowerMention.includes(leadCompany) || 
                          leadCompany.includes(lowerMention) ||
                          lowerMention.includes(senderCompany) || 
                          senderCompany.includes(lowerMention) ||
                          lowerMention.includes('your organization');
                          
        expect(isAllowed).toBe(true);
      });
    });
  });
});
