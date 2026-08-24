import { redirect } from 'next/navigation';
import { auth0 } from '../../lib/auth0';

export default async function TrainingManagerPage() {
  const session = await auth0.getSession();

  if (!session) {
    redirect('/auth/login?returnTo=/training-manager');
  }

  const managerName = session.user.name || session.user.nickname || 'Manager';
  const managerEmail = session.user.email || '';

  return (
    <main style={{ minHeight: '100vh', background: '#eef3f8' }}>
      <header style={{ minHeight: '58px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '8px 18px', background: '#173a5e', color: '#fff', boxSizing: 'border-box' }}>
        <div>
          <strong style={{ display: 'block' }}>Training Manager</strong>
          <span style={{ fontSize: '12px', opacity: 0.8 }}>
            Signed in as {managerName}{managerEmail ? ` · ${managerEmail}` : ''}
          </span>
        </div>

        <a href="/auth/logout" style={{ color: '#173a5e', background: '#fff', padding: '8px 12px', borderRadius: '8px', textDecoration: 'none', fontSize: '12px', fontWeight: 700 }}>
          Log out
        </a>
      </header>

      <iframe
        title="Training Manager Dashboard"
        src="/dashboard.html"
        style={{ display: 'block', width: '100%', height: 'calc(100vh - 58px)', border: 0, background: '#fff' }}
      />
    </main>
  );
}
