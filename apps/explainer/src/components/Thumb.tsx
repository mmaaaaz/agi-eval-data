import { useState } from "react";

/** Hot-linked dataset thumbnail with a graceful fallback: some environments
 *  cannot reach the Google CDN, and the page must still explain itself. */
export function SampleThumb({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="thumb-fallback" role="img" aria-label={alt}>
        The photograph could not be loaded here. Open it in the dataset gallery instead.
      </div>
    );
  }
  return <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}
