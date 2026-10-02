import { Link } from '../router';

const timeline = [
  { year: '2014', text: 'Maya and Theo start roasting in a garage on a 1 kg Diedrich, selling at the Saturday farmers market.' },
  { year: '2016', text: 'Our first direct-trade relationship, with the Gikanda cooperative in Nyeri, Kenya.' },
  { year: '2018', text: 'The SE Division café opens, with a roastery you can watch through the window.' },
  { year: '2021', text: 'We switch to fully compostable bags and carbon-neutral shipping.' },
  { year: '2024', text: 'Ten years, fourteen partner farms, and more than a million cups brewed.' },
];

export function About() {
  return (
    <>
      <section className="about-hero">
        <div className="container">
          <h1>Our story</h1>
          <p className="lede">Two friends, one tiny roaster, and an obsession with how good coffee can be.</p>
        </div>
      </section>
      <section className="container section split">
        <img src="/images/team.jpg" alt="Sharing coffee at the roastery" />
        <div>
          <h2>Coffee is a relationship</h2>
          <p>
            Every coffee we sell starts with a person: a grower who has spent years improving their farm. We buy directly whenever we can, pay
            well above market prices, and go back every harvest.
          </p>
          <p>That relationship is why we can tell you the name of the farm on every bag, and why the coffee tastes the way it does.</p>
        </div>
      </section>
      <section className="container section split reverse">
        <img src="/images/cupping.jpg" alt="A coffee cupping session" />
        <div>
          <h2>We taste everything, every week</h2>
          <p>
            Each Monday's roast is cupped by the whole team before it ships. If a batch isn't right, it doesn't leave the building. It becomes
            staff coffee instead.
          </p>
        </div>
      </section>
      <section className="container section">
        <h2>Ten years in the making</h2>
        <ol className="timeline">
          {timeline.map(t => (
            <li key={t.year}>
              <strong>{t.year}</strong>
              <p>{t.text}</p>
            </li>
          ))}
        </ol>
      </section>
      <section className="container section cta">
        <h2>Taste the difference</h2>
        <Link to="/shop" className="button">
          Shop this week's roasts
        </Link>
      </section>
    </>
  );
}
