import { useCart } from '../cart';
import { Link } from '../router';

const shopMenu = [
  { to: '/shop?roast=light', label: 'Light roasts' },
  { to: '/shop?roast=medium', label: 'Medium roasts' },
  { to: '/shop?roast=dark', label: 'Dark roasts' },
  { to: '/shop?roast=decaf', label: 'Decaf' },
  { to: '/shop?roast=gear', label: 'Brewing gear' },
];

export function Header() {
  const { count } = useCart();
  return (
    <header className="site-header">
      <div className="announce">Free shipping on orders over $40 · Roasted fresh every Monday</div>
      <div className="container nav">
        <Link to="/" className="logo">
          Kettle <span>&amp;</span> Ember
        </Link>
        <nav className="links">
          <div className="dropdown">
            <Link to="/shop">Shop ▾</Link>
            <div className="menu">
              {shopMenu.map(item => (
                <Link key={item.to} to={item.to}>
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
          <Link to="/about">Our story</Link>
          <Link to="/contact">Contact</Link>
        </nav>
        <Link to="/cart" className="cart-link">
          Cart <span className="badge">{count}</span>
        </Link>
      </div>
    </header>
  );
}
