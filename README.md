# BIAI Corporate Leads Pipeline & Data Hygiene Engine

Production-grade, edge-native B2B Pipeline and Data Hygiene Engine engineered for the **BIAI AI Intern Assessment (Task 2)**.

Deployed on **Cloudflare Workers (Edge V8 Isolates) + Cloudflare D1 (Distributed SQLite) + Svelte 5 (Runes)**.

---

## 🌟 Key Features

1. **Dual-Layer Truth Model (Raw vs. Cleaned):**
   - Strictly separates immutable raw ingestion (`raw_corporate_leads`) from canonical business entities (`canonical_corporate_leads`).
   - Enables real-time dual-truth reconciliation, reporting raw totals vs. cleansed figures transparently.

2. **7-Stage B2B Pipeline:**
   - Interactive Kanban managing 25 corporate accounts across the complete B2B lifecycle: `New` (3), `Contacted` (8), `Meeting` (6 raw / 5 clean), `Proposal` (3 raw / 2 clean), `Invoice sent` (2), `Paid` (1), and `Lost` (2).

3. **Automated Hygiene & Anomaly Engine (21 Findings Across 15 Unique Leads):**
   - **Phantom Duplicate Cleansing:** Detects `L01/L23` (Padma Textiles Ltd — ৳350,000) and `L02/L03` (Meghna Pharma vs Meghna Pharmaceuticals — ৳700,000). Cleanses **৳1,050,000 in phantom pipeline**, correcting raw ৳4.22M down to verified ৳3.17M.
   - **Chronological Date Order Inversion (L25 Sylhet Hospitality Group):** Detects `next_followup` (Oct 21) set earlier than `last_contact` (Oct 28). Provides audited field swap or auto-reschedule.
   - **Payment & Accounting Semantics (L12 Eastern Cable Industries):** Corrects "Paid" status to reflect 50% advance (৳150,000 collected, ৳150,000 outstanding).
   - **Domain Typo Normalization (L18 Bogura Textile Mills):** Normalizes `bogurateXtile.com` to prevent silent delivery bounce.
   - **Incomplete Enterprise Records:** Highlights missing contact person on `L24` (Square Pharmaceuticals) and missing phone number on `L06` (Akij Group).
   - **Overdue Deal Tracking:** Flags **9 overdue accounts** strictly before Benchmark Date (`2026-11-01`), plus **1 due today** (`L09 Apex Footwear`).

4. **Safe Natural Language Deal Copilot (Allowlisted AST):**
   - Rejects vulnerable direct NL-to-SQL generation. Compiles natural language queries into a strictly typed, allowlisted Abstract Syntax Tree (AST).
   - Computes dual-truth pipeline variance for executive leadership.

5. **Context-Aware AI Email Drafter with Operational Policy Barriers:**
   - **Hard DO_NOT_CONTACT Barrier on L16 (Sundarban Shipping):** Prohibits outbound outreach during CEO transition.
   - **Payment Verification Warning on L22 (Khulna Jute Works):** Mandates formal bank statement reconciliation before issuing invoice reminders for unconfirmed wire transfers.
   - **Custom B2B Tone Templates:** Generates polite check-ins, proposal value pitches, and invoice follow-ups grounded in account notes.

6. **PII-Masked Enterprise Export:**
   - Role-based export engine offering one-click phone and email anonymization for compliance with data protection policies.

---

## 🚀 Quick Start (Local Development)

```bash
# Navigate to the app directory
cd apps/task2-pipeline

# Run the automated test suite (16 unit & integration tests)
npm test

# Build the production client bundle (<47 KB gzipped)
npm run build:client

# Start the local development server
npm run dev
```

Open `http://localhost:5174` (or Vite's assigned port) to interact with the full 7-stage pipeline, hygiene audit drawer, AI Deal Copilot, and policy-gated email studio.

---

## ☁️ Cloudflare Deployment Runbook

### Prerequisites
- Node.js $\ge 20$
- Cloudflare account with Wrangler CLI (`npx wrangler login`)

### Step 1: Create the Cloudflare D1 Database
```bash
npx wrangler d1 create biai-pipeline-db
```
*Note the returned `database_id` and update `database_id = "<YOUR_DB_ID>"` in `wrangler.toml`.*

### Step 2: Apply Migrations
```bash
# Local testing
npm run d1:migrate:local

# Production Cloudflare D1 deployment
npm run d1:migrate:remote
```

### Step 3: Deploy to Cloudflare Workers & Static Assets
```bash
npm run deploy
```
The application will deploy directly to your Cloudflare Workers subdomain (e.g. `https://biai-corporate-pipeline.<your-subdomain>.workers.dev`).

---

## 🧪 Test Suite Coverage

Run the comprehensive test suite with Vitest:
```bash
npm test
```

### Verified Test Assertions (16/16 Passing):
- **Reconciliation:** Programmatic verification of exact 25-lead distribution and raw ৳4,220,000 pipeline.
- **Duplicate Detection:** Automatic discovery of L01/L23 and L02/L03 clusters.
- **Date Inversion:** Detection of L25 chronological anomaly (-7 days).
- **Incomplete Records:** Detection of L24 missing contact name and L06 missing phone.
- **Email Typo:** Detection and normalization of L18 `bogurateXtile.com`.
- **Payment Semantics:** Verification of L12 50% partial advance (৳150k / ৳150k).
- **Follow-up SLA:** Exact verification of 9 overdue accounts and 1 due today.
- **AST Copilot:** Allowlisted compilation of natural language questions and dual-truth reporting.
- **Policy Guardrails:** Enforcement of DO_NOT_CONTACT on L16, bank verification on L22, and email domain normalization on L18.

---

## 📂 Directory Structure

```
apps/task2-pipeline/
├── migrations/
│   ├── 0001_corporate_pipeline_schema.sql  # Dual raw vs canonical schema & audit log
│   └── 0002_seed_corporate_leads.sql       # Seed data for all 25 corporate accounts
├── src/
│   ├── client/
│   │   ├── App.svelte                      # Executive UI (Kanban, Hygiene Drawer, Copilot, Drafter)
│   │   ├── main.ts                         # Svelte 5 application entry
│   │   └── app.css                         # Tailwind CSS styling
│   ├── lib/
│   │   ├── engine/
│   │   │   ├── hygiene.ts                  # Anomaly & duplicate detection engine
│   │   │   ├── copilot.ts                  # Safe AST natural language compiler
│   │   │   └── email_drafter.ts            # Context-aware B2B email generator
│   │   └── types/
│   │       └── pipeline.ts                 # Strongly-typed schemas (Zod + TypeScript)
│   └── server/
│       ├── fixtures.ts                     # Ingested 25-lead corporate fixture
│       └── index.ts                        # Edge Hono v4 REST API
├── tests/
│   └── pipeline.test.ts                    # 16 automated integration & unit tests
├── LOOM_SCRIPT.md                          # 4m 30s timed video walkthrough script
├── SUBMISSION_NOTE.md                      # Half-page assessment submission note
├── wrangler.toml                           # Cloudflare Workers & D1 configuration
└── vite.config.ts                          # Vite + Svelte 5 bundler configuration
```
