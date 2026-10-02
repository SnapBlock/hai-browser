import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export interface CartLine {
  slug: string;
  name: string;
  image: string;
  size: string;
  grind: string;
  price: number;
  qty: number;
}

interface Cart {
  lines: CartLine[];
  count: number;
  subtotal: number;
  add(line: CartLine): void;
  setQty(index: number, qty: number): void;
  clear(): void;
}

const CartContext = createContext<Cart | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(() => JSON.parse(localStorage.getItem('cart') ?? '[]'));
  useEffect(() => localStorage.setItem('cart', JSON.stringify(lines)), [lines]);

  const cart: Cart = {
    lines,
    count: lines.reduce((n, l) => n + l.qty, 0),
    subtotal: lines.reduce((n, l) => n + l.qty * l.price, 0),
    add: line =>
      setLines(prev => {
        const i = prev.findIndex(l => l.slug === line.slug && l.size === line.size && l.grind === line.grind);
        if (i < 0) return [...prev, line];
        return prev.map((l, j) => (j === i ? { ...l, qty: l.qty + line.qty } : l));
      }),
    setQty: (index, qty) =>
      setLines(prev => (qty <= 0 ? prev.filter((_, j) => j !== index) : prev.map((l, j) => (j === index ? { ...l, qty } : l)))),
    clear: () => setLines([]),
  };
  return <CartContext.Provider value={cart}>{children}</CartContext.Provider>;
}

export function useCart() {
  const cart = useContext(CartContext);
  if (!cart) throw new Error('useCart outside CartProvider');
  return cart;
}
