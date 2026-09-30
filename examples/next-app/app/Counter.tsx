'use client';

import { useState } from 'react';

export function Counter() {
  const [count, setCount] = useState(0);
  return (
    <section style={{ padding: 16, borderRadius: 12, background: 'white', boxShadow: '0 1px 4px #0002' }}>
      <p>Client component count: {count}</p>
      <button onClick={() => setCount(c => c + 1)}>Increment</button>
    </section>
  );
}
