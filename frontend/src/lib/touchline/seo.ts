import type { Metadata } from "next";
import { siteConfig } from "@/config/site";
import { getSiteUrl } from "./site-data";

interface PageMetadataInput {
  title: string;
  description: string;
  path: string;
  image?: string;
  type?: "website" | "article";
  noIndex?: boolean;
}

/**
 * Builds route metadata.
 *
 * Canonicals are absolute and `robots` is the `"index,follow"` /
 * `"noindex,nofollow"` string form, matching the contract the rest of the app and
 * its tests rely on. The home route canonicalizes to the bare origin without a
 * trailing slash.
 */
export function buildPageMetadata({ title, description, path, image, type = "website", noIndex = false }: PageMetadataInput): Metadata {
  const siteName = siteConfig.name;
  const canonical = path === "/" ? siteConfig.siteUrl : getCanonicalUrl(path.startsWith("/") ? path : `/${path}`);
  const metadataBase = new URL(getSiteUrl());
  // Only a real image from the data layer is used; nothing is invented here, so
  // social cards fall back to no image rather than a stock asset.
  const socialImage = image;
  const robots = noIndex ? "noindex,nofollow" : "index,follow";
  return {
    metadataBase,
    title: `${title} | ${siteName}`,
    description,
    alternates: { canonical },
    robots,
    openGraph: {
      type,
      url: canonical,
      siteName,
      title: `${title} | ${siteName}`,
      description,
      ...(socialImage ? { images: [{ url: socialImage, width: 1200, height: 630, alt: `Football coverage from ${siteName}` }] } : {}),
    },
    twitter: {
      card: socialImage ? "summary_large_image" : "summary",
      title: `${title} | ${siteName}`,
      description,
      ...(socialImage ? { images: [socialImage] } : {}),
    },
  };
}

export function getCanonicalUrl(path: string) {
  return new URL(path, getSiteUrl()).toString();
}
