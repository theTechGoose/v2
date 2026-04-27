interface Props {
  size?: "sm" | "md";
  inverse?: boolean;
}

export function Brand({ size = "md", inverse = false }: Props) {
  return (
    <a class="brand" href="/" style={inverse ? "color:#fff" : undefined}>
      <span class="brand__mark">P</span>
      <span style={size === "sm" ? "font-size:16px" : undefined}>Paperwork Monsters</span>
    </a>
  );
}
