import { NextResponse } from 'next/server';
import { auth0 } from '../../../lib/auth0';

const lwHeaders = {
  Authorization: `Bearer ${process.env.LW_TOKEN}`,
  'Lw-Client': process.env.LW_CLIENT_ID,
  'Content-Type': 'application/json',
  Accept: 'application/json'
};

function unixToIso(value) {
  const n = Number(value);

  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }

  return new Date(n * 1000).toISOString();
}

async function lwGet(path) {
  const response = await fetch(
    `${process.env.LW_API_URL}${path}`,
    {
      headers: lwHeaders,
      cache: 'no-store'
    }
  );

  const data = await response.json();

  if (!response.ok) {
    const error = new Error(
      `LearnWorlds request failed: ${response.status}`
    );

    error.status = response.status;
    error.details = data;

    throw error;
  }

  return data;
}

export async function GET() {
  const session = await auth0.getSession();

  if (!session?.user?.email) {
    return NextResponse.json(
      {
        error: 'Not authenticated'
      },
      {
        status: 401
      }
    );
  }

  try {
    /*
     * Find the authenticated manager's
     * LearnWorlds user record.
     */
    const manager = await lwGet(
      `/users/${encodeURIComponent(
        session.user.email
      )}`
    );

    if (!manager?.id) {
      return NextResponse.json(
        {
          error:
            'Matching LearnWorlds manager was not found'
        },
        {
          status: 404
        }
      );
    }

    /*
     * Confirm this user is actually
     * a Sales Fix seat manager.
     */
    const managerTags =
      Array.isArray(manager.tags)
        ? manager.tags
        : [];

    const isSeatManager =
      managerTags.includes(
        'Sales Fix: Account Type: seat-manager'
      ) ||
      managerTags.includes(
        'Sales Fix: Account Type: add-seat-manager'
      );

    if (!isSeatManager) {
      return NextResponse.json(
        {
          error:
            'Authenticated user is not a Sales Fix seat manager'
        },
        {
          status: 403
        }
      );
    }

    /*
     * Get the seat offerings belonging
     * to this manager.
     */
    const managerSeatsResponse =
      await lwGet(
        `/users/${manager.id}/seats`
      );

    const managerSeats =
      Array.isArray(
        managerSeatsResponse?.data?.seats
      )
        ? managerSeatsResponse.data.seats
        : [];

    const activeManagerSeats =
      managerSeats.filter(
        (seat) => seat?.active === true
      );

    if (
      activeManagerSeats.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            'No active seat offering was found for this manager',

          manager: {
            id: manager.id,
            email: manager.email
          }
        },
        {
          status: 404
        }
      );
    }

    /*
     * Training Manager currently uses
     * the manager's first active
     * seat offering.
     */
    const managedSeat =
      activeManagerSeats[0];

    /*
     * Get all users associated with
     * that seat offering.
     */
    const seatUsersResponse =
      await lwGet(
        `/seats/${encodeURIComponent(
          managedSeat.id
        )}/users`
      );

    const seatUsers =
      Array.isArray(
        seatUsersResponse?.data
      )
        ? seatUsersResponse.data
        : [];

    const employees = [];

    for (const user of seatUsers) {
      const tags =
        Array.isArray(user.tags)
          ? user.tags
          : [];

      /*
       * Only include student accounts.
       * Seat managers themselves should
       * not appear as employees.
       */
      const isStudent =
        tags.some(
          (tag) =>
            tag.includes('Student')
        ) &&
        !tags.some(
          (tag) =>
            tag.includes(
              'seat-manager'
            )
        );

      if (!isStudent) {
        continue;
      }

      /*
       * Confirm the employee is still
       * active in this seat offering.
       */
      let activeInOffering = false;

      try {
        const userSeatsResponse =
          await lwGet(
            `/users/${user.id}/seats`
          );

        const userSeats =
          Array.isArray(
            userSeatsResponse
              ?.data?.seats
          )
            ? userSeatsResponse
                .data.seats
            : [];

        const offeringSeat =
          userSeats.find(
            (seat) =>
              seat.id ===
              managedSeat.id
          );

        activeInOffering =
          offeringSeat?.active === true;
      } catch {
        activeInOffering = false;
      }

      if (!activeInOffering) {
        continue;
      }

      /*
       * IMPORTANT:
       *
       * The seat-user response does
       * not always contain the full
       * LearnWorlds user object.
       *
       * Retrieve the complete user
       * record so we have authoritative
       * Last Login and Created values
       * for engagement reporting.
       */
      let userDetail = user;

      try {
        userDetail =
          await lwGet(
            `/users/${encodeURIComponent(
              user.id
            )}`
          );
      } catch {
        /*
         * Do not break the roster if
         * this supplemental request
         * happens to fail.
         */
        userDetail = user;
      }

      employees.push({
        id: user.id,

        email:
          userDetail.email ||
          user.email,

        firstName:
          userDetail.fields
            ?.cf_firstname ||
          user.fields
            ?.cf_firstname ||
          '',

        lastName:
          userDetail.fields
            ?.cf_lastname ||
          user.fields
            ?.cf_lastname ||
          '',

        fullName:
          `${
            userDetail.fields
              ?.cf_firstname ||
            user.fields
              ?.cf_firstname ||
            ''
          } ${
            userDetail.fields
              ?.cf_lastname ||
            user.fields
              ?.cf_lastname ||
            ''
          }`.trim() ||
          userDetail.email ||
          user.email,

        status:
          userDetail.status ||
          user.status ||
          'active',

        tags:
          Array.isArray(
            userDetail.tags
          )
            ? userDetail.tags
            : tags,

        /*
         * NEW:
         *
         * LearnWorlds user activity
         * metadata used by Training
         * Manager engagement and
         * inactivity reporting.
         *
         * LearnWorlds returns these as
         * Unix timestamps. Convert them
         * to ISO timestamps before
         * sending them to the dashboard.
         */
        lastLogin:
          unixToIso(
            userDetail.last_login
          ),

        createdAt:
          unixToIso(
            userDetail.created
          )
      });
    }

    /*
     * Alphabetize roster.
     */
    employees.sort(
      (a, b) =>
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
          manager.fields
            ?.cf_firstname ||
          '',

        lastName:
          manager.fields
            ?.cf_lastname ||
          ''
      },

      seatOffering: {
        id: managedSeat.id,

        title:
          managedSeat.title ||
          '',

        active:
          managedSeat.active === true,

        gotSeatOn:
          managedSeat.got_seat_on ||
          null
      },

      employeeCount:
        employees.length,

      employees,

      additionalActiveSeatOfferings:
        Math.max(
          0,
          activeManagerSeats.length - 1
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
          error.details ||
          null
      },
      {
        status:
          error.status ||
          500
      }
    );
  }
}
