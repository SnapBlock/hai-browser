import { Counter } from './Counter';

export default function Page() {
  return (
    <main style={{ maxWidth: 640, margin: '48px auto', padding: 24 }}>
      <h1 style={{ color: '#4c1d95' }}>Next.js + H/Ai</h1>
      <p>This heading and paragraph are rendered by a server component.</p>
      <Counter />
    </main>
  );
}
