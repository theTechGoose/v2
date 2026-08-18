/**
 * Canonical site identity for the public marketing pages.
 *
 * Both landing pages ("/" and "/landing") went out with a head carrying only
 * viewport/theme-color/manifest/icon/title/description: no Open Graph, no
 * Twitter card, no canonical. Every share of a paid-ad link — the comment
 * thread under the ad included — rendered as a bare URL with no title, no
 * blurb and no image, which is the cheapest reach a paid campaign can buy.
 *
 * The origin is fixed (not derived from the request) on purpose: canonical
 * and og:url must name the PRODUCTION page, not whatever host — preview
 * deploy, ngrok tunnel, localhost — happened to serve the bytes.
 */

/** Production origin. Must match static/sitemap.xml and static/robots.txt. */
export const SITE_ORIGIN = "https://paperworkmonster.com";

/** Brand name, as it should appear in og:site_name. */
export const SITE_NAME = "Paperwork Monster";

/** The share card: static/og-card.png, 1200x630 (Facebook's large format). */
export const OG_IMAGE = {
  path: "/og-card.png",
  width: 1200,
  height: 630,
  alt: "Paperwork Monster",
} as const;

/** Absolute URL for a site-relative path ("/landing" → origin + path). */
export function absoluteUrl(path: string): string {
  return `${SITE_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

/** OG locale tag for a UI language. */
export function ogLocale(lang: "en" | "es"): string {
  return lang === "es" ? "es_US" : "en_US";
}

export interface SocialMetaInput {
  /** Site-relative path of THIS page, e.g. "/" or "/landing". */
  path: string;
  title: string;
  description: string;
  lang: "en" | "es";
}

export interface MetaTag {
  /** Either an OG `property` or a Twitter/name-based `name`. */
  kind: "property" | "name";
  key: string;
  content: string;
}

/**
 * The full Open Graph + Twitter tag set for one marketing page, so "/" and
 * "/landing" cannot drift into having different social plumbing.
 */
export function socialMetaTags(input: SocialMetaInput): MetaTag[] {
  const url = absoluteUrl(input.path);
  const image = absoluteUrl(OG_IMAGE.path);
  return [
    { kind: "property", key: "og:type", content: "website" },
    { kind: "property", key: "og:site_name", content: SITE_NAME },
    { kind: "property", key: "og:title", content: input.title },
    { kind: "property", key: "og:description", content: input.description },
    { kind: "property", key: "og:url", content: url },
    { kind: "property", key: "og:image", content: image },
    {
      kind: "property",
      key: "og:image:width",
      content: String(OG_IMAGE.width),
    },
    {
      kind: "property",
      key: "og:image:height",
      content: String(OG_IMAGE.height),
    },
    { kind: "property", key: "og:image:alt", content: OG_IMAGE.alt },
    { kind: "property", key: "og:locale", content: ogLocale(input.lang) },
    {
      kind: "property",
      key: "og:locale:alternate",
      content: ogLocale(input.lang === "es" ? "en" : "es"),
    },
    { kind: "name", key: "twitter:card", content: "summary_large_image" },
    { kind: "name", key: "twitter:title", content: input.title },
    { kind: "name", key: "twitter:description", content: input.description },
    { kind: "name", key: "twitter:image", content: image },
    { kind: "name", key: "twitter:image:alt", content: OG_IMAGE.alt },
  ];
}
