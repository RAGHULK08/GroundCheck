import { useEffect, useState } from 'react';
import { fetchJson } from './apiClient';

/**
 * Name of the server's configured web search provider (Tavily, Brave Search, SearXNG or
 * Google Search grounding), read once from /api/models for UI labels.
 */
const FALLBACK_LABEL = 'web search';
let labelPromise: Promise<string> | null = null;

export function getSearchProviderLabel(): Promise<string> {
  if (!labelPromise) {
    labelPromise = fetchJson<{ search?: { label?: unknown } }>('/api/models', { timeoutMs: 5_000 })
      .then((d) => (typeof d.search?.label === 'string' && d.search.label ? d.search.label : FALLBACK_LABEL))
      .catch(() => {
        labelPromise = null; // retry on next mount
        return FALLBACK_LABEL;
      });
  }
  return labelPromise;
}

/** React hook: the provider label, 'web search' until it is known. */
export function useSearchProviderLabel(): string {
  const [label, setLabel] = useState(FALLBACK_LABEL);
  useEffect(() => {
    let active = true;
    void getSearchProviderLabel().then((l) => {
      if (active) setLabel(l);
    });
    return () => {
      active = false;
    };
  }, []);
  return label;
}
