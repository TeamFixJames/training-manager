import { NextResponse } from 'next/server';
import { auth0 } from '../../../lib/auth0';
import { db } from '../../../lib/db';

// TEMPORARY READ-ONLY DIAGNOSTIC. Remove after testing.
const LEARNER_ID = '669551ced2d38f8d1b022966';
const UNIT_ID = '662a798fbd2fd0673a0fe340'; // No "Unit" suffix.
const SUBMISSION_ID = '6aea08c2800b1822280198f4';

function safeUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return null;
    // Block obvious loopback, private, and link-local IPv4 targets.
    const ip = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ip) {
      const [a, b, c, d] = ip.slice(1).map(Number);
      if ([a,b,c,d].some(n => n > 255) || a === 0 || a === 10 || a === 127 || a >= 224 ||
          (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
          (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return null;
    }
    if (hostname.includes(':') || hostname.startsWith('[')) return null;
    return url;
  } catch { return null; }
}

async function inspectAccess(url, method) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      method,
      headers: method === 'GET' ? { Range: 'bytes=0-0' } : {},
      redirect: 'manual', // Do not follow unknown redirects to other hosts.
      cache: 'no-store',
      signal: controller.signal
    });
    const contentType = response.headers.get('content-type') || '';
    const result = {
      method,
      status: response.status,
      success: response.ok,
      redirected: response.status >= 300 && response.status < 400,
      contentTypeCategory: /audio\//i.test(contentType) ? 'audio' :
        /application\/octet-stream/i.test(contentType) ? 'binary' :
        /text\/html/i.test(contentType) ? 'html' :
        /application\/json/i.test(contentType) ? 'json' : 'other-or-unspecified',
      acceptsRanges: (response.headers.get('accept-ranges') || '').toLowerCase() === 'bytes',
      hasContentDisposition: !!response.headers.get('content-disposition'),
      hasContentLength: !!response.headers.get('content-length'),
      hasContentRange: !!response.headers.get('content-range')
    };
    if (response.body) await response.body.cancel().catch(() => {});
    return result;
  } catch (error) {
    return { method, success: false, errorType: error?.name === 'AbortError' ? 'timeout' : 'request-failed' };
  } finally {
    clearTimeout(timeout);
  }
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
    if (!ownership.rows.length) return NextResponse.json({ error: 'Learner is not assigned to this manager.' }, { status: 403 });

    const base = (process.env.LW_API_URL || '').replace(/\/+$/, '');
    if (!base || !process.env.LW_TOKEN || !process.env.LW_CLIENT_ID) {
      return NextResponse.json({ error: 'LearnWorlds environment variables are missing.' }, { status: 500 });
    }

    const endpoint = `${base}/assessments/${encodeURIComponent(UNIT_ID)}/responses?users=${encodeURIComponent(LEARNER_ID)}`;
    const upstream = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${process.env.LW_TOKEN}`,
        'Lw-Client': process.env.LW_CLIENT_ID,
        Accept: 'application/json'
      },
      cache: 'no-store'
    });
    if (!upstream.ok) return NextResponse.json({ success: false, assessmentApiStatus: upstream.status }, { status: 502 });
    const payload = await upstream.json();
    const records = Array.isArray(payload?.data) ? payload.data : [];
    const submission = records.find(item => String(item?.id) === SUBMISSION_ID && String(item?.user_id) === LEARNER_ID);
    if (!submission) return NextResponse.json({ success: false, assessmentApiStatus: 200, expectedSubmissionFound: false, recordsOnPage: records.length });

    const answers = Array.isArray(submission.answers) ? submission.answers : [];
    const downloads = answers.flatMap(answer => Array.isArray(answer?.answerData?.downloads) ? answer.answerData.downloads : []);
    const first = downloads.find(item => typeof item?.url === 'string' && item.url.length > 0);
    if (!first) return NextResponse.json({ success: true, expectedSubmissionFound: true, attachmentCount: downloads.length, downloadUrlPresent: false });

    const parsed = safeUrl(first.url);
    if (!parsed) return NextResponse.json({ success: true, expectedSubmissionFound: true, attachmentCount: downloads.length, downloadUrlPresent: true, urlAcceptedForTest: false });

    // No recording bytes are stored or returned. HEAD checks metadata; a 1-byte range
    // GET checks whether a server-side request is allowed. Redirects are NOT followed.
    const head = await inspectAccess(parsed.href, 'HEAD');
    const rangeGet = await inspectAccess(parsed.href, 'GET');
    return NextResponse.json({
      success: true,
      assessmentApiStatus: 200,
      expectedSubmissionFound: true,
      attachmentCount: downloads.length,
      downloadUrlPresent: true,
      urlAcceptedForTest: true,
      head,
      rangeGet,
      note: 'Read-only checks. No URL, filename, feedback, or audio content is returned. A 200/206 GET confirms access at test time, not permanent availability.'
    });
  } catch (error) {
    console.error('Fix My Call download diagnostic failed:', error?.name);
    return NextResponse.json({ error: 'Diagnostic failed.' }, { status: 500 });
  }
}
