/**
 * The Mosaic logomark: a 2x2 grid of rounded tiles.
 *
 * Rendered with `currentColor` and per-tile opacity rather than the fixed brand
 * hexes so it inherits whatever text colour its context uses (light sidebar,
 * dark dialog, pressed button state). The distinct tile opacities are what make
 * it read as a mosaic instead of a flat square, so they must stay.
 */
export const MosaicMark = ({
  size = 24,
  className,
  title,
}: {
  size?: number;
  className?: string;
  title?: string;
}) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 110 110"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role={title ? "img" : "presentation"}
    aria-label={title}
    aria-hidden={title ? undefined : true}
    focusable="false"
  >
    {title ? <title>{title}</title> : null}
    <rect x="8" y="8" width="42" height="42" rx="11" fill="currentColor" />
    <rect
      x="60"
      y="8"
      width="42"
      height="42"
      rx="11"
      fill="currentColor"
      opacity="0.6"
    />
    <rect
      x="8"
      y="60"
      width="42"
      height="42"
      rx="11"
      fill="currentColor"
      opacity="0.78"
    />
    <rect
      x="60"
      y="60"
      width="42"
      height="42"
      rx="11"
      fill="currentColor"
      opacity="0.28"
    />
  </svg>
);
