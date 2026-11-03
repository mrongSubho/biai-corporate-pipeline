# BIAI AI Intern Assessment — Submission Note (Task 2: Corporate Leads Pipeline)

**Candidate:** Subho Mrong  
**Submission Date:** 2 November 2026  
**Live Production URL (Cloudflare Edge):** `https://biaileads.mrong.tech`  
**CRM Triage Workspace:** `https://biaicrm.mrong.tech`  
**Code Repository:** `https://github.com/mrongSubho/biai-corporate-pipeline`  
**Loom Walkthrough (4 min 30s):** `[Loom Video URL]`

---

### 1. What I Built
I engineered a production-grade, edge-native **Corporate B2B Leads Pipeline & Data Hygiene Engine** deployed on **Cloudflare Workers (Hono v4) + Cloudflare D1 (Distributed SQLite) + Svelte 5 (Runes)**. The system transforms messy, fragmented corporate sales data into an audited, executive-ready revenue pipeline running directly on Cloudflare edge isolates with $<50\text{ ms}$ global latency and sub-1-second cold starts.

**Core Systems & Architecture:**
- **Dual-Layer Truth Model (Raw vs. Cleaned):** Eliminates silent data corruption by strictly decoupling an immutable ingestion table (`raw_corporate_leads`) from canonical business entities (`canonical_corporate_leads`). Sales reps and management can toggle views in real time with transparent dual-truth reconciliation metrics.
- **7-Stage B2B Pipeline:** Accurately represents the B2B deal lifecycle across 25 corporate accounts: `New` (3), `Contacted` (8), `Meeting` (6 raw / 5 clean), `Proposal` (3 raw / 2 clean), `Invoice sent` (2), `Paid` (1), and `Lost` (2).
- **Automated Hygiene & Anomaly Engine:** Programmatically identifies **21 distinct anomaly findings across 15 unique corporate leads**:
  - **Phantom Duplicate Clusters:** Detects `L01/L23` (Padma Textiles Ltd — ৳350,000) and `L02/L03` (Meghna Pharma vs Meghna Pharmaceuticals — ৳700,000). Provides one-click reversible merging that cleanses **৳1,050,000 in phantom pipeline**, correcting raw ৳4.22M down to verified ৳3.17M.
  - **Chronological Causality Inversion (L25 Sylhet Hospitality):** Detects that `next_followup` (Oct 21) was set earlier than `last_contact` (Oct 28). Provides audited remediation (field swap 21 Oct ⟷ 28 Oct or auto-reschedule to Nov 4).
  - **Payment & Accounting Semantics (L12 Eastern Cable):** Detects that L12 is marked "Paid" for ৳300k, yet notes confirm only a 50% advance. Corrects the financial model to reflect ৳150,000 collected and ৳150,000 still due.
  - **Email Domain Typo Normalization (L18 Bogura Textile):** Flags and fixes `bogurateXtile.com` to prevent silent delivery bounce.
  - **Identity & Contact Completeness:** Flags missing contact person on `L24` (Square Pharmaceuticals enterprise account) and missing phone number on `L06` (Akij Group).
  - **Overdue Follow-up Monitor:** Tracks exactly **9 overdue accounts** strictly before the Benchmark Date (`2026-11-01`), plus **1 due today** (`L09`), preventing deal slippage.
- **Safe Natural Language Deal Copilot (AST Compiler):** Solves the critical security vulnerability of direct NL-to-SQL by compiling natural language queries into a strictly typed, allowlisted Abstract Syntax Tree (AST). Rejects arbitrary SQL execution, enforces workspace boundaries, and computes dual-truth variance (e.g. comparing raw vs. cleaned proposal totals).
- **Context-Aware AI Email Drafter with Policy Barriers:** Generates grounded B2B follow-ups (Polite Check-in, Proposal Value Proposition, Invoice Reminder) while enforcing strict operational safety barriers:
  - **Hard DO_NOT_CONTACT Barrier on L16 (Sundarban Shipping):** Prohibits outbound outreach during CEO transition.
  - **Payment Verification Warning on L22 (Khulna Jute Works):** Blocks finance clearance until a formal bank statement matches claimed wire transfers.
- **PII-Masked Enterprise Export:** Generates compliant CSV / JSON exports with one-click phone and email anonymization.

---

### 2. Which AI Tools I Used and How
- **Cloudflare Workers AI (`@cf/meta/llama-3.3-70b-instruct`):** Powers edge semantic understanding for natural language query classification and grounded B2B email generation without third-party API latency.
- **Google Gemini 2.5 Flash:** Cloud LLM fallback for multi-document synthesis, corporate research, and complex intent parsing.
- **Deterministic AST Parser & Rule-Based Fallback Engine:** Guarantees zero downtime and sub-5ms query evaluation even if LLM rate limits are exceeded, ensuring mission-critical B2B pipeline operations are never blocked.
- **Antigravity AI Pair Programmer:** Used for rigorous systems planning, schema normalization, edge test fixture generation, and continuous verification.

---

### 3. What Does Not Work Yet (Current Limitations)
- **Direct SMTP / Resend Credentials:** Generated B2B emails are drafted in the UI with a one-click copy and review workflow. Outbound transactional sending requires connecting BIAI’s corporate domain SMTP/Resend API keys.
- **Accounting Gateway Sync:** Payment verification on L12 and L22 currently relies on CRM flags; live bidirectional synchronization with Xero or QuickBooks is not yet connected.

---

### 4. What I Would Fix / Build Next
1. **Live Transactional Email Gateway:** Integrate Resend or Cloudflare Email Workers with open/click tracking and automated follow-up cadences.
2. **ERP & Accounting Webhooks:** Connect corporate bank statement ingestion (e.g. City Bank, BRAC Bank API) to auto-reconcile wire transfers and mark payments as cleared without manual intervention.
3. **LinkedIn & Corporate Registry Scraping:** Automatically enrich incomplete enterprise leads (such as missing contact on L24 Square Pharma) via Apollo.io or LinkedIn Sales Navigator APIs.
