import { NextResponse } from 'next/server';
import { auth0 } from '../../../lib/auth0';
import { db } from '../../../lib/db';

// TEMPORARY READ-ONLY DIAGNOSTIC. Remove after testing.
const LEARNER_ID = '669551ced2d38f8d1b022966';
const UNIT_ID = '662a798fbd2fd0673a0fe340'; // Without the "Unit" suffix
const EXPECTED_SUBMISSION_ID = '6aea08c2800b1822280198f4';

function summarize(value, depth = 0) {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) {
    return {
      type: 'array',
      count: value.length,
      sample: value.length && depth < 5 ? summarize(value[0], depth + 1) : undefined
    };
  }
  if (typeof value === 'object') {
    if (depth >= 5) return { type: 'object', keys: Object.keys(value) };
    return {
      type: 'object',
      fields: Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, summarize(child, depth + 1)])
      )
    };
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    let parsed = null;
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try { parsed = JSON.parse(trimmed); } catch { /* Not JSON */ }
    }
    return {
      type: 'string',
      present: trimmed.length > 0,
      length: value.length,
      looksLikeUrl: /^https?:\/\//i.test(trimmed),
      looksLikeAudioReference: /\.(mp3|m4a|wav|ogg)(?:[?#]|$)/i.test(trimmed),
      looksLikeJson: parsed !== null,
      parsedShape: parsed !== null && depth < 5 ? summarize(parsed, depth + 1) : undefined
    };
  }
  return { type: typeof value };
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
      return NextResponse.json({ error: 'Learner not assigned to your Training Manager account' }, { status: 403 });
    }

    const base = (process.env.LW_API_URL || '').replace(/\/+$/, '');
    if (!base || !process.env.LW_TOKEN || !process.env.LW_CLIENT_ID) {
      return NextResponse.json({ error: 'LearnWorlds environment variables missing' }, { status: 500 });
    }

    const url = `${base}/assessments/${encodeURIComponent(UNIT_ID)}/responses?users=${encodeURIComponent(LEARNER_ID)}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.LW_TOKEN}`,
        'Lw-Client': process.env.LW_CLIENT_ID,
        Accept: 'application/json'
      },
      cache: 'no-store'
    });

    if (!response.ok) {
      return NextResponse.json({
        success: false,
        upstreamStatus: response.status,
        note: 'LearnWorlds request failed; response body withheld'
      }, { status: 502 });
    }

    const payload = await response.json();
    const records = Array.isArray(payload?.data) ? payload.data : [];
    const submission = records.find((r) =>
      String(r?.id ?? '') === EXPECTED_SUBMISSION_ID &&
      String(r?.user_id ?? '') === LEARNER_ID
    );
    if (!submission) {
      return NextResponse.json({
        success: true,
        upstreamStatus: response.status,
        expectedSubmissionFound: false,
        recordsOnPage: records.length,
        totalPages: payload?.meta?.totalPages ?? null,
        note: 'Only the first response page was checked; no private records returned'
      });
    }

    const answers = Array.isArray(submission.answers) ? submission.answers : [];
    return NextResponse.json({
      success: true,
      upstreamStatus: response.status,
      expectedSubmissionFound: true,
      answerCount: answers.length,
      attachmentFields: answers.map((answer, index) => ({
        index,
        answerDataType: answer?.answerData === null ? 'null' : Array.isArray(answer?.answerData) ? 'array' : typeof answer?.answerData,
        answerDataKeys: answer?.answerData && typeof answer.answerData === 'object'
          ? Object.keys(answer.answerData) : [],
        downloads: summarize(answer?.answerData?.downloads ?? null),
        feedbackPresent: typeof answer?.feedback === 'string' && answer.feedback.trim().length > 0
      })),
      note: 'Structural metadata only. No filenames, URLs, recordings, feedback text, or learner email returned.'
    });
  } catch (error) {
    console.error('Fix My Call downloads diagnostic failed:', error?.message);
    return NextResponse.json({ error: 'Diagnostic failed' }, { status: 500 });
  }
}
