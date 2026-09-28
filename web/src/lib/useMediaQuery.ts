import { useEffect, useState } from 'react';

/** スマホ幅かどうか（styles.css の @media (max-width: 768px) と同じ） */
export const NARROW_QUERY = '(max-width: 768px)';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}
