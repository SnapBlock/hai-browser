import { useMemo, useState } from 'react';
import { ProductCard } from '../components/ProductCard';
import { useProducts } from '../products';
import { navigate } from '../router';

export function Shop({ search }: { search: string }) {
  const products = useProducts();
  const roast = new URLSearchParams(search).get('roast') ?? 'all';
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('featured');

  const shown = useMemo(() => {
    let list = (products ?? []).filter(p => roast === 'all' || p.roast === roast);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter(p => `${p.name} ${p.origin} ${p.notes.join(' ')}`.toLowerCase().includes(q));
    if (sort === 'price-asc') list = [...list].sort((a, b) => a.price - b.price);
    if (sort === 'price-desc') list = [...list].sort((a, b) => b.price - a.price);
    return list;
  }, [products, roast, query, sort]);

  return (
    <div className="container page">
      <h1>Shop coffee</h1>
      <div className="filters">
        <input type="search" placeholder="Search by name, origin or tasting note" value={query} onChange={e => setQuery(e.target.value)} />
        <label>
          Roast
          <select value={roast} onChange={e => navigate(e.target.value === 'all' ? '/shop' : `/shop?roast=${e.target.value}`)}>
            <option value="all">All</option>
            <option value="light">Light</option>
            <option value="medium">Medium</option>
            <option value="dark">Dark</option>
            <option value="decaf">Decaf</option>
            <option value="gear">Brewing gear</option>
          </select>
        </label>
        <label>
          Sort
          <select value={sort} onChange={e => setSort(e.target.value)}>
            <option value="featured">Featured</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
          </select>
        </label>
      </div>
      <p className="count">{products ? `${shown.length} products` : 'Loading…'}</p>
      <div className="grid">{shown.map(p => <ProductCard key={p.slug} product={p} />)}</div>
    </div>
  );
}
