import { useEffect, useState } from 'react';

export interface Product {
  slug: string;
  name: string;
  origin: string;
  roast: 'light' | 'medium' | 'dark' | 'decaf' | 'gear';
  price: number;
  notes: string[];
  image: string;
  description: string;
}

let cache: Promise<Product[]> | undefined;

export function useProducts(): Product[] | undefined {
  const [products, setProducts] = useState<Product[]>();
  useEffect(() => {
    cache ??= fetch('/api/products.json').then(r => r.json());
    cache.then(setProducts);
  }, []);
  return products;
}

export const money = (n: number) => `$${n.toFixed(2)}`;
