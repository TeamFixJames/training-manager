import pg from 'pg';

const {
  Pool
} = pg;

const {
  DATABASE_URL,
  TRAINING_MANAGER_URL,
  TRAINING_SNAPSHOT_CRON_SECRET
} = process.env;

if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not configured'
  );
}

if (!TRAINING_MANAGER_URL) {
  throw new Error(
    'TRAINING_MANAGER_URL is not configured'
  );
}

if (!TRAINING_SNAPSHOT_CRON_SECRET) {
  throw new Error(
    'TRAINING_SNAPSHOT_CRON_SECRET is not configured'
  );
}

const pool =
  new Pool({
    connectionString:
      DATABASE_URL,

    /*
     * Render's managed Postgres connections
     * support SSL. This mirrors the normal
     * hosted application environment.
     */
    ssl:
      DATABASE_URL.includes(
        'localhost'
      )
        ? false
        : {
            rejectUnauthorized:
              false
          }
  });

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ms
      )
  );
}

async function syncEmployee(
  managerEmail,
  employeeId
) {
  const response =
    await fetch(
      `${
        TRAINING_MANAGER_URL.replace(
          /\/$/,
          ''
        )
      }/api/sync-training-progress`,
      {
        method:
          'POST',

        headers: {
          'Content-Type':
            'application/json',

          Authorization:
            `Bearer ${TRAINING_SNAPSHOT_CRON_SECRET}`
        },

        body:
          JSON.stringify({
            managerEmail,
            employeeId
          })
      }
    );

  const payload =
    await response.json();

  if (
    !response.ok ||
    payload?.success === false
  ) {
    throw new Error(
      payload?.message ||
      payload?.error ||
      `Sync failed (${response.status})`
    );
  }

  return payload;
}

async function main() {
  console.log(
    'Starting daily Training Manager snapshot collection...'
  );

  /*
   * training_manager_state already gives us
   * the employees that have Training Manager
   * state and the manager who owns each one.
   */
  const result =
    await pool.query(`
      SELECT
        manager_email,
        employee_lw_id

      FROM
        training_manager_state

      ORDER BY
        manager_email,
        employee_lw_id
    `);

  const employees =
    result.rows;

  console.log(
    `Found ${employees.length} employees to snapshot.`
  );

  let succeeded = 0;
  let failed = 0;

  for (
    let index = 0;
    index < employees.length;
    index += 1
  ) {
    const employee =
      employees[index];

    const managerEmail =
      String(
        employee.manager_email
      );

    const employeeId =
      String(
        employee.employee_lw_id
      );

    try {
      const result =
        await syncEmployee(
          managerEmail,
          employeeId
        );

      succeeded += 1;

      console.log(
        `[${index + 1}/${employees.length}]`,
        employeeId,
        'snapshot:',
        result.snapshotSaved === true
          ? 'saved'
          : 'not saved'
      );
    } catch (error) {
      failed += 1;

      console.error(
        `[${index + 1}/${employees.length}]`,
        employeeId,
        error.message
      );
    }

    /*
     * Small delay between employees so the job
     * does not hammer the LearnWorlds API.
     *
     * We can tune this later if necessary.
     */
    await sleep(350);
  }

  console.log(
    'Daily snapshot collection finished.'
  );

  console.log({
    total:
      employees.length,

    succeeded,
    failed
  });

  await pool.end();

  /*
   * A partial failure should show as a failed
   * Cron Job run so Render makes it obvious.
   */
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch(
    async (error) => {
      console.error(
        'Daily snapshot collection failed:',
        error
      );

      try {
        await pool.end();
      } catch {}

      process.exit(1);
    }
  );
