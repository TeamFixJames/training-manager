// TEMPORARY SETUP ENDPOINT: app/api/setup-fix-my-call-table/route.js
// Delete this file after successfully creating the table.
import { NextResponse } from 'next/server';
import { db } from '../../../lib/db';

export const runtime = 'nodejs';

export async function POST(request) {
  const configuredSecret = process.env.TRAINING_SNAPSHOT_CRON_SECRET;
  const supplied = request.headers.get('authorization') || '';

  // Require the same private bearer secret used by the existing snapshot cron.
  // Fail closed if the secret is missing.
  if (!configuredSecret || supplied !== `Bearer ${configuredSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS training_manager_fix_my_call_submissions (
        submission_id TEXT PRIMARY KEY,
        employee_lw_id TEXT NOT NULL,
        activity_unit_id TEXT NOT NULL,
        submitted_at TIMESTAMPTZ,
        grade NUMERIC,
        passed BOOLEAN,
        trainer_feedback TEXT,
        audio_url TEXT,
        audio_filename TEXT,
        answers JSONB NOT NULL DEFAULT '[]'::jsonb,
        source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        first_saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_tm_fmc_employee_submitted
      ON training_manager_fix_my_call_submissions (employee_lw_id, submitted_at DESC)
    `);
    const result = await db.query(`
      SELECT to_regclass('public.training_manager_fix_my_call_submissions') IS NOT NULL AS table_exists
    `);
    return NextResponse.json({ success: true, tableExists: result.rows[0]?.table_exists === true });
  } catch (error) {
    console.error('Fix My Call table setup failed:', error.message);
    return NextResponse.json({ error: 'Database setup failed. Check Render logs.' }, { status: 500 });
  }
}
