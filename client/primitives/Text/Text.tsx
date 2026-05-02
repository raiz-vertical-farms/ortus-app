// Text.tsx
import React from "react";
import styles from "./Text.module.css";
import { classNames } from "../../utils/classnames";

import type { Spacing } from "../../styles/style-types";

export type TextProps = {
  tag?: keyof React.JSX.IntrinsicElements;
  align?: "left" | "center" | "right";
  size?:
    | "xs"
    | "sm"
    | "base"
    | "lg"
    | "xl"
    | "2xl"
    | "3xl"
    | "4xl"
    | "5xl"
    | "6xl"
    | "7xl"
    | "8xl"
    | "9xl";
  color?: "strong" | "normal" | "muted" | "destructive";
  variant?: "heading" | "subheading" | "body";
  weight?: "normal" | "bold" | "semibold" | "light";
  mb?: Spacing;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
};

export const Text: React.FC<TextProps> = ({
  tag = "p",
  align = "",
  size = "base",
  color,
  variant = "body",
  weight = "normal",
  mb,
  className,
  style,
  children,
}) => {
  const Tag = tag;
  const marginStyles: React.CSSProperties = {
    marginBottom: mb ? `var(--spacing-${mb})` : undefined,
  };

  return (
    <Tag
      className={classNames(
        styles.text,
        styles[`align-${align}`],
        styles[`size-${size}`],
        styles[`color-${color}`],
        styles[`variant-${variant}`],
        styles[`weight-${weight}`],
        className
      )}
      style={{ ...marginStyles, ...style }}
    >
      {children}
    </Tag>
  );
};
