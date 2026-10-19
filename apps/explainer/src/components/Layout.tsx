import { Link, Outlet } from "@tanstack/react-router";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/benchmark", label: "Benchmark" },
  { to: "/questions", label: "Questions" },
  { to: "/taxonomy", label: "Taxonomy" },
  { to: "/samples", label: "Samples" },
  { to: "/experiments", label: "Experiments" },
  { to: "/models", label: "Models" },
  { to: "/costs", label: "Costs" },
  { to: "/roadmap", label: "Roadmap" },
  { to: "/faq", label: "FAQ" },
] as const;

export function Layout() {
  return (
    <div className="page">
      <header className="site-nav">
        <Link to="/" className="brand">Seen but <em>Not Grasped</em></Link>
        <nav>
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} activeProps={{ className: "navlink active" }} className="navlink">
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="wrap"><Outlet /></main>
      <footer className="site-footer">
        <div className="wrap">
          <span>Seen but Not Grasped · a living reference, updated as decisions land.</span>
          <span className="mono">v0.1 · <a href="https://github.com/mmaaaaz/agi-eval-data">repository</a></span>
        </div>
      </footer>
    </div>
  );
}
