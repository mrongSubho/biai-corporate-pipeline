// @ts-ignore
import { DatabaseSync } from 'node:sqlite';
// @ts-ignore
import fs from 'node:fs';
// @ts-ignore
import path from 'node:path';

export function createTestD1Database() {
  const db = new DatabaseSync(':memory:');
  const dir = (import.meta as any).dirname || '.';

  const mig1Path = path.resolve(dir, '../migrations/0001_corporate_pipeline_schema.sql');
  const mig2Path = path.resolve(dir, '../migrations/0002_seed_corporate_leads.sql');

  const mig1 = fs.readFileSync(mig1Path, 'utf8');
  const mig2 = fs.readFileSync(mig2Path, 'utf8');

  db.exec(mig1);
  db.exec(mig2);

  return {
    rawDb: db,
    prepare(sql: string) {
      let boundParams: any[] = [];
      return {
        bind(...params: any[]) {
          boundParams = params;
          return this;
        },
        async first<T = any>(col?: string): Promise<T | null> {
          const stmt = db.prepare(sql);
          const row = stmt.get(...boundParams) as any;
          if (!row) return null;
          if (col) return row[col];
          return row as T;
        },
        async all<T = any>(): Promise<{ results: T[]; success: boolean; meta: any }> {
          const stmt = db.prepare(sql);
          const results = stmt.all(...boundParams) as T[];
          return { results, success: true, meta: {} };
        },
        async run(): Promise<{ success: boolean; meta: any }> {
          const stmt = db.prepare(sql);
          const info = stmt.run(...boundParams);
          return { success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
        }
      };
    },
    async batch(stmts: any[]): Promise<any[]> {
      const res = [];
      db.exec('BEGIN TRANSACTION;');
      try {
        for (const s of stmts) {
          res.push(await s.run());
        }
        db.exec('COMMIT;');
        return res;
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }
    },
    async exec(sql: string): Promise<any> {
      db.exec(sql);
    }
  };
}
