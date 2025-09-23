import React from "react";
import type { Spacing } from "../../styles/style-types";

type BoxProps = React.HTMLAttributes<HTMLDivElement> & {
  p?: Spacing;
  pt?: Spacing;
  pb?: Spacing;
  pl?: Spacing;
  pr?: Spacing;
  px?: Spacing;
  py?: Spacing;
  m?: Spacing;
  mt?: Spacing;
  mb?: Spacing;
  ml?: Spacing;
  mr?: Spacing;
  mx?: Spacing;
  my?: Spacing;
  children?: React.ReactNode;
};

function getVar(val?: Spacing): string | undefined {
  return val ? `var(--spacing-${val.replace(".", "_")})` : undefined;
}

export const Box: React.FC<BoxProps> = ({
  p,
  pt,
  pb,
  pl,
  pr,
  px,
  py,
  m,
  mt,
  mb,
  ml,
  mr,
  mx,
  my,
  style,
  children,
  ...rest
}) => {
  const paddingStyles: React.CSSProperties = {
    padding: getVar(p),
    paddingTop: getVar(pt ?? py),
    paddingBottom: getVar(pb ?? py),
    paddingLeft: getVar(pl ?? px),
    paddingRight: getVar(pr ?? px),
  };

  const marginStyles: React.CSSProperties = {
    margin: getVar(m),
    marginTop: getVar(mt ?? my),
    marginBottom: getVar(mb ?? my),
    marginLeft: getVar(ml ?? mx),
    marginRight: getVar(mr ?? mx),
  };

  return (
    <div style={{ ...paddingStyles, ...marginStyles, ...style }} {...rest}>
      {children}
    </div>
  );
};

export default Box;
