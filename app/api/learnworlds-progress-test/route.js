import { NextResponse } from 'next/server';
import { auth0 } from '../../../lib/auth0';

const headers = {
  Authorization: `Bearer ${process.env.LW_TOKEN}`,
  'Lw-Client': process.env.LW_CLIENT_ID,
  Accept: 'application/json'
};

async function testEndpoint(label, path) {
  try {
    const response = await fetch(
      `${process.env.LW_API_URL}${path}`,
      {
        headers,
        cache: 'no-store'
      }
    );

    let data;

    try {
      data = await response.json();
    } catch {
      data = await response.text();
    }

    return {
      label,
      path,
      status: response.status,
      ok: response.ok,
      data
    };
  } catch (error) {
    return {
      label,
      path,
      ok: false,
      error: error.message
    };
  }
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
        example:
          '/api/learnworlds-progress-test?userId=LEARNWORLDS_USER_ID'
      },
      { status: 400 }
    );
  }

  const tests = await Promise.all([
    testEndpoint(
      'User courses',
      `/users/${encodeURIComponent(userId)}/courses`
    ),

    testEndpoint(
      'User progress',
      `/users/${encodeURIComponent(userId)}/progress`
    ),

    testEndpoint(
      'User activities',
      `/users/${encodeURIComponent(userId)}/activities`
    ),

    testEndpoint(
      'User course progress',
      `/users/${encodeURIComponent(userId)}/course-progress`
    )
  ]);

  return NextResponse.json({
    userId,
    tests
  });
}
