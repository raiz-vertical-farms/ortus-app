export type Spacing =
  | "2xs" // 0.125rem (2px)
  | "xs" // 0.25rem  (4px)
  | "sm" // 0.5rem   (8px)
  | "md" // 0.75rem  (12px)
  | "lg" // 1rem     (16px)
  | "xl" // 1.5rem   (24px)
  | "2xl" // 2rem     (32px)
  | "3xl" // 2.5rem   (40px)
  | "4xl" // 3rem     (48px)
  | "5xl" // 4rem     (64px)
  | "6xl" // 6rem     (96px)
  | "7xl"; // 8rem     (128px)

export type FontSize =
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

export type Radius =
  | "none"
  | "sm"
  | "" // corresponds to `--radius`
  | "md"
  | "lg"
  | "xl"
  | "2xl"
  | "3xl"
  | "full";

export type BorderWidth = "0" | "" | "2" | "4" | "8";

export type Opacity =
  | "0"
  | "5"
  | "10"
  | "20"
  | "25"
  | "30"
  | "40"
  | "50"
  | "60"
  | "70"
  | "75"
  | "80"
  | "90"
  | "95"
  | "100";

export type ZIndex = "auto" | "0" | "10" | "20" | "30" | "40" | "50";

export type Breakpoint = "sm" | "md" | "lg" | "xl" | "2xl";

export type Color =
  | "background"
  | "background-hover"
  | "foreground"
  | "primary"
  | "primary-foreground"
  | "primary-hover"
  | "primary-active"
  | "text-strong"
  | "text"
  | "text-muted"
  | "secondary"
  | "secondary-foreground"
  | "secondary-hover"
  | "secondary-active"
  | "accent"
  | "accent-foreground"
  | "accent-hover"
  | "accent-active"
  | "destructive"
  | "destructive-foreground"
  | "destructive-hover"
  | "destructive-active"
  | "border"
  | "input"
  | "ring"
  | "card"
  | "card-foreground";

export type ElementSize = "sm" | "md" | "lg";

export type FontFamily = "heading" | "body";
