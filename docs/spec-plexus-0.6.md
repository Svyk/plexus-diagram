# Plexus Diagram v0.6.0 — connections addendum

Supersedes the connection section of `docs/spec-plexus-0.4.md`. Everything else in 0.4 still applies. Native-first: cards stay diagram children. Layout lives on `[[plexus-diagram/metadata]]`. Do not write `:diagram/*` or `:harc/*`. Zero runtime deps.

## Edge row

`edge A->B` on the diagram's metadata block. Optional children, omitted when default:

- `kind::` `bezier` (default) | `straight` | `elbow`
- `label::` note on the line
- `from::` / `to::` `auto` (default) | `top` | `right` | `bottom` | `left`
- `direction::` `oneWay` | `twoWay` | `none` — absent falls back to the global Arrowheads setting (`end→oneWay`, `both→twoWay`, `none→none`)
- `color::` swatch id

`METADATA_SCHEMA_VERSION` stays 1.

## Paint

No `var()` in SVG presentation attributes. Stroke and marker fill are resolved literals plus scoped CSS `.pxd-root .pxd-edge` / `.pxd-arrow`. Marker ids are unique per canvas. Head size `clamp(10 / zoom, 6, 24)`.

## Interaction

Drag from a handle stores that side. Click-click and connect-to-empty unchanged. Click the line for a floating inspector (direction, Flip, Route, Label, color, Delete). Flip is disabled when `B->A` already exists. Esc dismisses only when the overlay owns the pointer.

## Ship

`npm run check`. Source + generated together. Author Svyatoslav Kleshchev `<svyk@icloud.com>`. After Pages, remove-and-re-add `https://svyk.github.io/plexus-diagram`. Badge `v0.6.0`. Live CDP on `:9223` against Svy `1IIx5sG4L` is the paint gate.
