export function MobileMenuButton({
  open,
  onClick,
  controls,
}: {
  open: boolean;
  onClick: () => void;
  controls: string;
}) {
  return (
    <button
      className={`mobile-menu-toggle${open ? " is-open" : ""}`}
      type="button"
      aria-label={open ? "Close navigation menu" : "Open navigation menu"}
      aria-controls={controls}
      aria-expanded={open}
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={open ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"} />
      </svg>
    </button>
  );
}
