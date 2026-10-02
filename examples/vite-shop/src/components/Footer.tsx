import { useState, type FormEvent } from 'react';
import { Link } from '../router';

export function Footer() {
  const [joined, setJoined] = useState(false);
  const subscribe = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = new FormData(e.currentTarget).get('email');
    await fetch('/api/newsletter', { method: 'POST', body: JSON.stringify({ email }) });
    setJoined(true);
  };
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <div className="logo">
            Kettle <span>&amp;</span> Ember
          </div>
          <p>Small-batch coffee, roasted in Portland since 2014.</p>
        </div>
        <div>
          <h4>Shop</h4>
          <Link to="/shop">All coffee</Link>
          <Link to="/shop?roast=gear">Brewing gear</Link>
          <Link to="/cart">Your cart</Link>
        </div>
        <div>
          <h4>Company</h4>
          <Link to="/about">Our story</Link>
          <Link to="/contact">Contact</Link>
        </div>
        <form className="newsletter" onSubmit={subscribe}>
          <h4>Brew notes, monthly</h4>
          {joined ? (
            <p>Thanks for subscribing!</p>
          ) : (
            <div className="row">
              <input name="email" type="email" placeholder="you@example.com" required aria-label="Email address" />
              <button type="submit">Subscribe</button>
            </div>
          )}
        </form>
      </div>
      <div className="container copyright">© 2026 Kettle &amp; Ember Coffee Roasters</div>
    </footer>
  );
}
