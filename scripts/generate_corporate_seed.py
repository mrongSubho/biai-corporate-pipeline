import csv
import json
import hashlib

csv_path = '/Users/mrongsubho/Downloads/BIAI-AI-Intern-Round2-Pack/sample-data/intern/task2-corporate-leads/corporate-leads.csv'
with open(csv_path, encoding='utf-8-sig') as f:
    raw_content = f.read()

sha256 = hashlib.sha256(raw_content.encode('utf-8')).hexdigest()

f = open(csv_path, encoding='utf-8-sig')
rows = list(csv.DictReader(f))

sql = f"""-- ============================================================================
-- 0002_seed_corporate_leads.sql
-- Seed Workspaces, Users, Initial CSV Import & 25 Corporate Leads
-- ============================================================================

-- 1. Default Workspace
INSERT OR IGNORE INTO workspaces (id, name, default_currency, benchmark_date)
VALUES ('ws_biai_b2b', 'BIAI Enterprise Solutions', 'BDT', '2026-11-01');

-- 2. Staff Users
INSERT OR IGNORE INTO users (id, workspace_id, email, full_name, role, password_hash)
VALUES
  ('usr_b2b_admin', 'ws_biai_b2b', 'admin@biai.com.bd', 'Tariq Mansoor', 'ADMIN', 'mock_hash_admin'),
  ('usr_b2b_mgr', 'ws_biai_b2b', 'shakib@biai.com.bd', 'Shakib Rahman', 'SALES_MANAGER', 'mock_hash_mgr'),
  ('usr_b2b_ae', 'ws_biai_b2b', 'ayesha@biai.com.bd', 'Ayesha Siddika', 'ACCOUNT_EXECUTIVE', 'mock_hash_ae');

-- 3. Import Record
INSERT OR IGNORE INTO imports (id, workspace_id, filename, file_hash_sha256, total_rows, imported_by)
VALUES ('imp_initial_csv', 'ws_biai_b2b', 'corporate-leads.csv', '{sha256}', 25, 'usr_b2b_mgr');
"""

def normalize_company(name):
    s = name.lower()
    for suff in ['ltd', 'limited', 'corp', 'corporation', 'inc', 'industries', 'group', 'co', 'company', 'works', 'mills']:
        s = s.replace(suff, '')
    s = s.replace('pharmaceuticals', 'pharma')
    s = s.replace('textiles', 'textile')
    s = s.replace('.', '').replace(',', '').strip()
    return s

sql += "\n-- 4. Raw Leads (Verbatim Source Records)\n"
for r in rows:
    lid = r['lead id']
    raw_id = f"raw_{lid}"
    val = int(r['deal value (BDT)'] or 0)
    company = r['company'].replace("'", "''")
    ind = r['industry'].replace("'", "''")
    c_name = r['contact name'].replace("'", "''")
    c_role = r['contact role'].replace("'", "''")
    c_email = r['contact email'].replace("'", "''")
    c_phone = r['contact phone'].replace("'", "''")
    src = r['source'].replace("'", "''")
    stage = r['stage'].replace("'", "''")
    last_c = f"'{r['last contact']}'" if r['last contact'] else "NULL"
    next_f = f"'{r['next follow-up']}'" if r['next follow-up'] else "NULL"
    notes = r['notes'].replace("'", "''")

    sql += f"""INSERT OR IGNORE INTO raw_leads (id, import_id, lead_id_csv, company_raw, industry_raw, contact_name_raw, contact_role_raw, contact_email_raw, contact_phone_raw, source_raw, stage_raw, deal_value_raw, last_contact_raw, next_followup_raw, notes_raw)
VALUES ('{raw_id}', 'imp_initial_csv', '{lid}', '{company}', '{ind}', '{c_name}', '{c_role}', '{c_email}', '{c_phone}', '{src}', '{stage}', {val}, {last_c}, {next_f}, '{notes}');
"""

sql += "\n-- 5. Canonical Operational Leads\n"
for r in rows:
    lid = r['lead id']
    can_id = f"can_{lid}"
    raw_id = f"raw_{lid}"
    company = r['company'].replace("'", "''")
    norm_comp = normalize_company(r['company']).replace("'", "''")
    ind = r['industry'].replace("'", "''")
    c_name_escaped = r['contact name'].replace("'", "''") if r['contact name'] else None
    c_name = f"'{c_name_escaped}'" if c_name_escaped else "NULL"
    
    c_role_escaped = r['contact role'].replace("'", "''") if r['contact role'] else None
    c_role = f"'{c_role_escaped}'" if c_role_escaped else "NULL"

    c_email_escaped = r['contact email'].replace("'", "''") if r['contact email'] else None
    c_email = f"'{c_email_escaped}'" if c_email_escaped else "NULL"
    norm_email = f"'{c_email_escaped.lower()}'" if c_email_escaped else "NULL"

    c_phone_escaped = r['contact phone'].replace("'", "''") if r['contact phone'] else None
    c_phone = f"'{c_phone_escaped}'" if c_phone_escaped else "NULL"
    norm_phone = f"'+880{r['contact phone'].replace('-', '').replace(' ', '')[-10:]}'" if r['contact phone'] and len(r['contact phone']) >= 10 else "NULL"
    src = r['source'].replace("'", "''")
    stage = r['stage'].replace("'", "''")
    val = int(r['deal value (BDT)'] or 0)
    
    # Partial payment for L12 (Eastern Cable)
    collected = 150000 if lid == 'L12' else (val if stage == 'Paid' else 0)
    due = 150000 if lid == 'L12' else (0 if stage == 'Paid' else val)
    pay_status = 'PARTIALLY_PAID' if lid == 'L12' else ('FULLY_PAID' if stage == 'Paid' else 'UNPAID')

    last_c = f"'{r['last contact']}'" if r['last contact'] else "NULL"
    next_f = f"'{r['next follow-up']}'" if r['next follow-up'] else "NULL"
    notes = r['notes'].replace("'", "''")

    sql += f"""INSERT OR IGNORE INTO canonical_leads (id, workspace_id, raw_lead_id, lead_id_display, company, normalized_company, industry, contact_name, contact_role, contact_email, normalized_email, contact_phone, normalized_phone, source, stage, deal_value_bdt, amount_collected_bdt, amount_due_bdt, payment_status, last_contact_date, next_followup_date, notes)
VALUES ('{can_id}', 'ws_biai_b2b', '{raw_id}', '{lid}', '{company}', '{norm_comp}', '{ind}', {c_name}, {c_role}, {c_email}, {norm_email}, {c_phone}, {norm_phone}, '{src}', '{stage}', {val}, {collected}, {due}, '{pay_status}', {last_c}, {next_f}, '{notes}');
"""

output_path = '/Users/mrongsubho/Documents/Termninal/BIAI/apps/task2-pipeline/migrations/0002_seed_corporate_leads.sql'
with open(output_path, 'w') as out_f:
    out_f.write(sql)

print(f"Generated {output_path} with 25 raw leads and 25 canonical leads.")
