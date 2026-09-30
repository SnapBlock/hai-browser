import { useState } from 'react';
import { Header } from './Header';
import { PlanCard } from './PlanCard';

export function App() {
  const [plan, setPlan] = useState<string>();
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <Header title="H/Ai React demo" />
      <main style={{ padding: 24 }}>
        <p>Run “H/Ai: Pick Element”, then click anything below to jump to its source.</p>
        <div style={{ display: 'flex', gap: 16 }}>
          <PlanCard name="Hobby" price="$0" onChoose={() => setPlan('Hobby')} />
          <PlanCard name="Pro" price="$12" onChoose={() => setPlan('Pro')} />
        </div>
        <p id="chosen">{plan ? `You chose ${plan}` : 'No plan chosen yet'}</p>
      </main>
    </div>
  );
}
