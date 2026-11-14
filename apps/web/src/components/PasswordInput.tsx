import { useState } from "react";
import type { InputHTMLAttributes } from "react";

export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  const { className, ...inputProps } = props;

  return (
    <span className="password-input-wrap">
      <input
        {...inputProps}
        className={className ? `${className} password-input` : "password-input"}
        type={visible ? "text" : "password"}
      />
      <button
        className="password-reveal-toggle"
        type="button"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {visible ? (
            <>
              <path d="M3 3l18 18" />
              <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
              <path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a14 14 0 0 1-3.2 3.9" />
              <path d="M6.2 6.2C3.5 8 2 12 2 12s3.5 7 10 7a10.7 10.7 0 0 0 4.1-.8" />
            </>
          ) : (
            <>
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
              <circle cx="12" cy="12" r="2.5" />
            </>
          )}
        </svg>
      </button>
    </span>
  );
}
