import type { Me } from '@homeradar/shared/api/types';
import { Layout } from '../components/Layout';

/** Impostazioni dell'agente. */
export function Settings({ me, onSignOut }: { me: Me; onSignOut(): void }) {
  return (
    <Layout me={me} onSignOut={onSignOut}>
      <section className="card">
        <h1>Impostazioni</h1>
      </section>
    </Layout>
  );
}
