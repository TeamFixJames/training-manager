import { NextResponse } from 'next/server';
import { auth0 } from '../../../lib/auth0';

const lwHeaders = {
  Authorization: `Bearer ${process.env.LW_TOKEN}`,
  'Lw-Client': process.env.LW_CLIENT_ID,
  'Content-Type': 'application/json',
  Accept: 'application/json'
};

async function lwGet(path) {
  const response = await fetch(`${process.env.LW_API_URL}${path}`, {
    headers: lwHeaders,
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

/*
 * LearnWorlds returns created and last_login
 * as Unix timestamps with fractional seconds.
 *
 * Convert those to ISO timestamps before
 * sending them to the dashboard.
 */
function unixToIso(value) {
  const timestamp = Number(value);

  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }

  return new Date(timestamp * 1000).toISOString();
}

export async function GET() {
  const session = await auth0.getSession();

  if (!session?.user?.email) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  try {
    const manager = await lwGet(
      `/users/${encodeURIComponent(session.user.email)}`
    );

    if (!manager?.id) {
      return NextResponse.json(
        { error: 'Matching LearnWorlds manager was not found' },
        { status: 404 }
      );
    }

    const managerTags = Array.isArray(manager.tags) ? manager.tags : [];

    const isSeatManager =
      managerTags.includes('Sales Fix: Account Type: seat-manager') ||
      managerTags.includes('Sales Fix: Account Type: add-seat-manager');

    if (!isSeatManager) {
      return NextResponse.json(
        { error: 'Authenticated user is not a Sales Fix seat manager' },
        { status: 403 }
      );
    }

    const managerSeatsResponse = await lwGet(
      `/users/${manager.id}/seats`
    );

    const managerSeats = Array.isArray(managerSeatsResponse?.data?.seats)
      ? managerSeatsResponse.data.seats
      : [];

    if (managerSeats.length === 0) {
      return NextResponse.json(
        {
          error: 'No seat offering was found for this manager',
          manager: {
            id: manager.id,
            email: manager.email
          }
        },
        { status: 404 }
      );
    }

    /*
     * Match the behavior of the existing
     * Sales Fix manager app.
     *
     * A seat manager does not need their
     * own seat membership to be marked
     * active in order to manage the offering.
     */
    const managedSeat = managerSeats[0];

    const seatUsersResponse = await lwGet(
      `/seats/${encodeURIComponent(managedSeat.id)}/users`
    );

    const seatUsers = Array.isArray(seatUsersResponse?.data)
      ? seatUsersResponse.data
      : [];

    const employees = [];

    for (const user of seatUsers) {
      const tags = Array.isArray(user.tags) ? user.tags : [];

      const isStudent =
        tags.some((tag) => tag.includes('Student')) &&
        !tags.some((tag) => tag.includes('seat-manager'));

      if (!isStudent) {
        continue;
      }

      let activeInOffering = false;

      try {
        const userSeatsResponse = await lwGet(
          `/users/${user.id}/seats`
        );

        const userSeats = Array.isArray(
          userSeatsResponse?.data?.seats
        )
          ? userSeatsResponse.data.seats
          : [];

        const offeringSeat = userSeats.find(
          (seat) => seat.id === managedSeat.id
        );

        activeInOffering = offeringSeat?.active === true;
      } catch {
        activeInOffering = false;
      }

      if (!activeInOffering) {
        continue;
      }

      /*
       * NEW:
       *
       * Retrieve the complete LearnWorlds
       * user record.
       *
       * Our diagnostic confirmed that this
       * object contains last_login and created.
       *
       * If this supplemental request fails,
       * we still keep the employee in the
       * roster. Their activity timestamps
       * will simply be unavailable.
       */
      let userDetail = null;

      try {
        userDetail = await lwGet(
          `/users/${encodeURIComponent(user.id)}`
        );
      } catch (error) {
        console.error(
          `Unable to load activity metadata for LearnWorlds user ${user.id}:`,
          error
        );
      }

      employees.push({
        id: user.id,
        email: user.email,
        firstName: user.fields?.cf_firstname || '',
        lastName: user.fields?.cf_lastname || '',

        fullName:
          `${user.fields?.cf_firstname || ''} ${
            user.fields?.cf_lastname || ''
          }`.trim() || user.email,

        status: user.status || 'active',
        tags,

        /*
         * NEW ACTIVITY DATA
         */
        lastLogin: unixToIso(
          userDetail?.last_login
        ),

        createdAt: unixToIso(
          userDetail?.created
        )
      });
    }

    employees.sort((a, b) =>
      a.fullName.localeCompare(
        b.fullName,
        undefined,
        {
          sensitivity: 'base'
        }
      )
    );

    return NextResponse.json({
      manager: {
        id: manager.id,
        email: manager.email,
        firstName:
          manager.fields?.cf_firstname || '',
        lastName:
          manager.fields?.cf_lastname || ''
      },

      seatOffering: {
        id: managedSeat.id,
        title: managedSeat.title || '',
        active: managedSeat.active === true,
        gotSeatOn:
          managedSeat.got_seat_on || null
      },

      employeeCount: employees.length,

      employees,

      additionalSeatOfferings: Math.max(
        0,
        managerSeats.length - 1
      )
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          'Unable to load manager team from LearnWorlds',

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
