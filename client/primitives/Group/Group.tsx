import React from "react";
import styles from "./Group.module.css";
import { classNames } from "../../utils/classnames";

type Spacing =
  | "0"
  | "0_5"
  | "1"
  | "1_5"
  | "2"
  | "2_5"
  | "3"
  | "3_5"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "12"
  | "16"
  | "20"
  | "24"
  | "32"
  | "40";

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
    <div className={classes} {...props}>
      {children}
    </div>
  );
};
