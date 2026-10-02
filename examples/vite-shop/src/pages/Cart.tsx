import { useCart } from '../cart';
import { money } from '../products';
import { Link } from '../router';

const FREE_SHIPPING = 40;

export function CartPage() {
  const cart = useCart();
  if (!cart.lines.length)
    return (
      <div className="container page empty">
        <h1>Your cart is empty</h1>
        <Link to="/shop" className="button">
          Shop coffee
        </Link>
      </div>
    );
  const left = FREE_SHIPPING - cart.subtotal;
  return (
    <div className="container page">
      <h1>Your cart</h1>
      <div className="cart-layout">
        <ul className="cart-lines">
          {cart.lines.map((line, i) => (
            <li key={`${line.slug}-${line.size}-${line.grind}`}>
              <img src={line.image} alt="" />
              <div className="grow">
                <h3>{line.name}</h3>
                <p className="muted">{[line.size, line.grind].filter(Boolean).join(' · ')}</p>
              </div>
              <div className="stepper">
                <button type="button" aria-label={`Decrease ${line.name}`} onClick={() => cart.setQty(i, line.qty - 1)}>
                  −
                </button>
                <span>{line.qty}</span>
                <button type="button" aria-label={`Increase ${line.name}`} onClick={() => cart.setQty(i, line.qty + 1)}>
                  +
                </button>
              </div>
              <p className="line-total">{money(line.price * line.qty)}</p>
              <button className="link" onClick={() => cart.setQty(i, 0)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <aside className="summary">
          <h2>Order summary</h2>
          <div className="ship-meter">
            <div style={{ width: `${Math.min(100, (cart.subtotal / FREE_SHIPPING) * 100)}%` }} />
          </div>
          <p className="muted">{left > 0 ? `${money(left)} away from free shipping` : 'You get free shipping!'}</p>
          <p className="row">
            <span>Subtotal</span>
            <strong>{money(cart.subtotal)}</strong>
          </p>
          <Link to="/checkout" className="button block">
            Checkout
          </Link>
        </aside>
      </div>
    </div>
  );
}
