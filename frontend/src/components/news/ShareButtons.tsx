'use client';

import { useState } from 'react';

/**
 * Lightweight share controls. Plain share-intent links (no third-party
 * SDKs); copy-link is the only client behavior, with clipboard fallback.
 */
export function ShareButtons({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);

  const copyLink = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const field = document.createElement('textarea');
        field.value = url;
        document.body.appendChild(field);
        field.select();
        document.execCommand('copy');
        document.body.removeChild(field);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="share-buttons" aria-label="Share this article">
      <span aria-hidden="true">Share:</span>
      <ul>
        <li>
          <a
            href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`}
            target="_blank"
            rel="noopener"
            aria-label="Share on Facebook"
          >
            Facebook
          </a>
        </li>
        <li>
          <a
            href={`https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`}
            target="_blank"
            rel="noopener"
            aria-label="Share on X"
          >
            X
          </a>
        </li>
        <li>
          <a
            href={`https://wa.me/?text=${encodedTitle}%20${encodedUrl}`}
            target="_blank"
            rel="noopener"
            aria-label="Share on WhatsApp"
          >
            WhatsApp
          </a>
        </li>
        <li>
          <button type="button" onClick={copyLink} aria-live="polite" aria-label="Copy article link">
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </li>
      </ul>
    </div>
  );
}
