import type { Me } from '@homeradar/shared/api/types';
import { Devices } from '../components/Devices';
import { Layout } from '../components/Layout';
import { Sweep } from '../components/Sweep';

export function Home({ me, onSignOut }: { me: Me; onSignOut(): void }) {
  return (
    <Layout me={me} onSignOut={onSignOut}>
      <section className="card">
        <h1>Ciao {me.email}</h1>
        <p>Qui troverai i tuoi lead.</p>
        {me.comuni.length > 0 && (
          <>
            <h2>La tua zona</h2>
            <ul className="chips">
              {me.comuni.map((c) => (
                <li key={c.istat} className="chip">
                  {c.name} ({c.province})
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <Sweep />
      <Devices />
    </Layout>
  );
}
