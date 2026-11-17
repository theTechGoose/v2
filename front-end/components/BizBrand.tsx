/**
 * REQ-628 — the business's brand at the head of a customer-facing document:
 * its logo, scaled into a fixed 200×64 box keeping its aspect ratio, when one
 * is on file; otherwise its name as a text wordmark. Never DocuMonster's.
 */
export default function BizBrand(
  { logoSrc, name, align = "left", color = "#144852" }: {
    /** the public-logo URL, or undefined when no logo is on file */
    logoSrc?: string;
    name: string;
    align?: "left" | "center";
    color?: string;
  },
) {
  const margin = align === "center" ? "0 auto" : "0";
  if (logoSrc) {
    return (
      <img
        data-cy="biz-logo"
        src={logoSrc}
        alt={name}
        style={`display:block;margin:${margin};width:auto;height:auto;max-width:200px;max-height:64px;object-fit:contain`}
      />
    );
  }
  return (
    <div
      data-cy="biz-wordmark"
      style={`font-weight:900;font-size:22px;letter-spacing:-0.01em;line-height:1.15;color:${color};text-align:${align};overflow-wrap:anywhere`}
    >
      {name}
    </div>
  );
}
