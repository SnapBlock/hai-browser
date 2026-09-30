export function Header({ title }: { title: string }) {
  return (
    <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 24px', background: '#111827', color: '#fff' }}>
      <strong style={{ fontSize: 20 }}>{title}</strong>
      <nav style={{ display: 'flex', gap: 16 }}>
        <a href="#pricing" style={{ color: '#c4b5fd' }}>Pricing</a>
        <a href="#docs" style={{ color: '#c4b5fd' }}>Docs</a>
      </nav>
    </header>
  );
}
