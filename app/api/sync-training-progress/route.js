import { NextResponse } from 'next/server';
import { auth0 } from '../../../lib/auth0';
import { db } from '../../../lib/db';

const headers = {
  Authorization: `Bearer ${process.env.LW_TOKEN}`,
  'Lw-Client': process.env.LW_CLIENT_ID,
  Accept: 'application/json'
};

async function getAuthenticatedManager() {
  const session = await auth0.getSession();

  if (!session?.user?.email) {
    return null;
  }

  return session.user.email.toLowerCase();
}

async function fetchAllProgress(userId) {
  const courses = [];
  let page = 1;
  let totalPages = 1;

  do {
    const response = await fetch(
      `${process.env.LW_API_URL}/users/${encodeURIComponent(userId)}/progress?page=${page}`,
      {
        headers,
        cache: 'no-store'
      }
    );

    const payload = await response.json();

    if (!response.ok) {
      const error = new Error(
        payload?.error ||
        `Training activity request failed (${response.status})`
      );

      error.status = response.status;
      error.details = payload;
      throw error;
    }

    courses.push(
      ...(Array.isArray(payload?.data) ? payload.data : [])
    );

    totalPages = Number(payload?.meta?.totalPages || 1);
    page += 1;
  } while (page <= totalPages);

  return courses;
}

function flattenActivities(courses) {
  const activities = [];

  for (const course of courses) {
    for (const section of course?.progress_per_section_unit || []) {
      for (const unit of section?.units || []) {
        activities.push({
          courseId: course.course_id || '',
          unitId: unit.unit_id || '',
          title: unit.unit_name || '',
          type: unit.unit_type || '',
          completed: unit.unit_status === 'completed',
          progress: Number(unit.unit_progress_rate || 0),

          durationSeconds:
            typeof unit.unit_duration === 'number'
              ? unit.unit_duration
              : null,

          timeSpentSeconds:
            typeof unit.time_on_unit === 'number'
              ? unit.time_on_unit
              : 0
        });
      }
    }
  }

  return activities;
}

function normalizeTitle(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/\bq\.?\s*c\.?\b/g, 'qc')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bthe\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const titleAliases = new Map([
  [
    normalizeTitle('Now What?!'),
    normalizeTitle('Now What!?')
  ],
  [
    normalizeTitle('Selling a Complicated Job'),
    normalizeTitle('Selling Complicated Jobs')
  ],
  [
    normalizeTitle('Q.C. Lite'),
    normalizeTitle('QC Lite')
  ],
  [
    normalizeTitle('Speaking in Layman’s Terms'),
    normalizeTitle("Speaking in Layman's Terms")
  ],
  [
    normalizeTitle('Don’t Be Afraid'),
    normalizeTitle("Don't Be Afraid")
  ],
  [
    normalizeTitle(
      'Fear of Dealing with an Upset Customer'
    ),
    normalizeTitle(
      'Fear of Dealing With an Upset Customer'
    )
  ],
  [
    normalizeTitle('Technician Quote & Close Ratio'),
    normalizeTitle('Technician Quote and Close Ratio')
  ],
  [
    normalizeTitle(
      'Difference Between Gross Profit & Markup'
    ),
    normalizeTitle(
      'Difference Between Gross Profit and Markup'
    )
  ],
  [
    normalizeTitle('Why Scripting is Important'),
    normalizeTitle('Why Scripting Is Important')
  ],
  [
    normalizeTitle('Delivering Good News vs Bad News'),
    normalizeTitle('Delivering Good News vs. Bad News')
  ],
  [
    normalizeTitle('Overcoming No’s and Objections'),
    normalizeTitle("Overcoming No's and Objections")
  ],
  [
    normalizeTitle(
      'Under Promising and Always Over Delivering'
    ),
    normalizeTitle(
      'Under Promising and Over Delivering'
    )
  ],
  [
    normalizeTitle(
      'Selling From Your Wallet vs. Our Customers’'
    ),
    normalizeTitle(
      "Selling From Your Wallet vs. Our Customers'"
    )
  ],
  [
    normalizeTitle('Why Can’t I Close?'),
    normalizeTitle("Why Can't I Close?")
  ],
  [
    normalizeTitle('Pivoting the Script'),
    normalizeTitle('Pivoting The Script')
  ],
  [
    normalizeTitle('Rules For Discounting'),
    normalizeTitle('Rules for Discounting')
  ]
]);

function normalizedCertificationTitle(title) {
  const normalized = normalizeTitle(title);

  return titleAliases.get(normalized) || normalized;
}

function certificationCourse(path, event) {
  if (path?.type !== 'cert') {
    return '';
  }

  const section = String(event?.section || '');
  const match = section.match(/SECTION\s+(\d+)/i);
  const sectionNumber = Number(match?.[1] || 0);

  if (sectionNumber >= 1 && sectionNumber <= 5) {
    return 'foundations';
  }

  if (sectionNumber >= 6 && sectionNumber <= 10) {
    return 'advanced';
  }

  return '';
}

function findCertificationActivity(
  path,
  event,
  activities
) {
  const courseId = certificationCourse(path, event);

  if (!courseId) {
    return null;
  }

  const wantedTitle =
    normalizedCertificationTitle(event?.title || '');

  const matches = activities.filter(
    (activity) =>
      activity.type === 'video' &&
      activity.courseId === courseId &&
      normalizedCertificationTitle(activity.title) ===
        wantedTitle
  );

  return matches.length === 1
    ? matches[0]
    : null;
}

export async function POST(request) {
  try {
    const managerEmail =
      await getAuthenticatedManager();

    if (!managerEmail) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const body = await request.json();

    const employeeId = String(
      body?.employeeId || ''
    ).trim();

    if (!employeeId) {
      return NextResponse.json(
        { error: 'employeeId is required' },
        { status: 400 }
      );
    }

    const stateResult = await db.query(
      `
        SELECT state
        FROM training_manager_state
        WHERE manager_email = $1
          AND employee_lw_id = $2
        LIMIT 1
      `,
      [managerEmail, employeeId]
    );

    if (stateResult.rows.length === 0) {
      return NextResponse.json(
        {
          error:
            'Training Manager state not found for employee'
        },
        { status: 404 }
      );
    }

    const state = stateResult.rows[0].state || {};

    const courses =
      await fetchAllProgress(employeeId);

    const activities =
      flattenActivities(courses);

    const byUnitId = new Map(
      activities
        .filter((activity) => activity.unitId)
        .map((activity) => [
          String(activity.unitId),
          activity
        ])
    );

    let changed = false;
    let matchedVideos = 0;
    let newlyMapped = 0;
    let newlyCompleted = 0;

    for (const path of state?.paths || []) {
      for (const event of path?.events || []) {
        if (event?.kind !== 'video') {
          continue;
        }

        let activity = null;

        /*
         * Normal case:
         * video already has its permanent activity ID.
         */
        if (event.lwUnitId) {
          activity =
            byUnitId.get(String(event.lwUnitId)) ||
            null;
        }

        /*
         * New Certification paths do not initially
         * contain IDs. Resolve them once from their
         * known course + video title.
         */
        if (
          !activity &&
          path?.type === 'cert'
        ) {
          activity =
            findCertificationActivity(
              path,
              event,
              activities
            );

          if (
            activity &&
            (!event.lwUnitId ||
              !event.lwCourseId)
          ) {
            event.lwCourseId =
              activity.courseId;

            event.lwUnitId =
              activity.unitId;

            changed = true;
            newlyMapped += 1;
          }
        }

        if (!activity) {
          continue;
        }

        matchedVideos += 1;

        if (
          activity.completed === true &&
          event.completed !== true
        ) {
          event.completed = true;

          event.lwCompleted = true;
          event.lwProgress =
            activity.progress;

          event.lwTimeSpentSeconds =
            activity.timeSpentSeconds;

          event.lwDurationSeconds =
            activity.durationSeconds;

          event.lwLastSyncedAt =
            new Date().toISOString();

          if (!event.lwCompletionDetectedAt) {
            event.lwCompletionDetectedAt =
              new Date().toISOString();
          }

          changed = true;
          newlyCompleted += 1;
        }
      }
    }

    const checkedAt =
      new Date().toISOString();

    state.trainingActivityLastCheckedAt =
      checkedAt;

    /*
     * Save if we either:
     * - mapped Certification IDs, or
     * - found new completions.
     */
    if (changed) {
      const updateResult = await db.query(
        `
          UPDATE training_manager_state
          SET
            state = $1::jsonb,
            updated_at = NOW()
          WHERE manager_email = $2
            AND employee_lw_id = $3
          RETURNING state, updated_at
        `,
        [
          JSON.stringify(state),
          managerEmail,
          employeeId
        ]
      );

      return NextResponse.json({
        success: true,
        changed: true,
        matchedVideos,
        newlyMapped,
        newlyCompleted,
        checkedAt,
        state: updateResult.rows[0].state,
        updatedAt:
          updateResult.rows[0].updated_at
      });
    }

    return NextResponse.json({
      success: true,
      changed: false,
      matchedVideos,
      newlyMapped: 0,
      newlyCompleted: 0,
      checkedAt,
      state
    });
  } catch (error) {
    console.error(
      'Server-side training activity sync failed:',
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          'Unable to sync training activity',
        message: error.message,
        details: error.details || null
      },
      {
        status: error.status || 500
      }
    );
  }
}
