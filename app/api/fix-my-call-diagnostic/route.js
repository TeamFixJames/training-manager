import { NextResponse } from 'next/server';
import { auth0 } from '../../../lib/auth0';
import { db } from '../../../lib/db';

// Temporary, read-only diagnostic. Remove after testing.
const LEARNER_ID = '6ac0062aa60767a63809258f';
const COURSE_ID = 'fixmycall';
const UNIT_ID = '662a798fbd2fd0673a0fe340Unit';

function describe(value, depth = 0) {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) {
    return {
      type: 'array',
      count: value.length,
      sample: depth < 4 && value.length ? describe(value[0], depth + 1) : undefined
    };
  }
  if (typeof value === 'object') {
    if (depth >= 4) return { type: 'object', keys: Object.keys(value) };
    return {
      type: 'object',
      fields: Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, describe(child, depth + 1)])
      )
    };
  }
  return { type: typeof value };
}

export async function GET() {
  try {
    const session = await auth0.getSession();
    const email = session?.user?.email?.trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Only an authenticated manager who owns this learner in the dashboard may test.
    const ownership = await db.query(
      `SELECT 1 FROM training_manager_state
       WHERE manager_email = $1 AND employee_lw_id = $2 LIMIT 1`,
      [email, LEARNER_ID]
    );
    if (ownership.rows.length === 0) {
      return NextResponse.json(
        { error: 'This learner is not assigned to your Training Manager account.' },
        { status: 403 }
      );
    }

    const base = (process.env.LW_API_URL || '').replace(/\/+$/, '');
    if (!base || !process.env.LW_TOKEN || !process.env.LW_CLIENT_ID) {
      return NextResponse.json({ error: 'LearnWorlds environment variables are missing' }, { status: 500 });
    }

    const url = new URL(`${base}/courses/${encodeURIComponent(COURSE_ID)}/grades`);
    url.searchParams.set('users', LEARNER_ID);
    url.searchParams.set('learning_units', UNIT_ID);

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
    try { payload = JSON.parse(raw); } catch { payload = { nonJsonResponse: true }; }

    // Only report response structure, not grades, feedback, names, audio URLs or secrets.
    return NextResponse.json({
      success: response.ok,
      upstreamStatus: response.status,
      test: { courseId: COURSE_ID, activityId: UNIT_ID, learnerId: LEARNER_ID },
      responseShape: describe(payload)
    }, { status: response.ok ? 200 : 502 });
  } catch (error) {
    console.error('Fix My Call diagnostic failed:', error?.message);
    return NextResponse.json({ error: 'Diagnostic failed' }, { status: 500 });
  }
}
