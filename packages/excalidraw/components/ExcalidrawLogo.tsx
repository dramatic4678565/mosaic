import "./ExcalidrawLogo.scss";

/**
 * Mosaic mark: 2x2 rounded tile grid from mosaic-brand-directions.zip.
 *
 * Rendered with `currentColor` + per-tile opacity so it inherits the existing
 * `--color-logo-icon` CSS variable and therefore keeps working across light and
 * dark themes without hard-coding the brand blue.
 */
const LogoIcon = () => (
  <svg
    viewBox="0 0 110 110"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="ExcalidrawLogo-icon"
  >
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

/**
 * Wordmark. Sized through the existing `.ExcalidrawLogo-text` CSS rule, which
 * sets `height` and leaves `width: auto`, so the viewBox aspect ratio drives
 * the rendered width.
 */
const LogoText = () => (
  <svg
    viewBox="0 0 200 48"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    className="ExcalidrawLogo-text"
  >
    <text
      x="0"
      y="37"
      fontFamily="Inter, 'Segoe UI', Arial, sans-serif"
      fontSize="46"
      fontWeight="650"
      letterSpacing="-1.2"
      fill="currentColor"
    >
      Mosaic
    </text>
  </svg>
);

type LogoSize = "xs" | "small" | "normal" | "large" | "custom" | "mobile";

interface LogoProps {
  size?: LogoSize;
  withText?: boolean;
  style?: React.CSSProperties;
  /**
   * If true, the logo will not be wrapped in a Link component.
   * The link prop will be ignored as well.
   * It will merely be a plain div.
   */
  isNotLink?: boolean;
}

/**
 * Note: the exported name and CSS class names intentionally keep their upstream
 * `Excalidraw` spelling. They are imported across the codebase
 * (`@excalidraw/excalidraw/components/ExcalidrawLogo`) and referenced by the
 * `.ExcalidrawLogo*` selectors in ExcalidrawLogo.scss. Only the artwork and the
 * displayed word changed.
 */
export const ExcalidrawLogo = ({
  style,
  size = "small",
  withText,
}: LogoProps) => {
  return (
    <div className={`ExcalidrawLogo is-${size}`} style={style}>
      <LogoIcon />
      {withText && <LogoText />}
    </div>
  );
};
