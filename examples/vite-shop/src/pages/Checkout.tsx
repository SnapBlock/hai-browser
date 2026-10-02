import { useState, type FormEvent } from 'react';
import { useCart } from '../cart';
import { money } from '../products';
import { navigate } from '../router';

const shippingOptions = [
  { id: 'standard', label: 'Standard (3–5 days)', price: 6 },
  { id: 'express', label: 'Express (1–2 days)', price: 14 },
];

export function Checkout() {
  const cart = useCart();
  const [shipping, setShipping] = useState('standard');
  const [gift, setGift] = useState(false);
  const [promo, setPromo] = useState('');
  const [promoApplied, setPromoApplied] = useState(false);
  const [error, setError] = useState('');

  const discount = promoApplied ? cart.subtotal * 0.1 : 0;
  const shipCost = cart.subtotal - discount >= 40 && shipping === 'standard' ? 0 : shippingOptions.find(o => o.id === shipping)!.price;
  const total = cart.subtotal - discount + shipCost;

  const applyPromo = () => {
    if (promo.trim().toUpperCase() === 'WELCOME10') {
      setPromoApplied(true);
      setError('');
    } else setError('That promo code is not valid.');
  };

  const placeOrder = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget));
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, lines: cart.lines, total }),
    });
    const order = await res.json();
    console.info(`Order #${order.id} placed for ${money(total)}`);
    cart.clear();
    navigate(`/order/${order.id}`);
  };

  if (!cart.lines.length) return <div className="container page">Your cart is empty.</div>;

  return (
    <div className="container page">
      <h1>Checkout</h1>
      <form className="checkout" onSubmit={placeOrder}>
        <div className="checkout-fields">
          <h2>Contact</h2>
          <label className="field">
            Email
            <input name="email" type="email" required autoComplete="email" />
          </label>
          <h2>Shipping address</h2>
          <div className="two">
            <label className="field">
              First name
              <input name="firstName" required />
            </label>
            <label className="field">
              Last name
              <input name="lastName" required />
            </label>
          </div>
          <label className="field">
            Address
            <input name="address" required />
          </label>
          <div className="two">
            <label className="field">
              City
              <input name="city" required />
            </label>
            <label className="field">
              Country
              <select name="country" defaultValue="United States">
                <option>United States</option>
                <option>Canada</option>
                <option>United Kingdom</option>
                <option>Nigeria</option>
                <option>Germany</option>
              </select>
            </label>
          </div>
          <h2>Delivery</h2>
          {shippingOptions.map(o => (
            <label key={o.id} className={shipping === o.id ? 'option on' : 'option'}>
              <input type="radio" name="shipping" value={o.id} checked={shipping === o.id} onChange={() => setShipping(o.id)} />
              <span className="grow">{o.label}</span>
              <span>{money(o.price)}</span>
            </label>
          ))}
          <label className="check">
            <input type="checkbox" name="gift" checked={gift} onChange={e => setGift(e.target.checked)} />
            This order is a gift
          </label>
          {gift && (
            <label className="field">
              Gift message
              <textarea name="giftMessage" rows={3} />
            </label>
          )}
        </div>
        <aside className="summary">
          <h2>Order summary</h2>
          {cart.lines.map(l => (
            <p className="row" key={`${l.slug}-${l.size}-${l.grind}`}>
              <span>
                {l.qty} × {l.name}
              </span>
              <span>{money(l.qty * l.price)}</span>
            </p>
          ))}
          <div className="promo">
            <input placeholder="Promo code" value={promo} onChange={e => setPromo(e.target.value)} aria-label="Promo code" />
            <button type="button" onClick={applyPromo}>
              Apply
            </button>
          </div>
          {error && <p className="error">{error}</p>}
          {promoApplied && <p className="row good"><span>WELCOME10</span><span>−{money(discount)}</span></p>}
          <p className="row">
            <span>Shipping</span>
            <span>{shipCost ? money(shipCost) : 'Free'}</span>
          </p>
          <p className="row total">
            <span>Total</span>
            <strong>{money(total)}</strong>
          </p>
          <button type="submit" className="button block">
            Place order
          </button>
        </aside>
      </form>
    </div>
  );
}
