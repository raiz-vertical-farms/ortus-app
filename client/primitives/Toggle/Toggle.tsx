import React from "react";
import styles from "./Toggle.module.css";
import { classNames } from "../../utils/classnames";

type ToggleStyle = React.CSSProperties & {
  "--toggle-active-color"?: string;
  "--toggle-inactive-color"?: string;
  "--toggle-thumb-color"?: string;
};

export type ToggleProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  onLabel?: React.ReactNode;
  offLabel?: React.ReactNode;
  labelPosition?: "left" | "right";
  color?: string;
  inactiveColor?: string;
  thumbColor?: string;
};

const Toggle = React.forwardRef<HTMLInputElement, ToggleProps>(
  (
    {
      className,
      checked,
      defaultChecked,
      disabled,
      onChange,
      onLabel = "On",
      offLabel = "Off",
      labelPosition = "right",
      color,
      inactiveColor,
      thumbColor,
      style,
      id,
      ...rest
    },
    ref
  ) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;

    const isControlled = typeof checked === "boolean";
    const [internalChecked, setInternalChecked] = React.useState(
      Boolean(defaultChecked)
    );

    React.useEffect(() => {
      if (!isControlled && defaultChecked !== undefined) {
        setInternalChecked(Boolean(defaultChecked));
      }
    }, [defaultChecked, isControlled]);

    const isOn = isControlled ? Boolean(checked) : internalChecked;

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!isControlled) {
        setInternalChecked(event.target.checked);
      }

      onChange?.(event);
    };

    const inlineStyle = Object.assign({}, style) as ToggleStyle;

    if (color) inlineStyle["--toggle-active-color"] = color;
    if (inactiveColor) inlineStyle["--toggle-inactive-color"] = inactiveColor;
    if (thumbColor) inlineStyle["--toggle-thumb-color"] = thumbColor;

    const labelContent = isOn ? onLabel : offLabel;
    const hasLabel =
      labelContent !== undefined &&
      labelContent !== null &&
      labelContent !== false;

    const stateLabel = hasLabel ? (
      <span
        className={classNames(styles.stateLabel, {
          [styles.stateLabelOn]: isOn,
        })}
      >
        {labelContent}
      </span>
    ) : null;

    return (
      <label
        className={classNames(styles.toggle, className, {
          [styles.disabled]: disabled,
        })}
        htmlFor={inputId}
        style={inlineStyle}
      >
        {labelPosition === "left" && stateLabel}
        <span className={styles.switch}>
          <input
            {...rest}
            id={inputId}
            ref={ref}
            type="checkbox"
            role="switch"
            aria-checked={isOn}
            checked={isOn}
            disabled={disabled}
            onChange={handleChange}
            className={styles.input}
          />
          <span className={styles.track}>
            <span className={styles.thumb} />
          </span>
        </span>
        {labelPosition === "right" && stateLabel}
      </label>
    );
  }
);

Toggle.displayName = "Toggle";

export default Toggle;
