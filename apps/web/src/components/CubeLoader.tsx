interface CubeLoaderProps {
  label?: string;
  compact?: boolean;
}

export function CubeLoader({ label = "Loading", compact = false }: CubeLoaderProps) {
  const letters = label.trim().slice(0, 7).padEnd(7, " ").split("");

  return (
    <span
      className={`cube-loader${compact ? " cube-loader-compact" : ""}`}
      role="status"
      aria-label={label}
    >
      <span className="wrapper-grid" aria-hidden="true">
        {letters.map((letter, index) => (
          <span className="cube" key={index}>
            <span className="face face-front">{letter}</span>
            <span className="face face-back">{letter}</span>
            <span className="face face-left">{letter}</span>
            <span className="face face-right">{letter}</span>
            <span className="face face-top" />
            <span className="face face-bottom" />
          </span>
        ))}
      </span>
      {!compact && <span className="cube-loader-label">{label}</span>}
    </span>
  );
}
