import React from "react";
import styles from "./Button.module.css";
import { classNames } from "../../utils/classnames";

type Variant = "primary" | "secondary" | "accent" | "destructive" | "ghost";
type Size = "xs" | "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  full?: boolean;
  square?: boolean;
  loading?: boolean;
}

const Button: React.FC<ButtonProps> = ({
  variant = "primary",
  size = "md",
  full = false,
  square = false,
  loading = false,
  className,
  children,
  ...props
}) => {
  return (
    <button
      className={classNames(
        className,
        styles.button,
        styles[variant],
        styles[size],
        {
          [styles.full]: full && !square,
          [styles.square]: square,
          [styles.loading]: loading,
        }
      )}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? "..." : children}
    </button>
  );
};

export default Button;
