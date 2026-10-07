'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createDefaultClient } from '@/lib/api-client';
import { getUserMessage, isRateLimitError } from '@/lib/errors';
import { trackSearch } from '@/lib/analytics';
import {
  buildSearchUrl,
  canonicalResultUrl,
  compactSuggestions,
  groupResultsByType,
  isSearchableQuery,
  nextActiveIndex,
  normalizeQuery,
  SEARCH_DEBOUNCE_MS,
  SEARCH_MAX_LENGTH,
  SUGGESTION_LIMIT,
  type SearchFilters,
} from '@/lib/search';
import { rememberSearch } from '@/lib/recent-searches';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { sanitizeText } from '@/lib/validation';
import type { SearchResultItem } from '@/types/api';
import { Alert } from '@/components/ui/Feedback';

export type SuggestionFetcher = (
  query: string,
  signal: AbortSignal,
) => Promise<SearchResultItem[]>;

interface SearchInputProps {
  initialQuery: string;
  /** Current filters, so submitting keeps them in the URL. */
  filters?: Partial<SearchFilters>;
  autoFocus?: boolean;
  /** Overrides for tests. */
  fetcher?: SuggestionFetcher;
  navigate?: (url: string) => void;
  onSubmitted?: (query: string) => void;
}

export const SUGGESTION_PLACEHOLDER = 'Search news, teams, players, matches…';

/** Default suggestion fetcher: small page, short timeout, cancellable. */
export function createSuggestionFetcher(): SuggestionFetcher {
  return async (query, signal) => {
    const client = createDefaultClient();
    const envelope = await client.get<SearchResultItem[]>('/search', {
      query: { q: query, limit: SUGGESTION_LIMIT },
      signal,
      timeoutMs: 6000,
      // Suggestions are not a navigation target, so caching them would only
      // ever serve stale suggestions.
      retry: 0,
    });
    return Array.isArray(envelope.data) ? envelope.data : [];
  };
}

/**
 * Search field with inline suggestions.
 *
 * Request behaviour:
 *  - keystrokes are debounced, and a blank/whitespace-only or too-short query
 *    never reaches the network;
 *  - every keystroke aborts the previous request, so a slow earlier response can
 *    never overwrite a newer one;
 *  - an identical consecutive query is not re-sent;
 *  - pressing Enter submits the visible text *immediately* — the submitted
 *    search is never debounced.
 */
export function SearchInput({
  initialQuery,
  filters = {},
  autoFocus = false,
  fetcher,
  navigate,
  onSubmitted,
}: SearchInputProps) {
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [suggestions, setSuggestions] = useState<SearchResultItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  // Suggestions are for typing only. A deep link already has server-rendered
  // results, so fetching autocomplete on mount would duplicate that request.
  const [interacted, setInteracted] = useState(false);

  const debounced = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const lastRequested = useRef<string>('');
  const listId = useId();
  const inputId = `${listId}-input`;

  // Suggestions: debounced, cancelled, de-duplicated, min-length gated.
  useEffect(() => {
    const normalized = normalizeQuery(debounced);
    // Nothing to suggest before the reader types, or for an unusable query.
    if (!interacted || !isSearchableQuery(normalized)) {
      setStatus('idle');
      setSuggestions([]);
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (normalized === lastRequested.current) {
      setStatus((current) => (current === 'loading' ? current : 'ready'));
      return;
    }
    lastRequested.current = normalized;
    const controller = new AbortController();
    let cancelled = false;
    setStatus('loading');
    setOpen(true);
    (fetcher ?? createSuggestionFetcher())(normalized, controller.signal)
      .then((items) => {
        if (cancelled) return;
        setSuggestions(compactSuggestions(items, SUGGESTION_LIMIT));
        setErrorMessage(null);
        setRateLimited(false);
        setStatus('ready');
        setActiveIndex(-1);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof Error && (error.name === 'AbortError' || (error as { code?: string }).code === 'CANCELLED')) {
          return;
        }
        setRateLimited(isRateLimitError(error));
        setErrorMessage(getUserMessage(error));
        setStatus('error');
        setOpen(true);
      });
    return () => {
      cancelled = true;
      // Abort superseded requests so a stale response is discarded.
      controller.abort();
    };
  }, [debounced, fetcher, interacted]);

  const go = useCallback(
    (url: string) => {
      if (navigate) navigate(url);
      else window.location.assign(url);
    },
    [navigate],
  );

  const submit = useCallback(
    (value: string) => {
      const normalized = normalizeQuery(value);
      if (!isSearchableQuery(normalized)) return;
      // Submitted searches bypass the debounce entirely.
      lastRequested.current = normalized;
      setOpen(false);
      setActiveIndex(-1);
      rememberSearch(normalized);
      trackSearch('search-submitted', { query: normalized, hasFilters: Object.keys(filters).length > 0 });
      go(buildSearchUrl(normalized, { ...filters, page: 1 }));
      onSubmitted?.(normalized);
    },
    [filters, go, onSubmitted],
  );

  const choose = useCallback(
    (item: SearchResultItem) => {
      const url = canonicalResultUrl(item);
      if (!url) return;
      setOpen(false);
      setActiveIndex(-1);
      rememberSearch(query);
      trackSearch('search-suggestion-selected', {
        query,
        entityType: item.entity_type,
        viaKeyboard: true,
      });
      go(url);
    },
    [go, query],
  );

  // "/" focuses search from anywhere, unless the reader is already typing.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
      }
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Keep the highlighted option in view during keyboard navigation.
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const option = listRef.current.querySelectorAll<HTMLLIElement>('[role="option"]')[activeIndex];
    option?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const flat = suggestions.map((item) => ({ item, url: canonicalResultUrl(item) }));

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (open) {
        // Close the suggestions but keep the typed text and focus.
        event.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
      }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      if (!open || flat.length === 0) return;
      // Never steal Home/End from a text cursor in a non-empty field.
      if ((event.key === 'Home' || event.key === 'End') && query.length > 0) return;
      event.preventDefault();
      setActiveIndex(nextActiveIndex(activeIndex, event.key, flat.length));
      return;
    }
    if (event.key === 'Enter') {
      if (open && activeIndex >= 0 && flat[activeIndex]?.url) {
        event.preventDefault();
        choose(flat[activeIndex].item);
        return;
      }
      // Fall through to the form's submit.
    }
  };

  const groups = groupResultsByType(suggestions);
  // `compactSuggestions` already emits results grouped in display order, so
  // iterating the flat list and switching header on a type change keeps the
  // rendered option index identical to the keyboard-navigated index.
  const groupLabelByType = new Map(groups.map((group) => [group.type, group.label]));

  return (
    <form
      role="search"
      aria-label="Search football"
      className="search-input"
      action="/search"
      method="get"
      onSubmit={(event) => {
        event.preventDefault();
        submit(query);
      }}
    >
      <div className="search-input__field">
        <label htmlFor={inputId} className="visually-hidden">
          Search football news, teams, players, competitions and matches
        </label>
        <input
          ref={inputRef}
          id={inputId}
          name="q"
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
          aria-describedby={`${inputId}-hint`}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          maxLength={SEARCH_MAX_LENGTH}
          placeholder={SUGGESTION_PLACEHOLDER}
          value={query}
          onChange={(event) => {
            setInteracted(true);
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            // Let a click on an option land before closing.
            window.setTimeout(() => {
              if (!listRef.current?.contains(document.activeElement)) setOpen(false);
            }, 120);
          }}
        />
        {query ? (
          <button
            type="button"
            className="search-input__clear"
            onClick={() => {
              setQuery('');
              setSuggestions([]);
              setStatus('idle');
              setOpen(false);
              setActiveIndex(-1);
              lastRequested.current = '';
              inputRef.current?.focus();
            }}
          >
            <span aria-hidden="true">&times;</span>
            <span className="visually-hidden">Clear search</span>
          </button>
        ) : null}
        <button type="submit" className="search-input__submit">
          Search
        </button>
      </div>

      <p id={`${inputId}-hint`} className="search-input__hint">
        Press <kbd>/</kbd> to search, <kbd>Enter</kbd> to submit, <kbd>&uarr;</kbd> <kbd>&darr;</kbd> to browse
        suggestions, <kbd>Esc</kbd> to close.
      </p>

      {/* Announcements for assistive tech; never repeats identical text. */}
      <p role="status" aria-live="polite" className="visually-hidden">
        {status === 'loading'
          ? 'Searching'
          : status === 'ready' && suggestions.length > 0
            ? `${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'} available`
            : ''}
      </p>

      {status === 'loading' ? <span className="search-input__spinner" aria-hidden="true" /> : null}

      {open && status === 'error' ? (
        <Alert tone="warning">
          {sanitizeText(errorMessage ?? 'Suggestions are unavailable')}
          {rateLimited ? ' Try again in a moment.' : ''}
        </Alert>
      ) : null}

      {open && (status === 'ready' || status === 'error') && suggestions.length > 0 ? (
        <ul
          ref={listRef}
          id={listId}
          className="search-input__suggestions"
          role="listbox"
          aria-label="Search suggestions"
        >
          {flat.map((entry, optionIndex) => {
            const label = groupLabelByType.get(entry.item.entity_type);
            const previous = optionIndex > 0 ? flat[optionIndex - 1].item.entity_type : null;
            const showHeader = entry.item.entity_type !== previous;
            return (
              <span key={`${entry.item.entity_type}-${entry.item.entity_id}`} className="search-input__option-wrap">
                {showHeader && label ? (
                  <p className="search-input__group-label" role="presentation">
                    {label}
                  </p>
                ) : null}
                <span
                  role="option"
                  id={`${listId}-option-${optionIndex}`}
                  aria-selected={optionIndex === activeIndex}
                  className="search-input__option"
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={(event) => {
                      // Prevent the input's blur from closing the list first.
                      event.preventDefault();
                    }}
                    onClick={() => choose(entry.item)}
                  >
                    <span className="search-input__option-title">{sanitizeText(entry.item.title, 120)}</span>
                    {entry.item.description ? (
                      <span className="search-input__option-meta">
                        {sanitizeText(entry.item.description, 80)}
                      </span>
                    ) : null}
                  </button>
                </span>
              </span>
            );
          })}
        </ul>
      ) : null}
    </form>
  );
}
