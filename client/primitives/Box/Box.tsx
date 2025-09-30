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
  return val ? `var(--spacing-${val})` : undefined;
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
  children,
  ...rest
}) => {
  const paddingStyles: React.CSSProperties = {
    paddingTop: getVar(p ?? pt ?? py),
    paddingBottom: getVar(p ?? pb ?? py),
    paddingLeft: getVar(p ?? pl ?? px),
    paddingRight: getVar(p ?? pr ?? px),
  };

  const marginStyles: React.CSSProperties = {
    marginTop: getVar(m ?? mt ?? my),
    marginBottom: getVar(m ?? mb ?? my),
    marginLeft: getVar(m ?? ml ?? mx),
    marginRight: getVar(m ?? mr ?? mx),
  };

  console.log({ paddingStyles, marginStyles });

  return (
    <div {...rest} style={{ ...paddingStyles, ...marginStyles, ...rest.style }}>
      {children}
    </div>
  );
};

export default Box;
