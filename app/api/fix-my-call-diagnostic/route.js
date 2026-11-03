import { NextResponse } from 'next/server';
import { auth0 } from '../../../lib/auth0';
import { db } from '../../../lib/db';

// TEMPORARY READ-ONLY DIAGNOSTIC. Remove after testing.
const LEARNER_ID = '669551ced2d38f8d1b022966';
const COURSE_ID = 'fixmycall';
const UNIT_ID = '662a798fbd2fd0673a0fe340Unit';

function describe(value, depth = 0) {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) return {
    type: 'array',
    count: value.length,
    sample: value.length && depth < 9 ? describe(value[0], depth + 1) : undefined
  };
  if (typeof value === 'object') return depth >= 9
    ? { type: 'object', keys: Object.keys(value) }
    : { type: 'object', fields: Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, describe(child, depth + 1)])
      ) };
  return { type: typeof value };
}

function findLearnerRecords(payload) {
  const arrays = [payload?.data, payload?.data?.responses, payload?.responses, payload?.data?.items];
  const records = arrays.find(Array.isArray) || [];
  return {
    countOnPage: records.length,
    matchedLearnerCount: records.filter((item) =>
      String(item?.user_id ?? item?.userId ?? item?.user?.id ?? item?.learner_id ?? '') === LEARNER_ID
    ).length,
    recordShape: records.length ? describe(records[0]) : null
  };
}

export async function GET() {
  try {
    const session = await auth0.getSession();
    const email = session?.user?.email?.trim().toLowerCase();
    if (!email) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const ownership = await db.query(
      `SELECT 1 FROM training_manager_state
       WHERE manager_email = $1 AND employee_lw_id = $2 LIMIT 1`,
      [email, LEARNER_ID]
    );
    if (!ownership.rows.length) return NextResponse.json(
      { error: 'This learner is not assigned to your Training Manager account.' },
      { status: 403 }
    );

    const base = (process.env.LW_API_URL || '').replace(/\/+$/, '');
    if (!base || !process.env.LW_TOKEN || !process.env.LW_CLIENT_ID) {
      return NextResponse.json({ error: 'LearnWorlds environment variables are missing' }, { status: 500 });
    }

    // The LearnWorlds learning-unit ID may differ from its assessment ID.
    // This request tests that assumption without modifying any records.
    const url = `${base}/assessments/${encodeURIComponent(UNIT_ID)}/responses`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.LW_TOKEN}`,
        'Lw-Client': process.env.LW_CLIENT_ID,
        Accept: 'application/json'
      },
      cache: 'no-store'
    });

    const raw = await response.text();
    let payload;
    try { payload = JSON.parse(raw); } catch { payload = null; }

    // Report structural metadata only. Never return feedback, grades,
    // emails, names, audio links, raw responses, or access credentials.
    const result = {
      success: response.ok,
      upstreamStatus: response.status,
      test: { courseId: COURSE_ID, activityId: UNIT_ID, learnerId: LEARNER_ID },
      responseShape: payload === null ? { type: 'non-json' } : describe(payload),
      records: response.ok ? findLearnerRecords(payload) : undefined
    };
    return NextResponse.json(result, { status: response.ok ? 200 : 502 });
  } catch (error) {
    console.error('Fix My Call assessment response diagnostic failed:', error?.message);
    return NextResponse.json({ error: 'Diagnostic failed' }, { status: 500 });
  }
}
