import { NextResponse } from 'next/server';
import { auth0 } from '../../../lib/auth0';
import fs from 'fs/promises';
import path from 'path';

function parseLearnWorldsIds(url = '') {
  try {
    const parsed = new URL(url);

    const courseId = parsed.searchParams.get('courseid') || '';
    let unitId = parsed.searchParams.get('unit') || '';

    // Sales Fix path-player URLs append "Unit" after the actual LW unit ID.
    if (unitId.endsWith('Unit')) {
      unitId = unitId.slice(0, -4);
    }

    return {
      courseId,
      unitId
    };
  } catch {
    return {
      courseId: '',
      unitId: ''
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

  try {
    const catalogPath = path.join(
      process.cwd(),
      'public',
      'catalog.json'
    );

    const raw = await fs.readFile(catalogPath, 'utf8');
    const catalog = JSON.parse(raw);

    const mapping = [];

    for (const [section, items] of Object.entries(catalog)) {
      if (!Array.isArray(items)) {
        continue;
      }

      for (const item of items) {
        const ids = parseLearnWorldsIds(item.url || '');

        mapping.push({
          videoTitle: item.title || '',
          section,
          lwCourseId: ids.courseId,
          lwUnitId: ids.unitId,
          sourceUrl: item.url || '',
          mappingStatus:
            ids.courseId && ids.unitId
              ? 'ready'
              : 'needs_review'
        });
      }
    }

    const ready = mapping.filter(
      (item) => item.mappingStatus === 'ready'
    );

    const needsReview = mapping.filter(
      (item) => item.mappingStatus === 'needs_review'
    );

    return NextResponse.json({
      success: true,

      summary: {
        totalItems: mapping.length,
        readyToMap: ready.length,
        needsReview: needsReview.length
      },

      mapping,
      needsReview
    });
  } catch (error) {
    console.error('Catalog mapping failed:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Unable to build catalog mapping',
        message: error.message
      },
      { status: 500 }
    );
  }
}
