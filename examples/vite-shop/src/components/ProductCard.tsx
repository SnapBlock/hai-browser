import { money, type Product } from '../products';
import { Link } from '../router';

export function ProductCard({ product }: { product: Product }) {
  return (
    <Link to={`/shop/${product.slug}`} className="product-card">
      <div className="thumb">
        <img src={product.image} alt={product.name} />
        <span className={`tag roast-${product.roast}`}>{product.roast === 'gear' ? 'Gear' : `${product.roast} roast`}</span>
      </div>
      <div className="info">
        <h3>{product.name}</h3>
        <p className="origin">{product.origin}</p>
        <p className="notes">{product.notes.join(' · ')}</p>
        <p className="price">{money(product.price)}</p>
      </div>
    </Link>
  );
}
