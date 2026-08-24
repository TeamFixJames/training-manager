import { NextResponse } from 'next/server';
import { auth0 } from '../../../lib/auth0';
import { db } from '../../../lib/db';

const headers = {
  Authorization: `Bearer ${process.env.LW_TOKEN}`,
  'Lw-Client': process.env.LW_CLIENT_ID,
  Accept: 'application/json'
};

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
      throw new Error(
        payload?.error ||
        `LearnWorlds progress request failed (${response.status})`
      );
    }

    courses.push(...(Array.isArray(payload?.data) ? payload.data : []));

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
          status: unit.unit_status || '',
          completed: unit.unit_status === 'completed',
          progress: Number(unit.unit_progress_rate || 0),
          timeSpentSeconds: Number(unit.time_on_unit || 0)
        });
      }
    }
  }

  return activities;
}

export async function GET(request) {
  try {
    const session = await auth0.getSession();

    if (!session?.user?.email) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const managerEmail = session.user.email.toLowerCase();

    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: 'Missing userId' },
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
      [managerEmail, userId]
    );

    const state = stateResult.rows[0]?.state || {};
    const courses = await fetchAllProgress(userId);
    const activities = flattenActivities(courses);

    const byUnitId = new Map(
      activities
        .filter(a => a.unitId)
        .map(a => [String(a.unitId), a])
    );

    const scheduledVideos = [];

    for (const path of state?.paths || []) {
      for (const event of path?.events || []) {
        if (event?.kind !== 'video') continue;

        const lwActivity = event.lwUnitId
          ? byUnitId.get(String(event.lwUnitId))
          : null;

        scheduledVideos.push({
          pathType: path.type,
          title: event.title,

          trainingManager: {
            completed: event.completed === true,
            lwCourseId: event.lwCourseId || '',
            lwUnitId: event.lwUnitId || ''
          },

          learnWorlds: lwActivity
            ? {
                found: true,
                courseId: lwActivity.courseId,
                unitId: lwActivity.unitId,
                title: lwActivity.title,
                status: lwActivity.status,
                completed: lwActivity.completed,
                progress: lwActivity.progress,
                timeSpentSeconds: lwActivity.timeSpentSeconds
              }
            : {
                found: false
              }
        });
      }
    }

    return NextResponse.json({
      success: true,
      checkedAt: new Date().toISOString(),
      userId,
      learnWorldsActivityCount: activities.length,
      scheduledVideoCount: scheduledVideos.length,
      scheduledVideos
    });
  } catch (error) {
    console.error('Training sync debug failed:', error);

    return NextResponse.json(
      {
        success: false,
        error: error.message
      },
      { status: 500 }
    );
  }
}
