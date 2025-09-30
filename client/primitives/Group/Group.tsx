import React from "react";
import styles from "./Group.module.css";
import { classNames } from "../../utils/classnames";
import type { Spacing } from "../../styles/style-types";

type Direction = "row" | "column";
type Align = "start" | "center" | "end" | "stretch";
type Justify =
  | "start"
  | "center"
  | "end"
  | "between"
  | "around"
  | "evenly"
  | "stretch";

export interface GroupProps extends React.HTMLAttributes<HTMLDivElement> {
  direction?: Direction;
  align?: Align;
  justify?: Justify;
  spacing?: Spacing;
  wrap?: boolean;
}

export const Group: React.FC<GroupProps> = ({
  children,
  direction = "row",
  align = "start",
  justify = "start",
  spacing = "2",
  wrap = false,
  className,
  ...props
}) => {
  const classes = classNames(
    styles.group,
    styles[`direction-${direction}`],
    styles[`align-${align}`],
    styles[`justify-${justify}`],
    styles[`spacing-${spacing}`],
    wrap && styles.wrap,
    className
  );

  return (
    <div
      className={classes}
      {...props}
      style={{
        ...props.style,
        gap: spacing ? `var(--spacing-${spacing})` : undefined,
      }}
    >
      {children}
    </div>
  );
};
