import React from "react";
import styles from "./Container.module.css";
import { classNames } from "../../utils/classnames";

type ContainerProps = {
  size?: "sm" | "md" | "lg" | "full";
  gutter?: boolean;
  className?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
};

const Container: React.FC<ContainerProps> = ({
  size = "md",
  gutter = true,
  className = "",
  style,
  children,
}) => {
  const containerClass = classNames(
    styles.container,
    styles[size],
    {
      [styles.gutter]: gutter,
    },
    className
  );

  return (
    <div className={containerClass} style={style}>
      {children}
    </div>
  );
};

export default Container;
