import { auth0 } from '../lib/auth0';

export default async function Home() {
  const session = await auth0.getSession();

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f3f6fa', padding: '24px' }}>
      <section style={{ width: 'min(560px, 100%)', background: '#fff', border: '1px solid #dce5ef', borderRadius: '16px', padding: '32px', boxShadow: '0 12px 35px rgba(26,45,70,.08)' }}>
        <p style={{ margin: '0 0 6px', color: '#66778d', fontSize: '13px' }}>Sales Fix</p>
        <h1 style={{ margin: '0 0 10px', color: '#173a5e' }}>Training Manager</h1>

        {!session ? (
          <>
            <p style={{ color: '#52667d', lineHeight: 1.6 }}>Sign in with your manager account to access the Training Manager.</p>
            <a href="/auth/login?returnTo=/training-manager" style={{ display: 'inline-block', marginTop: '12px', padding: '11px 16px', borderRadius: '9px', background: '#173a5e', color: '#fff', textDecoration: 'none', fontWeight: 700 }}>Log in</a>
          </>
        ) : (
          <>
            <p style={{ color: '#52667d', lineHeight: 1.6 }}>Signed in as <strong>{session.user.name || session.user.email}</strong>.</p>
            <a href="/training-manager" style={{ display: 'inline-block', marginTop: '12px', padding: '11px 16px', borderRadius: '9px', background: '#173a5e', color: '#fff', textDecoration: 'none', fontWeight: 700 }}>Open Training Manager</a>
          </>
        )}
      </section>
    </main>
  );
}
