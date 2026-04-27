import type { ComponentChildren, JSX } from "preact";

type Variant = "primary" | "outline" | "ghost";

type ButtonAttrs = JSX.IntrinsicElements["button"];
type AnchorAttrs = JSX.IntrinsicElements["a"];

export interface ButtonProps extends Omit<ButtonAttrs, "size" | "class"> {
  variant?: Variant;
  size?: "md" | "lg";
  class?: string;
  children?: ComponentChildren;
}

function classes(variant: Variant, size: "md" | "lg", extra?: string): string {
  return ["btn", `btn-${variant}`, size === "lg" ? "btn-lg" : "", extra ?? ""].filter(Boolean).join(" ");
}

export function Button({ variant = "primary", size = "md", class: cls, children, ...rest }: ButtonProps) {
  return <button class={classes(variant, size, cls)} {...rest}>{children}</button>;
}

export interface AnchorButtonProps extends Omit<AnchorAttrs, "size" | "class"> {
  variant?: Variant;
  size?: "md" | "lg";
  class?: string;
  children?: ComponentChildren;
}

export function AnchorButton({ variant = "primary", size = "md", class: cls, children, ...rest }: AnchorButtonProps) {
  return <a class={classes(variant, size, cls)} {...rest}>{children}</a>;
}
