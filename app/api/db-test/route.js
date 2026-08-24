import { NextResponse } from 'next/server';
import { db } from '../../../lib/db';

export async function GET() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS database_test (
        id SERIAL PRIMARY KEY,
        message TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const inserted = await db.query(
      `
        INSERT INTO database_test (message)
        VALUES ($1)
        RETURNING id, message, created_at
      `,
      ['Training Manager database connection works']
    );

    const count = await db.query(`
      SELECT COUNT(*)::int AS total
      FROM database_test
    `);

    return NextResponse.json({
      success: true,
      message: 'Training Manager successfully connected to Postgres.',
      recordCreated: inserted.rows[0],
      totalTestRecords: count.rows[0].total
    });
  } catch (error) {
    console.error('Database test failed:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Database connection failed',
        message: error.message
      },
      { status: 500 }
    );
  }
}
