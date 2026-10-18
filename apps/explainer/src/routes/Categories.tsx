import { Link } from "@tanstack/react-router";
import { CATEGORIES } from "../content/categories";
import { SAMPLES } from "../content/samples";

export function CategoriesPage() {
  return (
    <section>
      <span className="eyebrow">04 · What the photographs show</span>
      <h2>Image categories</h2>
      <div className="prose">
        <p className="lead-in">
          Categories describe what a photograph shows, not what a question tests. Each category groups
          images that stress the same kinds of scene difficulty, and a category is assigned as part of
          selection. The list below is the working draft, marked planned until it is signed off.
        </p>
      </div>
      <div className="cat-grid">
        {CATEGORIES.map((c) => {
          const hasSample = SAMPLES.some((s) => s.category === c.id);
          return (
            <div className="cat" key={c.id} id={c.id}>
              <div className="name">{c.label}</div>
              <div className="note">{c.note}</div>
              <div>
                <span className="planned">planned</span>
                {hasSample ? (
                  <>
                    {" "}
                    · <Link to="/samples">see a sample</Link>
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <p className="table-note">
        Families and categories are different axes. A sports photograph can carry a counting question and
        a spatial one. The Samples page shows the pairing in practice on real photographs.
      </p>
    </section>
  );
}
