import { NextResponse } from 'next/server';
import { auth0 } from '../../../lib/auth0';
import { db } from '../../../lib/db';

// TEMPORARY READ-ONLY DIAGNOSTIC. Remove after testing.
const LEARNER_ID = '669551ced2d38f8d1b022966';
const COURSE_ID = 'fixmycall';
const UNIT_ID_NO_SUFFIX = '662a798fbd2fd0673a0fe340';
const UNIT_ID_WITH_SUFFIX = '662a798fbd2fd0673a0fe340Unit';

function describe(value, depth = 0) {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) {
    return {
      type: 'array',
      count: value.length,
      sample: value.length && depth < 8 ? describe(value[0], depth + 1) : undefined
    };
  }
  if (typeof value === 'object') {
    if (depth >= 8) return { type: 'object', keys: Object.keys(value) };
    return {
      type: 'object',
      fields: Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, describe(child, depth + 1)])
      )
    };
  }
  return { type: typeof value };
}

function recordSummary(payload) {
  const candidates = [payload?.data, payload?.data?.responses, payload?.responses, payload?.data?.items];
  const records = candidates.find(Array.isArray) || [];
  return {
    countOnPage: records.length,
    matchedLearnerCount: records.filter((item) =>
      String(item?.user_id ?? item?.userId ?? item?.user?.id ?? item?.learner_id ?? '') === LEARNER_ID
    ).length
  };
}

async function testAssessment(base, unitId) {
  const url = new URL(`${base}/assessments/${encodeURIComponent(unitId)}/responses`);
  url.searchParams.set('users', LEARNER_ID);
  url.searchParams.set('page', '1');
  url.searchParams.set('items_per_page', '20');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${process.env.LW_TOKEN}`,
      'Lw-Client': process.env.LW_CLIENT_ID,
      Accept: 'application/json'
    },
    cache: 'no-store'
  });

  const raw = await response.text();
  let payload = null;
  try { payload = JSON.parse(raw); } catch { /* non-JSON response */ }

  return {
    identifierTested: unitId,
    upstreamStatus: response.status,
    success: response.ok,
    // Only structural metadata is returned; never raw feedback, MP3 URLs, or personal data.
    responseShape: payload === null ? { type: 'non-json' } : describe(payload),
    records: response.ok ? recordSummary(payload) : undefined
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
    if (!ownership.rows.length) {
      return NextResponse.json(
        { error: 'This learner is not assigned to your Training Manager account.' },
        { status: 403 }
      );
    }

    const base = (process.env.LW_API_URL || '').replace(/\/+$/, '');
    if (!base || !process.env.LW_TOKEN || !process.env.LW_CLIENT_ID) {
      return NextResponse.json({ error: 'LearnWorlds environment variables are missing' }, { status: 500 });
    }

    // Two GET requests only. No grade changes, reviews, or database writes.
    const tests = [];
    for (const unitId of [UNIT_ID_NO_SUFFIX, UNIT_ID_WITH_SUFFIX]) {
      tests.push(await testAssessment(base, unitId));
    }

    return NextResponse.json({
      test: 'Fix My Call assessment learning-unit identifier formats',
      courseId: COURSE_ID,
      learnerId: LEARNER_ID,
      tests
    });
  } catch (error) {
    console.error('Fix My Call diagnostic failed:', error?.message);
    return NextResponse.json({ error: 'Diagnostic failed' }, { status: 500 });
  }
}
