import { NextResponse } from 'next/server';
import { auth0 } from '../../../lib/auth0';
import { db } from '../../../lib/db';

export async function GET() {
  try {
    const session = await auth0.getSession();

    if (!session?.user?.email) {
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

    /*
     * Temporary database setup route.
     *
     * This creates the historical snapshot table
     * used by Training Manager reporting.
     *
     * Safe to call more than once because all
     * CREATE statements use IF NOT EXISTS.
     */

    await db.query(`
      CREATE TABLE IF NOT EXISTS training_manager_snapshots (
        id BIGSERIAL PRIMARY KEY,

        manager_email TEXT NOT NULL,
        employee_lw_id TEXT NOT NULL,

        snapshot_date DATE NOT NULL,

        /*
         * Cumulative LearnWorlds video-only
         * study time at the time of this snapshot.
         */
        video_study_seconds BIGINT NOT NULL DEFAULT 0,

        /*
         * Certification progress.
         */
        certification_video_complete INTEGER NOT NULL DEFAULT 0,
        certification_video_total INTEGER NOT NULL DEFAULT 0,

        section_exams_passed INTEGER NOT NULL DEFAULT 0,
        section_exams_total INTEGER NOT NULL DEFAULT 0,

        certification_percent NUMERIC(5,2) NOT NULL DEFAULT 0,

        level1_passed BOOLEAN NOT NULL DEFAULT FALSE,
        level2_passed BOOLEAN NOT NULL DEFAULT FALSE,

        captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT training_manager_snapshots_employee_day_unique
          UNIQUE (
            manager_email,
            employee_lw_id,
            snapshot_date
          )
      )
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS
        training_manager_snapshots_employee_date_idx
      ON training_manager_snapshots (
        employee_lw_id,
        snapshot_date
      )
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS
        training_manager_snapshots_manager_date_idx
      ON training_manager_snapshots (
        manager_email,
        snapshot_date
      )
    `);

    /*
     * Verify the table structure after creation.
     */
    const verification = await db.query(`
      SELECT
        column_name,
        data_type
      FROM information_schema.columns
      WHERE table_name = 'training_manager_snapshots'
      ORDER BY ordinal_position
    `);

    return NextResponse.json({
      success: true,

      message:
        'Training Manager snapshot table is ready.',

      columns:
        verification.rows
    });
  } catch (error) {
    console.error(
      'Snapshot table setup failed:',
      error
    );

    return NextResponse.json(
      {
        success: false,

        error:
          'Unable to create snapshot table',

        message:
          error.message
      },
      {
        status: 500
      }
    );
  }
}
