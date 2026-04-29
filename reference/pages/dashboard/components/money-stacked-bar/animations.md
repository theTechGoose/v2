# Animations — money stacked-bar

The `.money__amt` total uses the `<Ticker value={…}>` helper, which animates the displayed integer from 0 to the target on mount via `requestAnimationFrame` (~720ms by default in the export). It is JS-driven, not a CSS @keyframe.

The bar segments themselves are static — widths are written into inline style at render time, with no transition.

See `shared/design-tokens/motion.md` for the master keyframes catalog (none of those apply to this component).
