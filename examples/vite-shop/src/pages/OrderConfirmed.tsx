import { Link } from '../router';

export function OrderConfirmed({ id }: { id: string }) {
  return (
    <div className="container page empty">
      <p className="eyebrow">Order #{id}</p>
      <h1>Thank you! Your coffee is on its way.</h1>
      <p>We'll roast your beans on Monday and email tracking details when they ship.</p>
      <Link to="/shop" className="button">
        Keep shopping
      </Link>
    </div>
  );
}
