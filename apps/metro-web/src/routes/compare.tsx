import { createFileRoute } from "@tanstack/react-router";
import { useData } from "../lib/dataContext";
import { countriesOf } from "../lib/data";
import { ThumbImage } from "../components/ThumbImage";
import { Eyebrow } from "../components/Section";

export const Route = createFileRoute("/compare")({ component: Compare });

function Compare() {
  const { data } = useData();
  if (!data) return null;

  const ours = countriesOf(data).filter((s) => s.branch === "ours");
  const reason = countriesOf(data).filter((s) => s.branch !== "ours");
  const oursByName = new Map(ours.map((s) => [s.name.toLowerCase(), s]));
  const reasonByName = new Map(reason.map((s) => [s.name.toLowerCase(), s]));

  const both = [...oursByName.keys()].filter((n) => reasonByName.has(n)).sort();
  const onlyOurs = [...oursByName.keys()].filter((n) => !reasonByName.has(n)).sort();
  const onlyReason = [...reasonByName.keys()].filter((n) => !oursByName.has(n)).sort();

  const countryLabel = (name: string) => {
    const s = oursByName.get(name) ?? reasonByName.get(name);
    return s ? s.name : name;
  };

  return (
    <div>
      <Eyebrow n="02">catalog · compare</Eyebrow>
      <div className="mb-4 flex items-center gap-3">
        <a href="/catalog" className="font-mono text-xs text-accent hover:underline">← catalog</a>
        <h1 className="text-2xl font-semibold tracking-tight text-white">ours vs existing</h1>
      </div>

      <section className="mb-6 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-[#262626] bg-[#262626]">
        <CountTile label="both branches" value={both.length} />
        <CountTile label="ours only" value={onlyOurs.length} />
        <CountTile label="existing only" value={onlyReason.length} />
      </section>

      {both.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[#666]">
            countries in both — compare maps
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {both.map((name) => {
              const o = oursByName.get(name)!;
              const r = reasonByName.get(name)!;
              return (
                <div key={name} className="rounded-lg border border-[#262626] p-3">
                  <p className="mb-2 truncate text-sm font-medium text-[#ededed]">{countryLabel(name)}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="overflow-hidden rounded-md border border-accent/30">
                        {o.sampleId ? (
                          <ThumbImage fileId={o.sampleId} alt={`${name} ours`} className="aspect-[3/4] w-full" />
                        ) : (
                          <div className="flex aspect-[3/4] items-center justify-center bg-[#141414] font-mono text-[9px] text-[#666]">no map</div>
                        )}
                      </div>
                      <p className="mt-1 truncate font-mono text-[9px] text-accent">ours · {o.images}</p>
                    </div>
                    <div>
                      <div className="overflow-hidden rounded-md border border-[#262626]">
                        {r.sampleId ? (
                          <ThumbImage fileId={r.sampleId} alt={`${name} existing`} className="aspect-[3/4] w-full" />
                        ) : (
                          <div className="flex aspect-[3/4] items-center justify-center bg-[#141414] font-mono text-[9px] text-[#666]">no map</div>
                        )}
                      </div>
                      <p className="mt-1 truncate font-mono text-[9px] text-[#666]">existing · {r.images}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {onlyOurs.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[#666]">
            ours only · {onlyOurs.length}
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {onlyOurs.map((n) => (
              <span key={n} className="rounded-full border border-[#262626] px-2.5 py-1 font-mono text-[10px] text-[#a1a1a1]">
                {countryLabel(n)}
              </span>
            ))}
          </div>
        </section>
      )}

      {onlyReason.length > 0 && (
        <section>
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[#666]">
            existing only · {onlyReason.length}
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {onlyReason.map((n) => (
              <span key={n} className="rounded-full border border-[#262626] px-2.5 py-1 font-mono text-[10px] text-[#a1a1a1]">
                {countryLabel(n)}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function CountTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-black p-3 text-center sm:p-4">
      <p className="font-mono text-xl tabular-nums text-white">{value}</p>
      <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-[#666]">{label}</p>
    </div>
  );
}
