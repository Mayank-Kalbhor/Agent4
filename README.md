# AGENT4 SaaS (Local Prototype)

A high-performance, multi-tenant AGENT4 SaaS platform designed to automate lead ingestion, AI lead scoring, RAG-grounded personalized outreach, and A/B campaign execution with a built-in human-in-the-loop approval mechanism. 

---

## 🚀 Key Features

*   **Multi-Tenant Isolation (PostgreSQL RLS)**: Uses native Row-Level Security combined with an automated query rewriter and dynamic Express session context via Node `AsyncLocalStorage`.
*   **AI Lead Scoring**: Computes cosine similarity of lead profiles against tenant-specific Ideal Customer Profiles (ICP) using OpenAI embeddings and Pinecone namespaces (with a keyword-based rule fallback for offline mode).
*   **RAG Ingestion & Retrieval**: Splits knowledge documents (PDFs/TXTs) into chunks, generates vector embeddings, indexes them into tenant-specific namespaces, and injects grounded context into outreach emails.
*   **Personalized Email Generation**: Employs GPT-4 with a Chain-of-Thought (CoT) system to generate targeted emails constrained to <100 words. Generates A/B versions and includes a custom **Hallucination Guard** to filter generic openers and invalid company claims.
*   **Human-in-the-Loop Review**: Automatically queues low-confidence emails (confidence score < 0.70) as `pending_review` for manual agent approval.
*   **Meeting Webhooks & Simulation**: Integrated booking link webhook (e.g. for Calendly) that auto-correlates inbound meetings to matching leads, plus developer simulators for incoming replies.

---

## 🛠️ Technology Stack

*   **Frontend**: React, Vite, TailwindCSS, PostCSS
*   **Backend**: Node.js, Express.js, PostgreSQL (`pg`), OpenAI API, Pinecone Client
*   **Database Utilities**: Dynamic schema self-healing, custom SQL RLS interceptor

---

## 📂 Repository Structure

```text
├── backend/
│   ├── db/
│   │   └── db.js                       # Connection pool, query wrapper & RLS injector
│   ├── middleware/
│   │   └── tenantIsolation.js          # JWT tenant verification & AsyncLocalStorage hook
│   ├── services/
│   │   ├── emailGenerationService.js   # GPT-4 / template-based drafts + Hallucination Guard
│   │   ├── leadScoringService.js       # Cosine similarity and semantic ICP evaluator
│   │   └── ragService.js               # Document chunking, Pinecone indexing, and context retriever
│   ├── tests/                          # Automated backend test suites
│   ├── server.js                       # Main Express app, REST API definitions
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx                     # Dashboard, settings, RAG, and leads panels
│   │   ├── main.jsx
│   │   └── index.css
│   ├── package.json
│   ├── tailwind.config.js
│   └── vite.config.js
├── schema.sql                          # Multi-tenant base PostgreSQL schema with RLS policies
├── seed.sql                            # Sample data (tenants, leads, reps, messages, activity)
├── package.json                        # Root package runner script
└── README.md
```

---

## ⚙️ Setup & Installation

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [PostgreSQL](https://www.postgresql.org/) (configured and running)

### 2. Database Initialization
1. Create a database in PostgreSQL (e.g., `ai_sales_agent`).
2. Run the migration script [schema.sql](file:///C:/Users/Mayan/OneDrive/Desktop/Agent4/schema.sql) to set up tables, RLS policies, indexes, and triggers:
   ```bash
   psql -U postgres -d ai_sales_agent -f schema.sql
   ```
3. (Optional) Populate the database with test data using [seed.sql](file:///C:/Users/Mayan/OneDrive/Desktop/Agent4/seed.sql):
   ```bash
   psql -U postgres -d ai_sales_agent -f seed.sql
   ```

### 3. Environment Configuration
Create a `.env` file in the **backend** directory (and/or copy it to the root).

**Backend Environment Variables (`backend/.env`):**
```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_sales_agent
JWT_SECRET=sales_agent_super_secret_token
PORT=5000

# (Optional) For AI Services. If missing, services run in rule-based/template MOCK mode:
OPENAI_API_KEY=your-openai-api-key
PINECONE_API_KEY=your-pinecone-api-key
PINECONE_INDEX=leads
```

### 4. Install Dependencies & Run

To install dependencies for both frontend and backend directories, run from the root:
```bash
npm run install-all
```

To run both the backend server and frontend client concurrently:
```bash
npm run dev
```

*   **Backend Server**: [http://localhost:5000](http://localhost:5000)
*   **Vite Frontend Client**: [http://localhost:5173](http://localhost:5173)

---

## 🛡️ Multi-Tenant Architecture & RLS

Tenant security and database isolation are enforced in three layers:
1.  **Row-Level Security (RLS)**: Enforced directly inside PostgreSQL on all primary tables. Reads and writes are isolated using:
    ```sql
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    ```
2.  **Express Hook & Context Storage**: The backend auth middleware [tenantIsolation.js](file:///C:/Users/Mayan/OneDrive/Desktop/Agent4/backend/middleware/tenantIsolation.js) decodes the tenant ID from the JWT token and mounts it in an `AsyncLocalStorage` transaction context.
3.  **Automatic Query Rewriter**: Inside [db.js](file:///C:/Users/Mayan/OneDrive/Desktop/Agent4/backend/db/db.js), standard SELECT, UPDATE, and DELETE statements undergo dynamic intercept rewriting to append the appropriate `tenant_id` filter (e.g., `WHERE tenant_id = $N`). The connection checkout automatically executes `SET app.current_tenant_id = 'tenant-uuid'`.

---

## 🤖 AI & RAG Pipeline Specifications

### Lead Scoring
- **Ideal Customer Profile (ICP)**: Settable per tenant (`titles`, `industries`, `companySizes`, `painPoints`).
- **Semantic Evaluation**: Leads are converted into text descriptions, embedded using `text-embedding-3-small`, and compared against the ICP profile embedding.
- **Fallover Execution**: Rules-based keyword comparison scores leads with a similarity grade (Low/Medium/High) if OpenAI credentials are not set.

### RAG System
- **Document Processing**: Uploaded documents are parsed (PDFs parsed using `pdf-parse`) and chunked into ~300-word sections (using a 50-token semantic overlap).
- **Storage**: Chunks are saved in PostgreSQL `knowledge_base` and loaded into Pinecone under the tenant's UUID namespace.
- **Context Injection**: During email generation, the system queries the knowledge base for semantic similarities to ground the copy.

### Email Generation
- **A/B Testing**: Randomly assigns A or B templates for outreach sequences.
- **Hallucination Guard**: Scans generated text for ungrounded company references or generic greetings (`"Hope this finds you well"`) and cleanses them dynamically.
- **Validation**: Checks email word boundaries (Outreach < 100 words, Follow-ups < 60 words). Low confidence flags route the email to a `pending_review` status awaiting human agent approval via `/api/emails/approve`.

---

## 📡 REST API Summary

### Authentication & Setup
*   `POST /api/auth/login`: Authenticates users, returning JWT, role context, and tenant name.

### Metrics & Settings
*   `GET /api/dashboard/stats`: Returns count of leads, score breakdown, meeting metrics, and audit logs.
*   `GET /api/settings/icp`: Returns active Ideal Customer Profile filters.
*   `POST /api/settings/icp`: Updates ICP variables and triggers background leads re-scoring.

### Lead Management
*   `GET /api/leads`: Lists all tenant-owned leads.
*   `POST /api/leads`: Creates a new lead (triggers real-time AI scoring and Pinecone upsert).
*   `POST /api/leads/import`: Imports leads from CSV packages, performing chunked batch AI scoring.

### Outreach & Campaigns
*   `GET /api/campaigns`: Lists campaigns.
*   `POST /api/campaigns`: Creates outreach campaign.
*   `GET /api/messages`: Gets all message logs.
*   `POST /api/emails/generate`: Drafts a personalized campaign email (returns confidence status).
*   `POST /api/emails/approve`: Approves a queued outreach draft.
*   `POST /api/messages/send`: Directs immediate delivery simulator.

### Integrations & Simulator
*   `POST /api/meetings/webhook`: Calendly booking webhook. Maps emails back to leads, schedules meetings, and updates status to `meeting_scheduled`.
*   `POST /api/simulator/incoming-response`: Simulates inbound SMS/Email responses from leads, changing status to `replied`.
