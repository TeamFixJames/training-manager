import { NextResponse } from 'next/server';
import { auth0 } from '../../../lib/auth0';
import { db } from '../../../lib/db';

async function getAuthenticatedManager() {
  const session = await auth0.getSession();

  if (!session?.user?.email) {
    return null;
  }

  return session.user.email.toLowerCase();
}

function safeWeeks(value) {
  const weeks = Number(value);

  if (!Number.isFinite(weeks)) {
    return 12;
  }

  /*
   * Keep historical requests reasonably bounded.
   *
   * The dashboard currently uses 4, 8, and 12
   * weeks, but allowing up to 52 gives us room
   * for future annual reporting.
   */
  return Math.max(
    1,
    Math.min(
      52,
      Math.round(weeks)
    )
  );
}

function isoDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date
    .toISOString()
    .slice(0, 10);
}

export async function GET(request) {
  try {
    const managerEmail =
      await getAuthenticatedManager();

    if (!managerEmail) {
      return NextResponse.json(
        {
          success: false,
          error: 'Not authenticated'
        },
        {
          status: 401
        }
      );
    }

    const url =
      new URL(request.url);

    const weeks =
      safeWeeks(
        url.searchParams.get('weeks')
      );

    const employeeId =
      String(
        url.searchParams.get(
          'employeeId'
        ) || ''
      ).trim();

    /*
     * Include today plus the requested
     * number of historical weeks.
     */
    const today =
      new Date();

    today.setUTCHours(
      0,
      0,
      0,
      0
    );

    const start =
      new Date(today);

    start.setUTCDate(
      start.getUTCDate() -
        ((weeks * 7) - 1)
    );

    const startDate =
      isoDate(start);

    const endDate =
      isoDate(today);

    /*
     * training_manager_state is joined so
     * the API can return the employee name
     * along with each historical snapshot.
     *
     * manager_email is ALWAYS part of the
     * WHERE clause. employeeId is only an
     * optional additional filter.
     */
    const params = [
      managerEmail,
      startDate,
      endDate
    ];

    let employeeFilter = '';

    if (employeeId) {
      params.push(employeeId);

      employeeFilter = `
        AND snapshots.employee_lw_id = $4
      `;
    }

    const result =
      await db.query(
        `
          SELECT
            snapshots.employee_lw_id,

            COALESCE(
              state.state->>'name',
              snapshots.employee_lw_id
            ) AS employee_name,

            snapshots.snapshot_date::text
              AS snapshot_date,

            snapshots.video_study_seconds,

            snapshots.certification_video_complete,

            snapshots.certification_video_total,

            snapshots.section_exams_passed,

            snapshots.section_exams_total,

            snapshots.certification_percent,

            snapshots.level1_passed,

            snapshots.level2_passed,

            snapshots.captured_at

          FROM
            training_manager_snapshots
              AS snapshots

          LEFT JOIN
            training_manager_state
              AS state

            ON
              state.manager_email =
                snapshots.manager_email

              AND state.employee_lw_id =
                snapshots.employee_lw_id

          WHERE
            snapshots.manager_email = $1

            AND snapshots.snapshot_date
              >= $2::date

            AND snapshots.snapshot_date
              <= $3::date

            ${employeeFilter}

          ORDER BY
            snapshots.snapshot_date ASC,
            employee_name ASC
        `,
        params
      );

    const snapshots =
      result.rows.map(
        (row) => ({
          employeeId:
            String(
              row.employee_lw_id
            ),

          employeeName:
            row.employee_name ||
            row.employee_lw_id,

          snapshotDate:
            row.snapshot_date,

          videoStudySeconds:
            Number(
              row.video_study_seconds ||
              0
            ),

          certificationVideoComplete:
            Number(
              row.certification_video_complete ||
              0
            ),

          certificationVideoTotal:
            Number(
              row.certification_video_total ||
              0
            ),

          sectionExamsPassed:
            Number(
              row.section_exams_passed ||
              0
            ),

          sectionExamsTotal:
            Number(
              row.section_exams_total ||
              0
            ),

          certificationPercent:
            Number(
              row.certification_percent ||
              0
            ),

          level1Passed:
            row.level1_passed === true,

          level2Passed:
            row.level2_passed === true,

          capturedAt:
            row.captured_at
        })
      );

    /*
     * Create a small employee summary so
     * the dashboard does not have to repeat
     * this grouping logic itself.
     */
    const employeeMap =
      new Map();

    for (const snapshot of snapshots) {
      if (
        !employeeMap.has(
          snapshot.employeeId
        )
      ) {
        employeeMap.set(
          snapshot.employeeId,
          {
            employeeId:
              snapshot.employeeId,

            employeeName:
              snapshot.employeeName,

            snapshotCount: 0,

            firstSnapshotDate:
              snapshot.snapshotDate,

            latestSnapshotDate:
              snapshot.snapshotDate
          }
        );
      }

      const employee =
        employeeMap.get(
          snapshot.employeeId
        );

      employee.snapshotCount += 1;

      if (
        snapshot.snapshotDate <
        employee.firstSnapshotDate
      ) {
        employee.firstSnapshotDate =
          snapshot.snapshotDate;
      }

      if (
        snapshot.snapshotDate >
        employee.latestSnapshotDate
      ) {
        employee.latestSnapshotDate =
          snapshot.snapshotDate;
      }
    }

    return NextResponse.json({
      success: true,

      range: {
        weeks,
        startDate,
        endDate
      },

      employeeFilter:
        employeeId || null,

      snapshotCount:
        snapshots.length,

      employees:
        Array.from(
          employeeMap.values()
        ),

      snapshots
    });
  } catch (error) {
    console.error(
      'Training trends request failed:',
      error
    );

    return NextResponse.json(
      {
        success: false,

        error:
          'Unable to load training trends',

        message:
          error.message
      },
      {
        status:
          error.status || 500
      }
    );
  }
}
