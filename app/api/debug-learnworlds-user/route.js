import { NextResponse } from 'next/server';
import { auth0 } from '../../../lib/auth0';

async function getAuthenticatedManager() {
  const session = await auth0.getSession();

  if (!session?.user?.email) {
    return null;
  }

  return session.user.email.toLowerCase();
}

export async function POST(request) {
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

    const body =
      await request.json();

    const employeeId =
      String(
        body?.employeeId || ''
      ).trim();

    if (!employeeId) {
      return NextResponse.json(
        {
          success: false,
          error: 'employeeId is required'
        },
        {
          status: 400
        }
      );
    }

    const response = await fetch(
      `${process.env.LW_API_URL}/users/${encodeURIComponent(
        employeeId
      )}`,
      {
        headers: {
          Authorization:
            `Bearer ${process.env.LW_TOKEN}`,

          'Lw-Client':
            process.env.LW_CLIENT_ID,

          Accept:
            'application/json'
        },

        cache:
          'no-store'
      }
    );

    const payload =
      await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error:
            'LearnWorlds user request failed',

          status:
            response.status,

          payload
        },
        {
          status:
            response.status
        }
      );
    }

    /*
     * TEMPORARY DIAGNOSTIC ROUTE
     *
     * Return the LearnWorlds response
     * exactly as received so we can see
     * every available user field.
     */
    return NextResponse.json({
      success: true,

      employeeId,

      managerEmail,

      rawUser:
        payload
    });
  } catch (error) {
    console.error(
      'LearnWorlds user diagnostic failed:',
      error
    );

    return NextResponse.json(
      {
        success: false,

        error:
          'Unable to retrieve LearnWorlds user',

        message:
          error.message
      },
      {
        status: 500
      }
    );
  }
}
