export function PlanCard({ name, price, onChoose }: { name: string; price: string; onChoose: () => void }) {
  return (
    <section style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, width: 200 }}>
      <h2 style={{ margin: 0 }}>{name}</h2>
      <p style={{ fontSize: 28, margin: '8px 0' }}>{price}</p>
      <button onClick={onChoose} style={{ padding: '8px 14px', borderRadius: 6, border: 0, background: '#7c3aed', color: '#fff' }}>
        Choose {name}
      </button>
    </section>
  );
}
