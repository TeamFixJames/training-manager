import { NextResponse } from 'next/server';
import { auth0 } from '../../../lib/auth0';
import { db } from '../../../lib/db';

// TEMPORARY READ-ONLY DIAGNOSTIC. Remove after testing.
const LEARNER_ID = '669551ced2d38f8d1b022966';
const UNIT_ID = '662a798fbd2fd0673a0fe340'; // No "Unit" suffix
const EXPECTED_SUBMISSION_ID = '6aea08c2800b1822280198f4';

function classifyString(value) {
  if (typeof value !== 'string') return { type: value === null ? 'null' : typeof value };
  const trimmed = value.trim();
  const looksLikeUrl = /^https?:\/\//i.test(trimmed);
  const looksLikeFile = /\.(mp3|wav|m4a|ogg|aac)(?:[?#]|$)/i.test(trimmed);
  const looksLikeJson = /^[\[{]/.test(trimmed);
  return {
    type: 'string',
    present: trimmed.length > 0,
    length: value.length,
    looksLikeUrl,
    looksLikeAudioFileReference: looksLikeFile,
    looksLikeJson,
    // Deliberately do not return filenames, URLs, text, or tokens.
  };
}

function describeAnswer(answer) {
  if (!answer || typeof answer !== 'object') return { type: typeof answer };
  const fields = {};
  for (const [key, value] of Object.entries(answer)) {
    if (typeof value === 'string' || value === null) fields[key] = classifyString(value);
    else if (Array.isArray(value)) fields[key] = { type: 'array', count: value.length, firstItemType: value.length ? typeof value[0] : null };
    else if (typeof value === 'object') fields[key] = { type: 'object', keys: Object.keys(value) };
    else fields[key] = { type: typeof value };
  }
  return { fields };
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

    const url = `${base}/assessments/${encodeURIComponent(UNIT_ID)}/responses?users=${encodeURIComponent(LEARNER_ID)}&items_per_page=20&page=1`;
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
    if (!response.ok) return NextResponse.json({ success: false, upstreamStatus: response.status, responseType: payload === null ? 'non-json' : 'json' });

    const records = Array.isArray(payload?.data) ? payload.data : [];
    const learnerRecords = records.filter(item => String(item?.user_id || '') === LEARNER_ID);
    const target = learnerRecords.find(item => String(item?.id || '') === EXPECTED_SUBMISSION_ID);
    const selected = target || learnerRecords[0];
    const answers = Array.isArray(selected?.answers) ? selected.answers : [];

    return NextResponse.json({
      success: true,
      upstreamStatus: response.status,
      recordCount: records.length,
      matchedLearnerCount: learnerRecords.length,
      expectedSubmissionFound: Boolean(target),
      inspectedSubmission: selected ? (target ? 'expected-submission' : 'first-learner-submission') : 'none',
      answerCount: answers.length,
      answers: answers.map((item, index) => ({ index, ...describeAnswer(item) })),
      generalFeedback: classifyString(selected?.generalFeedback),
      topLevelFieldNames: selected ? Object.keys(selected) : [],
      pagination: {
        totalItems: typeof payload?.meta?.totalItems === 'number' ? payload.meta.totalItems : null,
        totalPages: typeof payload?.meta?.totalPages === 'number' ? payload.meta.totalPages : null
      }
    });
  } catch (error) {
    console.error('Fix My Call attachment diagnostic failed:', error?.name || 'unknown error');
    return NextResponse.json({ error: 'Diagnostic failed' }, { status: 500 });
  }
}
