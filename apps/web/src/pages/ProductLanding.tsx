import { Link } from "react-router-dom";
import type { EventProduct } from "../products";
import { PublicFooter, PublicHeader } from "./PublicPages";

export function ProductLanding({ product }: { product: EventProduct }) {
  return (
    <main className="public-page-shell">
      <PublicHeader />
      <header className="content-page-heading product-landing-heading">
        <span className="eyebrow">EVENTFLOW · {product.name.toUpperCase()}</span>
        <h1>{product.dashboardTitle}, with room to enjoy it.</h1>
        <p>{product.description}</p>
        <div className="heading-actions">
          <Link className="button button-dark" to={`/signup?next=${encodeURIComponent(product.path)}`}>Create your workspace</Link>
          <Link className="button button-outline" to={`/login?next=${encodeURIComponent(product.path)}`}>Sign in</Link>
        </div>
      </header>
      <section className="product-feature-grid" aria-label={`${product.name} features`}>
        {product.features.map((feature, index) => (
          <article className="content-card" key={feature}>
            <span className="eyebrow">0{index + 1}</span>
            <h2>{feature}</h2>
            <p className="muted small-copy">{product.description}</p>
          </article>
        ))}
      </section>
      <div className="product-switcher">
        <span className="eyebrow">EXPLORE EVENTFLOW</span>
        <div className="product-switcher-links">
          <Link to="/weddings">Wedding Planner</Link>
          <Link to="/voting">Voting & Contests</Link>
          <Link to="/general-events">General Events</Link>
        </div>
      </div>
      <PublicFooter />
    </main>
  );
}
