import { ProductCard } from '../components/ProductCard';
import { useProducts } from '../products';
import { Link } from '../router';

export function Home() {
  const products = useProducts();
  return (
    <>
      <section className="hero">
        <div className="container hero-inner">
          <p className="eyebrow">New harvest · Ethiopia Guji</p>
          <h1>Coffee worth slowing down for.</h1>
          <p className="lede">Single-origin beans from farms we know by name, roasted in small batches and shipped within 48 hours.</p>
          <div className="actions">
            <Link to="/shop" className="button">
              Shop coffee
            </Link>
            <Link to="/about" className="button ghost">
              Our story
            </Link>
          </div>
        </div>
      </section>
      <section className="container section">
        <div className="section-head">
          <h2>Customer favourites</h2>
          <Link to="/shop">View all →</Link>
        </div>
        <div className="grid">{products?.slice(0, 3).map(p => <ProductCard key={p.slug} product={p} />)}</div>
      </section>
      <section className="container section perks">
        <div>
          <h3>Roasted to order</h3>
          <p>Every bag is roasted the week it ships, so it arrives at its peak.</p>
        </div>
        <div>
          <h3>Direct trade</h3>
          <p>We pay growers well above Fairtrade minimums and visit every year.</p>
        </div>
        <div>
          <h3>Brew guides included</h3>
          <p>Each order comes with a recipe card tuned to that coffee.</p>
        </div>
      </section>
      <section className="container section banner">
        <img src="/images/cafe.jpg" alt="Our roastery café" />
        <div>
          <h2>Visit the roastery</h2>
          <p>Come taste this week's roasts at our café on SE Division Street, open daily 7am–4pm.</p>
          <Link to="/contact" className="button">
            Plan a visit
          </Link>
        </div>
      </section>
    </>
  );
}
