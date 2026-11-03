import { NextResponse } from 'next/server';
import { auth0 } from '../../../lib/auth0';
import { db } from '../../../lib/db';

// Pilot activity. Add other activity IDs after this one is verified.
const ACTIVITY_UNIT_ID = '662a798fbd2fd0673a0fe340';
const MAX_PAGES = 100;

function errorResponse(message, status) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function unixDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  const ms = number > 1e12 ? number : number * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getFeedback(answers) {
  return answers
    .map((answer) => String(answer?.feedback || '').trim())
    .filter(Boolean)
    .join('\n\n');
}

function getAudio(answers) {
  for (const answer of answers) {
    for (const download of answer?.answerData?.downloads || []) {
      if (typeof download?.url === 'string' && /^https:\/\//i.test(download.url)) {
        return { url: download.url, filename: String(download.title || '') };
      }
    }
  }
  return { url: null, filename: null };
}

async function getAllSubmissions(employeeId) {
  const submissions = [];
  const base = String(process.env.LW_API_URL || '').replace(/\/$/, '');
  if (!base || !process.env.LW_TOKEN || !process.env.LW_CLIENT_ID) {
    throw new Error('LearnWorlds environment variables are not configured');
  }

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL(`${base}/assessments/${encodeURIComponent(ACTIVITY_UNIT_ID)}/responses`);
    url.searchParams.set('users', employeeId);
    url.searchParams.set('page', String(page));
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.LW_TOKEN}`,
        'Lw-Client': process.env.LW_CLIENT_ID,
        Accept: 'application/json'
      },
      cache: 'no-store'
    });

    if (response.status === 404 && page === 1) {
      // LearnWorlds has returned 404 for known employees who have never
      // submitted this activity. Confirm this behavior against your school
      // before treating it as definitive; see API response flag below.
      return { submissions: [], emptyResponseWas404: true };
    }
    if (!response.ok) {
      throw new Error(`LearnWorlds submission request failed (${response.status})`);
    }
    const payload = await response.json();
    if (!Array.isArray(payload?.data)) {
      throw new Error('Unexpected LearnWorlds submissions response');
    }
    submissions.push(...payload.data);
    const totalPages = Number(payload?.meta?.totalPages || 1);
    if (!Number.isFinite(totalPages) || totalPages < 1) {
      throw new Error('Invalid LearnWorlds pagination metadata');
    }
    if (page >= totalPages) return { submissions, emptyResponseWas404: false };
  }
  throw new Error('LearnWorlds submission pagination exceeded safety limit');
}

async function checkOwnership(managerEmail, employeeId) {
  const ownership = await db.query(
    `SELECT 1 FROM training_manager_state
     WHERE manager_email = $1 AND employee_lw_id = $2 LIMIT 1`,
    [managerEmail, employeeId]
  );
  return Boolean(ownership.rowCount);
}

async function archivedSubmissions(employeeId) {
  return db.query(
    `SELECT submission_id, activity_unit_id, submitted_at, grade, passed,
            trainer_feedback, audio_url, audio_filename, first_saved_at, last_synced_at
     FROM training_manager_fix_my_call_submissions
     WHERE employee_lw_id = $1 AND activity_unit_id = $2
     ORDER BY submitted_at DESC NULLS LAST, first_saved_at DESC`,
    [employeeId, ACTIVITY_UNIT_ID]
  );
}

export async function GET(request) {
  try {
    const session = await auth0.getSession();
    const managerEmail = String(session?.user?.email || '').trim().toLowerCase();
    if (!managerEmail) return errorResponse('Not authenticated', 401);
    const employeeId = String(new URL(request.url).searchParams.get('employeeId') || '').trim();
    if (!employeeId) return errorResponse('employeeId is required', 400);
    if (!(await checkOwnership(managerEmail, employeeId))) {
      return errorResponse('Employee not found for this manager', 404);
    }
    const result = await archivedSubmissions(employeeId);
    return NextResponse.json({
      success: true, source: 'database', employeeId,
      activityUnitId: ACTIVITY_UNIT_ID,
      archivedCount: result.rows.length, submissions: result.rows
    });
  } catch (error) {
    console.error('Fix My Call archive retrieval failed:', error);
    return errorResponse('Unable to retrieve archived Fix My Call submissions; check server logs', 500);
  }
}

export async function POST(request) {
  try {
    let body;
    try { body = await request.json(); }
    catch { return errorResponse('A JSON request body is required', 400); }

    const employeeId = String(body?.employeeId || '').trim();
    if (!employeeId) return errorResponse('employeeId is required', 400);

    const secret = process.env.TRAINING_SNAPSHOT_CRON_SECRET || '';
    const authorization = request.headers.get('authorization') || '';
    const isCron = Boolean(secret) && authorization === `Bearer ${secret}`;
    let managerEmail;
    if (isCron) {
      managerEmail = String(body?.managerEmail || '').trim().toLowerCase();
    } else {
      const session = await auth0.getSession();
      managerEmail = String(session?.user?.email || '').trim().toLowerCase();
    }
    if (!managerEmail) return errorResponse('Not authenticated', 401);
    if (!(await checkOwnership(managerEmail, employeeId))) {
      return errorResponse('Employee not found for this manager', 404);
    }

    const { submissions, emptyResponseWas404 } = await getAllSubmissions(employeeId);
    let saved = 0;
    let skipped = 0;
    for (const submission of submissions) {
      if (String(submission?.user_id || '') !== employeeId || !submission?.id) {
        skipped++;
        continue;
      }
      const answers = Array.isArray(submission.answers) ? submission.answers : [];
      const audio = getAudio(answers);
      const feedback = [String(submission.generalFeedback || '').trim(), getFeedback(answers)]
        .filter(Boolean).join('\n\n');
      const grade = submission.grade === null || submission.grade === undefined || submission.grade === ''
        ? null : Number(submission.grade);

      await db.query(
        `INSERT INTO training_manager_fix_my_call_submissions
         (submission_id, employee_lw_id, activity_unit_id, submitted_at, grade, passed,
          trainer_feedback, audio_url, audio_filename, answers, source_payload, last_synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,NOW())
         ON CONFLICT (submission_id) DO UPDATE SET
           submitted_at = COALESCE(EXCLUDED.submitted_at, training_manager_fix_my_call_submissions.submitted_at),
           grade = COALESCE(EXCLUDED.grade, training_manager_fix_my_call_submissions.grade),
           passed = COALESCE(EXCLUDED.passed, training_manager_fix_my_call_submissions.passed),
           trainer_feedback = COALESCE(NULLIF(EXCLUDED.trainer_feedback, ''), training_manager_fix_my_call_submissions.trainer_feedback),
           audio_url = COALESCE(EXCLUDED.audio_url, training_manager_fix_my_call_submissions.audio_url),
           audio_filename = COALESCE(EXCLUDED.audio_filename, training_manager_fix_my_call_submissions.audio_filename),
           answers = EXCLUDED.answers,
           source_payload = EXCLUDED.source_payload,
           last_synced_at = NOW()`,
        [String(submission.id), employeeId, ACTIVITY_UNIT_ID,
         unixDate(submission.submittedTimestamp) || unixDate(submission.created),
         Number.isFinite(grade) ? grade : null,
         typeof submission.passed === 'boolean' ? submission.passed : null,
         feedback, audio.url, audio.filename, JSON.stringify(answers), JSON.stringify(submission)]
      );
      saved++;
    }

    const result = await archivedSubmissions(employeeId);
    return NextResponse.json({
      success: true, employeeId, activityUnitId: ACTIVITY_UNIT_ID,
      retrievedFromLearnWorlds: submissions.length, processed: saved, skipped,
      emptyResponseWas404, archivedCount: result.rows.length,
      submissions: result.rows
    });
  } catch (error) {
    console.error('Fix My Call sync failed:', error);
    return errorResponse('Unable to sync Fix My Call submissions; check server logs', 500);
  }
}
