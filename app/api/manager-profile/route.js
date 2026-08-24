import { NextResponse } from 'next/server';
import { auth0 } from '../../../lib/auth0';

export async function GET() {
  const session = await auth0.getSession();

  if (!session?.user?.email) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  const email = session.user.email;

  try {
    const response = await fetch(
      `${process.env.LW_API_URL}/users/${encodeURIComponent(email)}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.LW_TOKEN}`,
          'Lw-Client': process.env.LW_CLIENT_ID,
          Accept: 'application/json'
        },
        cache: 'no-store'
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          error: 'LearnWorlds lookup failed',
          status: response.status,
          details: data
        },
        { status: response.status }
      );
    }

    return NextResponse.json({
      authenticatedUser: {
        email: session.user.email,
        name: session.user.name || null
      },
      learnWorldsUser: {
        id: data.id,
        email: data.email,
        firstName: data.fields?.cf_firstname || null,
        lastName: data.fields?.cf_lastname || null,
        tags: data.tags || []
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Unable to connect to LearnWorlds',
        message: error.message
      },
      { status: 500 }
    );
  }
}
