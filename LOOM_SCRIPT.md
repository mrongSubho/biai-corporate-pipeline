# Loom Video Presentation Guide & Script (Task 2: Corporate Leads Pipeline)

> **Target Duration:** 4 Minutes 30 Seconds (Strictly $\le 5$ minutes per BIAI guidelines)  
> **Camera / Audio:** Show your screen with a webcam bubble in the corner. Speak with calm confidence, clear pacing, and focus on *why* this solves BIAI's corporate sales reality.

---

## Timing & Screen Flow Breakdown

```
00:00 - 00:45 │ The Problem & Edge Systems Architecture
00:45 - 01:45 │ Dual-Truth Pipeline (Raw vs. Cleaned) & ৳1,050,000 Duplicate Cleansing
01:45 - 02:45 │ The Hygiene & Anomaly Engine (L25 Date Inversion, L12 Payment Semantics, Overdue Deals)
02:45 - 03:45 │ Safe Natural Language Deal Copilot (Allowlisted AST vs Unsafe SQL)
03:45 - 04:30 │ Policy-Gated AI Email Drafter (L16 DO_NOT_CONTACT & L22 Bank Verification)
```

---

## Word-For-Word Talking Script

### Part 1: The Problem & Edge Systems Architecture (00:00 – 00:45)
*(Screen: Show the live BIAI Corporate Leads Pipeline app dashboard with dark executive UI)*

> "Hi BIAI team, my name is Subho Mrong. Today I am thrilled to present the **BIAI Corporate B2B Pipeline & Data Hygiene Engine**.
> 
> In B2B sales, messy CRM data is not just an inconvenience—it directly damages revenue. Duplicate leads inflate pipeline forecasts, corrupted follow-up dates let six-figure deals go cold, and generic AI follow-ups can email executives during sensitive leadership transitions.
> 
> Rather than building a fragile React prototype, I built this as a high-performance, edge-native system using **Cloudflare Workers, Hono v4, Cloudflare D1 distributed SQLite, and Svelte 5**. The entire application bundle is under 47 KB gzipped and runs directly on Cloudflare’s Dhaka edge node with sub-50ms latency."

---

### Part 2: Dual-Truth Pipeline & Duplicate Cleansing (00:45 – 01:45)
*(Screen: Point out the header metrics bar, then toggle the "Data View Mode" switch between Cleaned and Raw)*

> "Let's examine the 25 corporate accounts from the assessment pack.
> 
> A common flaw in CRM systems is 'destructive data cleaning' where raw records are permanently overwritten. In our architecture, we maintain a **Dual-Layer Truth Model**: an immutable raw ingestion log and an audited canonical pipeline.
> 
> Watch what happens when I toggle between **Raw** and **Cleaned** mode:
> - In **Raw mode**, the headline pipeline shows **৳4,220,000 across 25 accounts**.
> - But in reality, **৳1,050,000 of that is phantom pipeline** caused by duplicate entries:
>   1. **Padma Textiles Ltd** appears twice (`L01` and `L23`) for ৳350,000.
>   2. **Meghna Pharma** appears twice (`L02` and `L03`) for ৳700,000.
> 
> In **Cleaned mode**, our engine archives the duplicate opportunities and reconciles the true active pipeline to **৳3,170,000**, with **৳650,000 already collected** and **৳1,020,000 outstanding** across the 7 stages."

---

### Part 3: The Hygiene Engine & Anomaly Remediation (01:45 – 02:45)
*(Screen: Click the "Data Hygiene & Anomalies" button to open the audit drawer)*

> "Let’s open our automated Hygiene Engine. Our audit rules analyzed all 25 leads against the Benchmark Date of **1 November 2026** and uncovered **21 distinct anomaly findings across 15 unique leads**:
> 
> 1. **Chronological Causality Inversion on L25 (Sylhet Hospitality Group):** Look at this error—its `last_contact` is October 28, but its `next_followup` was recorded as October 21. A follow-up cannot happen before the call occurred. Instead of blindly guessing, our engine gives reps two audited remediation paths: swap the transposed fields (21 Oct ⟷ 28 Oct) or reschedule to November 4.
> 2. **Payment Semantics on L12 (Eastern Cable Industries):** Marked as 'Paid' for ৳300,000, yet the source notes prove only a 50% advance was received. Our system correctly splits this into ৳150k collected and ৳150k due.
> 3. **Data Quality & Incomplete Records:** It flags `L18` for a domain typo (`bogurateXtile.com`), `L24` Square Pharmaceuticals for a missing contact name, and `L06` Akij Group for a missing phone number.
> 4. **Overdue Follow-ups:** It immediately highlights the **9 overdue accounts** strictly before November 1, plus **L09 (Apex Footwear)** which is due today, so reps never drop a high-intent conversation."

---

### Part 4: Safe Natural Language Deal Copilot (02:45 – 03:45)
*(Screen: Click the "AI Deal Copilot" button, show the query drawer, and click the preset "What is the total value in Proposal stage?")*

> "Next, let’s look at our **AI Deal Copilot**.
> 
> Most AI assistants use 'NL-to-SQL' where an LLM writes raw SQL directly. This is a severe security risk that allows SQL injection, data exfiltration, or table corruption.
> 
> We took an enterprise approach: our engine compiles natural language into a **strictly allowlisted Abstract Syntax Tree (AST)**. The AST only permits approved filtering operators (`stage`, `industry`, `overdue`, `min_value`) and is compiled into parameterized queries with workspace boundaries.
> 
> Notice how the Copilot answers:
> When I ask *'What is the total value in Proposal stage?'*, it doesn't just return a number—it provides **Dual-Truth Reconciliation**:
> It shows that the **Cleaned pipeline has ৳1,150,000** (2 accounts: Beximco and Summit), while warning that the **Raw pipeline showed ৳1,500,000** because of the duplicate Padma Textiles lead. That transparency builds executive trust."

---

### Part 5: Policy-Gated AI Email Drafter & Conclusion (03:45 – 04:30)
*(Screen: Select L16 Sundarban Shipping to show the DO NOT CONTACT barrier, then select L22 Khulna Jute to show the bank verification requirement, then select L01 Padma Textiles to generate a Proposal Follow-up)*

> "Finally, let's look at the **Context-Aware AI Email Drafter**.
> 
> Sales reps waste hours drafting B2B follow-ups, but naive AI tools can cause catastrophic PR mistakes. Our engine embeds **hard business policy guardrails**:
> 
> - Look at **L16 (Sundarban Shipping)**: The notes say the CEO resigned and not to contact until mid-November. The engine actively enforces a **Hard DO_NOT_CONTACT Policy Barrier**, completely blocking outbound drafts to protect the relationship.
> - Look at **L22 (Khulna Jute Works)**: The client claims they made a wire transfer, but our finance team hasn’t seen it. The drafter injects a **Mandatory Bank Verification Check** before allowing an invoice reminder.
> - For clean accounts like **L01 Padma Textiles**, it generates a grounded, context-aware proposal follow-up citing their exact deal terms and upcoming milestones.
> 
> In summary, this is not a mock concept. It is a tested, secure, and production-ready B2B pipeline engine designed specifically for BIAI's commercial operations.
> 
> Thank you, and I look forward to speaking with the team in Round 3!"
