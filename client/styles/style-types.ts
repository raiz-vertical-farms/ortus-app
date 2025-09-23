export type Spacing =
  | "px"
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
  | "11"
  | "12"
  | "14"
  | "16"
  | "20"
  | "24"
  | "28"
  | "32"
  | "36"
  | "40"
  | "44"
  | "48"
  | "52"
  | "56"
  | "60"
  | "64"
  | "72"
  | "80"
  | "96";

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
