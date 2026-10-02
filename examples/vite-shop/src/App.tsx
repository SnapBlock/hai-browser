import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { About } from './pages/About';
import { CartPage } from './pages/Cart';
import { Checkout } from './pages/Checkout';
import { Contact } from './pages/Contact';
import { Home } from './pages/Home';
import { OrderConfirmed } from './pages/OrderConfirmed';
import { ProductPage } from './pages/Product';
import { Shop } from './pages/Shop';
import { useLocation } from './router';

export function App() {
  const { path, search } = useLocation();
  let page;
  if (path === '/') page = <Home />;
  else if (path === '/shop') page = <Shop search={search} />;
  else if (path.startsWith('/shop/')) page = <ProductPage slug={path.slice(6)} />;
  else if (path === '/cart') page = <CartPage />;
  else if (path === '/checkout') page = <Checkout />;
  else if (path.startsWith('/order/')) page = <OrderConfirmed id={path.slice(7)} />;
  else if (path === '/about') page = <About />;
  else if (path === '/contact') page = <Contact />;
  else page = <div className="container page"><h1>Page not found</h1></div>;
  return (
    <>
      <Header />
      <main>{page}</main>
      <Footer />
    </>
  );
}
