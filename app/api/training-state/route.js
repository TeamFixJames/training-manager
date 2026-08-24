import { NextResponse } from 'next/server';
import { auth0 } from '../../../lib/auth0';
import { db } from '../../../lib/db';

async function ensureTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS training_manager_state (
      id BIGSERIAL PRIMARY KEY,
      manager_email TEXT NOT NULL,
      employee_lw_id TEXT NOT NULL,
      state JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (manager_email, employee_lw_id)
    )
  `);
}

async function getAuthenticatedManager() {
  const session = await auth0.getSession();

  if (!session?.user?.email) {
    return null;
  }

  return session.user.email.toLowerCase();
}

/*
 * GET /api/training-state
 *
 * Returns all Training Manager records belonging to the
 * currently authenticated manager.
 */
export async function GET() {
  try {
    const managerEmail = await getAuthenticatedManager();

    if (!managerEmail) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    await ensureTable();

    const result = await db.query(
      `
        SELECT
          employee_lw_id,
          state,
          created_at,
          updated_at
        FROM training_manager_state
        WHERE manager_email = $1
        ORDER BY updated_at DESC
      `,
      [managerEmail]
    );

    return NextResponse.json({
      success: true,
      managerEmail,
      recordCount: result.rows.length,
      records: result.rows.map((row) => ({
        employeeId: row.employee_lw_id,
        state: row.state,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    });
  } catch (error) {
    console.error('Training state GET failed:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Unable to load Training Manager state',
        message: error.message
      },
      { status: 500 }
    );
  }
}

/*
 * POST /api/training-state
 *
 * Saves the Training Manager state for one LearnWorlds employee.
 *
 * Expected body:
 *
 * {
 *   "employeeId": "learnworlds-user-id",
 *   "state": { ... }
 * }
 */
export async function POST(request) {
  try {
    const managerEmail = await getAuthenticatedManager();

    if (!managerEmail) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const body = await request.json();

    const employeeId = String(body?.employeeId || '').trim();
    const state = body?.state;

    if (!employeeId) {
      return NextResponse.json(
        { error: 'employeeId is required' },
        { status: 400 }
      );
    }

    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      return NextResponse.json(
        { error: 'state must be an object' },
        { status: 400 }
      );
    }

    await ensureTable();

    const result = await db.query(
      `
        INSERT INTO training_manager_state (
          manager_email,
          employee_lw_id,
          state
        )
        VALUES ($1, $2, $3::jsonb)

        ON CONFLICT (manager_email, employee_lw_id)

        DO UPDATE SET
          state = EXCLUDED.state,
          updated_at = NOW()

        RETURNING
          employee_lw_id,
          state,
          created_at,
          updated_at
      `,
      [
        managerEmail,
        employeeId,
        JSON.stringify(state)
      ]
    );

    const saved = result.rows[0];

    return NextResponse.json({
      success: true,
      employeeId: saved.employee_lw_id,
      state: saved.state,
      createdAt: saved.created_at,
      updatedAt: saved.updated_at
    });
  } catch (error) {
    console.error('Training state POST failed:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Unable to save Training Manager state',
        message: error.message
      },
      { status: 500 }
    );
  }
}
