import pg from 'pg';

const { Pool } = pg;

const {
  DATABASE_URL,
  TRAINING_MANAGER_URL,
  TRAINING_SNAPSHOT_CRON_SECRET
} = process.env;

if (!DATABASE_URL) throw new Error('DATABASE_URL is not configured');
if (!TRAINING_MANAGER_URL) throw new Error('TRAINING_MANAGER_URL is not configured');
if (!TRAINING_SNAPSHOT_CRON_SECRET) {
  throw new Error('TRAINING_SNAPSHOT_CRON_SECRET is not configured');
}

const baseUrl = TRAINING_MANAGER_URL.replace(/\/$/, '');
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postSync(path, managerEmail, employeeId) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TRAINING_SNAPSHOT_CRON_SECRET}`
    },
    body: JSON.stringify({ managerEmail, employeeId }),
    signal: AbortSignal.timeout(120000)
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${path} returned an invalid JSON response (${response.status})`);
  }

  if (!response.ok || payload?.success === false) {
    throw new Error(
      payload?.message || payload?.error ||
      `${path} sync failed (${response.status})`
    );
  }
  return payload;
}

async function syncEmployee(managerEmail, employeeId) {
  return postSync('/api/sync-training-progress', managerEmail, employeeId);
}

async function syncFixMyCall(managerEmail, employeeId) {
  return postSync('/api/fix-my-call', managerEmail, employeeId);
}

async function main() {
  console.log('Starting daily Training Manager snapshot and Fix My Call sync...');

  // Preserve the existing manager/employee selection and ordering.
  const result = await pool.query(`
    SELECT manager_email, employee_lw_id
    FROM training_manager_state
    ORDER BY manager_email, employee_lw_id
  `);
  const employees = result.rows;
  console.log(`Found ${employees.length} employees to process.`);

  let snapshotSucceeded = 0;
  let snapshotFailed = 0;
  let fixMyCallSucceeded = 0;
  let fixMyCallFailed = 0;
  let fixMyCallProcessed = 0;

  for (let index = 0; index < employees.length; index += 1) {
    const employee = employees[index];
    const managerEmail = String(employee.manager_email);
    const employeeId = String(employee.employee_lw_id);
    const prefix = `[${index + 1}/${employees.length}] ${employeeId}`;

    // Keep the existing daily snapshot process running independently.
    try {
      const snapshot = await syncEmployee(managerEmail, employeeId);
      snapshotSucceeded += 1;
      console.log(
        prefix,
        'snapshot:',
        snapshot.snapshotSaved === true ? 'saved' : 'not saved'
      );
    } catch (error) {
      snapshotFailed += 1;
      console.error(prefix, 'snapshot failed:', error.message);
    }

    // Archive Fix My Call submissions even if snapshot sync failed.
    try {
      const fixMyCall = await syncFixMyCall(managerEmail, employeeId);
      fixMyCallSucceeded += 1;
      fixMyCallProcessed += Number(fixMyCall.processed || 0);
      console.log(
        prefix,
        'Fix My Call:',
        `processed ${fixMyCall.processed ?? 0},`,
        `archived ${fixMyCall.archivedCount ?? 0}`
      );
    } catch (error) {
      fixMyCallFailed += 1;
      console.error(prefix, 'Fix My Call failed:', error.message);
    }

    // Preserve the existing delay between employees.
    await sleep(350);
  }

  console.log('Daily snapshot and Fix My Call sync finished.');
  console.log({
    total: employees.length,
    snapshotSucceeded,
    snapshotFailed,
    fixMyCallSucceeded,
    fixMyCallFailed,
    fixMyCallProcessed
  });

  await pool.end();

  // Report partial failures to Render without hiding successful operations.
  if (snapshotFailed > 0 || fixMyCallFailed > 0) {
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  console.error('Daily snapshot and Fix My Call sync failed:', error);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
