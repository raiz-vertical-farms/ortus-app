// Text.tsx
import React from "react";
import styles from "./Text.module.css";
import { classNames } from "../../utils/classnames";

export type TextProps = {
  tag?: keyof JSX.IntrinsicElements;
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
  color?: "strong" | "normal" | "muted";
  variant?: "heading" | "subheading" | "body";
  weight?: "normal" | "bold" | "semibold" | "light";
  className?: string;
  children: React.ReactNode;
};

export const Text: React.FC<TextProps> = ({
  tag = "p",
  align = "left",
  size = "base",
  color = "normal",
  variant = "body",
  weight = "normal",
  className,
  children,
}) => {
  const Tag = tag;
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
    >
      {children}
    </Tag>
  );
};
