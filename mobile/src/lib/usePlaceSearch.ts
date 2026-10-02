import { useEffect, useRef, useState } from 'react';
import { api, type SearchResult } from './api';

export const SEARCH_MIN_CHARS = 2;
export const SEARCH_DEBOUNCE_MS = 350;

export type SearchStatus = 'idle' | 'loading' | 'done' | 'error';
export interface SearchState { status: SearchStatus; results: SearchResult[] }

/**
 * Debounced place search (GET /search/places, AC-MOB-15/17): waits SEARCH_DEBOUNCE_MS after the last keystroke,
 * needs SEARCH_MIN_CHARS, and ignores responses that arrive after a newer query. `near` biases results
 * (map centre / device location); it is read when the request fires, so panning the map does not re-query.
 */
export function usePlaceSearch(query: string, near: { lat: number; lon: number } | null, enabled = true): SearchState {
  const [state, setState] = useState<SearchState>({ status: 'idle', results: [] });
  const seq = useRef(0);
  const nearRef = useRef(near);
  nearRef.current = near;

  useEffect(() => {
    const q = query.trim();
    const mine = ++seq.current;
    if (!enabled || q.length < SEARCH_MIN_CHARS) {
      setState({ status: 'idle', results: [] });
      return;
    }
    // Nothing changes on screen while the user is still typing; previous results stay until the request starts.
    const timer = setTimeout(() => {
      setState((s) => ({ status: 'loading', results: s.results }));
      api.searchPlaces(q, nearRef.current)
        .then((results) => { if (seq.current === mine) setState({ status: 'done', results }); })
        .catch(() => { if (seq.current === mine) setState({ status: 'error', results: [] }); });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, enabled]);

  return state;
}
