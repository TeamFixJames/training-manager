import { NextResponse } from 'next/server';
import { auth0 } from '../../../lib/auth0';
import { db } from '../../../lib/db';

const PASSING_SCORE = 80;

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
      `${process.env.LW_API_URL}/users/${encodeURIComponent(
        userId
      )}/progress?page=${page}`,
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
      ...(Array.isArray(payload?.data)
        ? payload.data
        : [])
    );

    totalPages = Number(
      payload?.meta?.totalPages || 1
    );

    page += 1;
  } while (page <= totalPages);

  return courses;
}

function flattenActivities(courses) {
  const activities = [];

  for (const course of courses) {
    for (
      const section of
      course?.progress_per_section_unit || []
    ) {
      for (const unit of section?.units || []) {
        activities.push({
          courseId: course.course_id || '',
          sectionId: section.section_id || '',
          sectionName: section.section_name || '',
          unitId: unit.unit_id || '',
          title: unit.unit_name || '',
          type: unit.unit_type || '',

          completed:
            unit.unit_status === 'completed',

          progress: Number(
            unit.unit_progress_rate || 0
          ),

          score:
            typeof unit.score_on_unit === 'number'
              ? unit.score_on_unit
              : typeof unit.score === 'number'
                ? unit.score
                : null,

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
    normalizeTitle(
      'Technician Quote & Close Ratio'
    ),
    normalizeTitle(
      'Technician Quote and Close Ratio'
    )
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
    normalizeTitle(
      'Why Scripting is Important'
    ),
    normalizeTitle(
      'Why Scripting Is Important'
    )
  ],
  [
    normalizeTitle(
      'Delivering Good News vs Bad News'
    ),
    normalizeTitle(
      'Delivering Good News vs. Bad News'
    )
  ],
  [
    normalizeTitle(
      'Overcoming No’s and Objections'
    ),
    normalizeTitle(
      "Overcoming No's and Objections"
    )
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

  return (
    titleAliases.get(normalized) ||
    normalized
  );
}

function certificationCourse(path, event) {
  if (path?.type !== 'cert') {
    return '';
  }

  const section = String(
    event?.section || ''
  );

  const match = section.match(
    /SECTION\s+(\d+)/i
  );

  const sectionNumber = Number(
    match?.[1] || 0
  );

  if (
    sectionNumber >= 1 &&
    sectionNumber <= 5
  ) {
    return 'foundations';
  }

  if (
    sectionNumber >= 6 &&
    sectionNumber <= 10
  ) {
    return 'advanced';
  }

  return '';
}

function findCertificationActivity(
  path,
  event,
  activities
) {
  const courseId =
    certificationCourse(path, event);

  if (!courseId) {
    return null;
  }

  const wantedTitle =
    normalizedCertificationTitle(
      event?.title || ''
    );

  const matches = activities.filter(
    (activity) =>
      activity.type === 'video' &&
      activity.courseId === courseId &&
      normalizedCertificationTitle(
        activity.title
      ) === wantedTitle
  );

  return matches.length === 1
    ? matches[0]
    : null;
}

/*
 * Required section exams.
 *
 * The LMS only marks these exams complete
 * after they have been passed.
 */
const SECTION_EXAMS = [
  {
    section: 1,
    courseId: 'foundations',
    title:
      'TEST - Next Level Leadership and Culture'
  },
  {
    section: 2,
    courseId: 'foundations',
    title: 'TEST - Selling 101'
  },
  {
    section: 3,
    courseId: 'foundations',
    title:
      'TEST - Making a Great Impression'
  },
  {
    section: 4,
    courseId: 'foundations',
    title:
      'TEST - Know Confidence and No Fear'
  },
  {
    section: 5,
    courseId: 'foundations',
    title:
      'TEST - Untapped Resources'
  },
  {
    section: 6,
    courseId: 'advanced',
    title:
      'TEST - Tracking Your Numbers'
  },
  {
    section: 7,
    courseId: 'advanced',
    title: 'TEST - Scripting'
  },
  {
    section: 8,
    courseId: 'advanced',
    title:
      'TEST - Wowing Your Customer'
  },
  {
    section: 9,
    courseId: 'advanced',
    title:
      'TEST - High Level Sales: Part 1'
  },
  {
    section: 10,
    courseId: 'advanced',
    title:
      'TEST - High Level Sales: Part 2'
  }
];

const CERTIFICATION_EXAMS = {
  level1: {
    courseId:
      'salesfixcert2026levelone',

    unitId:
      '68dbead9dcda1518060590fc',

    title:
      '2026 Level One Certification Exam'
  },

  level2: {
    courseId:
      'salesfixcert2026l2',

    unitId:
      '68a4daed4cf3192de30aa0ea',

    title:
      '2026 Level 2 Sales Fix Certification'
  }
};

function findSectionExam(
  exam,
  activities
) {
  const wantedTitle =
    normalizeTitle(exam.title);

  const matches = activities.filter(
    (activity) =>
      activity.courseId === exam.courseId &&
      activity.type === 'assessmentV2' &&
      normalizeTitle(activity.title) ===
        wantedTitle
  );

  return matches.length === 1
    ? matches[0]
    : null;
}

function buildSectionExamState(
  activities
) {
  return SECTION_EXAMS.map((exam) => {
    const activity =
      findSectionExam(
        exam,
        activities
      );

    const score =
      typeof activity?.score === 'number'
        ? activity.score
        : null;

    const completed =
      activity?.completed === true;

    /*
     * Completion status is authoritative.
     *
     * The LMS does not mark the required
     * section exam complete until it has
     * been passed.
     */
    const passed = completed;

    return {
      section: exam.section,
      courseId: exam.courseId,
      unitId: activity?.unitId || '',
      title: exam.title,

      completed,
      passed,

      score,
      requiredScore: PASSING_SCORE,

      passSource:
        'completion_status'
    };
  });
}

function buildCertificationExamState(
  definition,
  activities
) {
  const activity =
    activities.find(
      (item) =>
        item.courseId ===
          definition.courseId &&
        item.unitId ===
          definition.unitId
    );

  const completed =
    activity?.completed === true;

  const score =
    typeof activity?.score === 'number'
      ? activity.score
      : null;

  const progress =
    typeof activity?.progress === 'number'
      ? activity.progress
      : 0;

  const timeSpentSeconds =
    Number(
      activity?.timeSpentSeconds || 0
    );

  return {
    courseId:
      definition.courseId,

    unitId:
      definition.unitId,

    title:
      definition.title,

    found:
      Boolean(activity),

    completed,

    /*
     * Certification exam pass status
     * follows LMS completion status.
     */
    passed:
      completed,

    score,

    progress,

    attempted:
      Boolean(
        activity &&
        (
          progress > 0 ||
          timeSpentSeconds > 0 ||
          completed
        )
      ),

    timeSpentSeconds,

    passSource:
      'completion_status'
  };
}

function calculateLevel1Readiness(
  state,
  sectionExams
) {
  const certificationPaths =
    (state?.paths || []).filter(
      (path) =>
        path?.type === 'cert'
    );

  /*
   * An employee should normally only
   * have one Path to Certification.
   *
   * If duplicate paths exist, each
   * required video is still counted once.
   */
  const uniqueVideos =
    new Map();

  for (
    const path of
    certificationPaths
  ) {
    for (
      const event of
      path?.events || []
    ) {
      if (
        event?.kind !== 'video'
      ) {
        continue;
      }

      const key =
        event.lwUnitId
          ? `unit:${event.lwUnitId}`
          : `title:${String(
              event.section || ''
            )}:${normalizedCertificationTitle(
              event.title || ''
            )}`;

      const existing =
        uniqueVideos.get(key);

      if (!existing) {
        uniqueVideos.set(
          key,
          event
        );
      } else if (
        event.completed === true &&
        existing.completed !== true
      ) {
        /*
         * If duplicate paths disagree,
         * preserve the completed copy.
         */
        uniqueVideos.set(
          key,
          event
        );
      }
    }
  }

  const certificationVideos =
    Array.from(
      uniqueVideos.values()
    );

  const requiredVideoCount =
    certificationVideos.length;

  const completedVideoCount =
    certificationVideos.filter(
      (event) =>
        event.completed === true
    ).length;

  const requiredSectionExamCount =
    sectionExams.length;

  const passedSectionExamCount =
    sectionExams.filter(
      (exam) =>
        exam.passed === true
    ).length;

  const allVideosComplete =
    requiredVideoCount > 0 &&
    completedVideoCount ===
      requiredVideoCount;

  const allSectionExamsPassed =
    requiredSectionExamCount === 10 &&
    passedSectionExamCount ===
      requiredSectionExamCount;

  return {
    ready:
      allVideosComplete &&
      allSectionExamsPassed,

    allVideosComplete,
    allSectionExamsPassed,

    requiredVideoCount,
    completedVideoCount,

    requiredSectionExamCount,
    passedSectionExamCount,

    remainingVideoCount:
      Math.max(
        0,
        requiredVideoCount -
          completedVideoCount
      ),

    remainingSectionExamCount:
      Math.max(
        0,
        requiredSectionExamCount -
          passedSectionExamCount
      ),

    passingScore:
      PASSING_SCORE
  };
}

export async function POST(
  request
) {
  try {
    const managerEmail =
      await getAuthenticatedManager();

    if (!managerEmail) {
      return NextResponse.json(
        {
          error:
            'Not authenticated'
        },
        {
          status: 401
        }
      );
    }

    const body =
      await request.json();

    const employeeId =
      String(
        body?.employeeId || ''
      ).trim();

    if (!employeeId) {
      return NextResponse.json(
        {
          error:
            'employeeId is required'
        },
        {
          status: 400
        }
      );
    }

    const stateResult =
      await db.query(
        `
          SELECT state
          FROM training_manager_state
          WHERE manager_email = $1
            AND employee_lw_id = $2
          LIMIT 1
        `,
        [
          managerEmail,
          employeeId
        ]
      );

    if (
      stateResult.rows.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            'Training Manager state not found for employee'
        },
        {
          status: 404
        }
      );
    }

    const state =
      stateResult.rows[0].state ||
      {};

    const courses =
      await fetchAllProgress(
        employeeId
      );

    const activities =
      flattenActivities(
        courses
      );

    const byUnitId =
      new Map(
        activities
          .filter(
            (activity) =>
              activity.unitId
          )
          .map(
            (activity) => [
              String(
                activity.unitId
              ),
              activity
            ]
          )
      );

    let changed = false;
    let matchedVideos = 0;
    let newlyMapped = 0;
    let newlyCompleted = 0;

    /*
     * ----------------------------
     * VIDEO COMPLETION SYNC
     * ----------------------------
     */
    for (
      const path of
      state?.paths || []
    ) {
      for (
        const event of
        path?.events || []
      ) {
        if (
          event?.kind !== 'video'
        ) {
          continue;
        }

        let activity = null;

        if (event.lwUnitId) {
          activity =
            byUnitId.get(
              String(
                event.lwUnitId
              )
            ) || null;
        }

        /*
         * Newly-created Certification
         * paths may not yet have IDs.
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
            (
              !event.lwUnitId ||
              !event.lwCourseId
            )
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

          if (
            !event.lwCompletionDetectedAt
          ) {
            event.lwCompletionDetectedAt =
              new Date().toISOString();
          }

          changed = true;
          newlyCompleted += 1;
        }
      }
    }

    /*
     * ----------------------------
     * SECTION EXAMS
     * ----------------------------
     */
    const sectionExams =
      buildSectionExamState(
        activities
      );

    /*
     * ----------------------------
     * LEVEL 1 READINESS
     * ----------------------------
     */
    const level1Readiness =
      calculateLevel1Readiness(
        state,
        sectionExams
      );

    /*
     * ----------------------------
     * CERTIFICATION EXAMS
     * ----------------------------
     */
    const level1Exam =
      buildCertificationExamState(
        CERTIFICATION_EXAMS.level1,
        activities
      );

    const level2Exam =
      buildCertificationExamState(
        CERTIFICATION_EXAMS.level2,
        activities
      );

    /*
     * Build the complete Certification
     * state without timestamps so normal
     * background checks do not cause
     * unnecessary visual refreshes.
     */
    const nextCertification = {
      ...(state.certification || {}),

      sectionExams,

      level1: {
        ...level1Readiness,

        passed:
          level1Exam.passed === true,

        exam:
          level1Exam
      },

      level2: {
        /*
         * Level 2 becomes available only
         * after Level 1 has actually passed.
         */
        available:
          level1Exam.passed === true,

        passed:
          level2Exam.passed === true,

        exam:
          level2Exam
      }
    };

    const previousCertification =
      JSON.stringify(
        state.certification || {}
      );

    const nextCertificationString =
      JSON.stringify(
        nextCertification
      );

    if (
      previousCertification !==
      nextCertificationString
    ) {
      changed = true;
    }

    state.certification =
      nextCertification;

    const checkedAt =
      new Date().toISOString();

    /*
     * This timestamp is informational
     * only and is NOT used when deciding
     * whether the visible certification
     * state changed.
     */
    state.trainingActivityLastCheckedAt =
      checkedAt;

    /*
     * ----------------------------
     * SAVE UPDATED STATE
     * ----------------------------
     */
    if (changed) {
      const updateResult =
        await db.query(
          `
            UPDATE training_manager_state

            SET
              state = $1::jsonb,
              updated_at = NOW()

            WHERE
              manager_email = $2
              AND employee_lw_id = $3

            RETURNING
              state,
              updated_at
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

        sectionExams,

        level1:
          nextCertification.level1,

        level2:
          nextCertification.level2,

        checkedAt,

        state:
          updateResult.rows[0]
            .state,

        updatedAt:
          updateResult.rows[0]
            .updated_at
      });
    }

    return NextResponse.json({
      success: true,
      changed: false,

      matchedVideos,
      newlyMapped: 0,
      newlyCompleted: 0,

      sectionExams,

      level1:
        nextCertification.level1,

      level2:
        nextCertification.level2,

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

        message:
          error.message,

        details:
          error.details || null
      },
      {
        status:
          error.status || 500
      }
    );
  }
}
