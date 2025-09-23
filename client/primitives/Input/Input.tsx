import React from "react";
import styles from "./Input.module.css";
import { classNames } from "../../utils/classnames";
type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  full?: boolean;
  inputSize?: "sm" | "md" | "lg";
};

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", label, full, id, inputSize = "md", ...props }, ref) => {
    const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;

    return (
      <div
        className={classNames(styles.wrapper, {
          [styles.full]: full,
        })}
      >
        {label && (
          <label htmlFor={inputId} className={styles.label}>
            {label}
          </label>
        )}
        <input
          id={inputId}
          ref={ref}
          className={classNames(styles.input, className, {
            [styles[inputSize]]: inputSize,
          })}
          {...props}
        />
      </div>
    );
  }
);

Input.displayName = "Input";

export default Input;
