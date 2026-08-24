import { NextResponse } from 'next/server';
import { auth0 } from '../../../lib/auth0';

const headers = {
  Authorization: `Bearer ${process.env.LW_TOKEN}`,
  'Lw-Client': process.env.LW_CLIENT_ID,
  Accept: 'application/json'
};

async function fetchJson(url) {
  const response = await fetch(url, {
    headers,
    cache: 'no-store'
  });

  const data = await response.json();

  if (!response.ok) {
    const error = new Error(`LearnWorlds request failed: ${response.status}`);
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

async function fetchAllProgressPages(userId) {
  const allCourses = [];
  let page = 1;
  let totalPages = 1;

  do {
    const url =
      `${process.env.LW_API_URL}/users/${encodeURIComponent(userId)}/progress` +
      `?page=${page}`;

    const payload = await fetchJson(url);

    const courses = Array.isArray(payload?.data) ? payload.data : [];
    allCourses.push(...courses);

    totalPages = Number(payload?.meta?.totalPages || 1);
    page += 1;
  } while (page <= totalPages);

  return allCourses;
}

function flattenProgress(courses) {
  const activities = [];

  for (const course of courses) {
    const sections = Array.isArray(course?.progress_per_section_unit)
      ? course.progress_per_section_unit
      : [];

    for (const section of sections) {
      const units = Array.isArray(section?.units) ? section.units : [];

      for (const unit of units) {
        activities.push({
          courseId: course.course_id || '',
          courseStatus: course.status || '',
          courseProgress: Number(course.progress_rate || 0),

          sectionId: section.section_id || '',
          sectionName: unit.unit_section_name || '',

          unitId: unit.unit_id || '',
          title: unit.unit_name || '',
          type: unit.unit_type || '',

          status: unit.unit_status || '',
          completed: unit.unit_status === 'completed',
          progress: Number(unit.unit_progress_rate || 0),

          durationSeconds:
            typeof unit.unit_duration === 'number'
              ? unit.unit_duration
              : null,

          timeSpentSeconds:
            typeof unit.time_on_unit === 'number'
              ? unit.time_on_unit
              : 0,

          score:
            typeof unit.score_on_unit === 'number'
              ? unit.score_on_unit
              : null
        });
      }
    }
  }

  return activities;
}

export async function GET(request) {
  const session = await auth0.getSession();

  if (!session?.user?.email) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');

  if (!userId) {
    return NextResponse.json(
      {
        error: 'Missing userId',
        example: '/api/training-progress?userId=LEARNWORLDS_USER_ID'
      },
      { status: 400 }
    );
  }

  try {
    const courses = await fetchAllProgressPages(userId);
    const activities = flattenProgress(courses);

    const completedActivities = activities.filter(
      (activity) => activity.completed
    );

    const completedVideos = completedActivities.filter(
      (activity) => activity.type === 'video'
    );

    const totalVideoTimeSeconds = completedVideos.reduce(
      (sum, activity) =>
        sum + (activity.timeSpentSeconds || activity.durationSeconds || 0),
      0
    );

    return NextResponse.json({
      success: true,
      userId,

      summary: {
        courseCount: courses.length,
        activityCount: activities.length,
        completedActivityCount: completedActivities.length,
        completedVideoCount: completedVideos.length,
        totalVideoTimeSeconds
      },

      courses: courses.map((course) => ({
        courseId: course.course_id || '',
        status: course.status || '',
        progress: Number(course.progress_rate || 0),
        averageScore: Number(course.average_score_rate || 0),
        timeOnCourseSeconds: Number(course.time_on_course || 0),
        totalUnits: Number(course.total_units || 0),
        completedUnits: Number(course.completed_units || 0),
        completedAt: course.completed_at || null
      })),

      activities
    });
  } catch (error) {
    console.error('Training progress lookup failed:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Unable to load LearnWorlds training progress',
        message: error.message,
        details: error.details || null
      },
      { status: error.status || 500 }
    );
  }
}
