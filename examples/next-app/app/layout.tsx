import type { ReactNode } from 'react';

export const metadata = { title: 'H/Ai Next.js example' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, background: '#f7f7fb' }}>{children}</body>
    </html>
  );
}
