import { useState } from 'react';
import { useCart } from '../cart';
import { money, useProducts } from '../products';
import { Link } from '../router';

const sizes = [
  { label: '250 g', factor: 1 },
  { label: '500 g', factor: 1.8 },
  { label: '1 kg', factor: 3.2 },
];
const grinds = ['Whole bean', 'Espresso', 'Pour-over', 'French press'];

export function ProductPage({ slug }: { slug: string }) {
  const product = useProducts()?.find(p => p.slug === slug);
  const cart = useCart();
  const [size, setSize] = useState('250 g');
  const [grind, setGrind] = useState('Whole bean');
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  if (!product) return <div className="container page">Loading…</div>;
  const isGear = product.roast === 'gear';
  const price = isGear ? product.price : product.price * sizes.find(s => s.label === size)!.factor;

  const add = () => {
    cart.add({ slug, name: product.name, image: product.image, size: isGear ? '' : size, grind: isGear ? '' : grind, price, qty });
    setAdded(true);
  };

  return (
    <div className="container page product-page">
      <p className="crumbs">
        <Link to="/shop">Shop</Link> / {product.name}
      </p>
      <div className="product-layout">
        <img className="product-image" src={product.image} alt={product.name} />
        <div>
          <p className="eyebrow">{product.origin}</p>
          <h1>{product.name}</h1>
          <p className="price big">{money(price)}</p>
          <p className="notes">{product.notes.join(' · ')}</p>
          <p>{product.description}</p>
          {!isGear && (
            <>
              <label className="field">
                Bag size
                <select value={size} onChange={e => setSize(e.target.value)}>
                  {sizes.map(s => (
                    <option key={s.label}>{s.label}</option>
                  ))}
                </select>
              </label>
              <fieldset className="field">
                <legend>Grind</legend>
                <div className="chips">
                  {grinds.map(g => (
                    <label key={g} className={g === grind ? 'chip on' : 'chip'}>
                      <input type="radio" name="grind" value={g} checked={g === grind} onChange={() => setGrind(g)} />
                      {g}
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          )}
          <div className="buy-row">
            <div className="stepper">
              <button type="button" aria-label="Decrease quantity" onClick={() => setQty(q => Math.max(1, q - 1))}>
                −
              </button>
              <span aria-label="Quantity">{qty}</span>
              <button type="button" aria-label="Increase quantity" onClick={() => setQty(q => q + 1)}>
                +
              </button>
            </div>
            <button className="button" onClick={add}>
              Add to cart
            </button>
          </div>
          {added && (
            <p className="added">
              Added to your cart. <Link to="/cart">View cart →</Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
