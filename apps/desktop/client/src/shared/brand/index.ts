// src/shared/brand - the Calibre decoration (rebuild WP1a). Typed React/SVG, presentational only:
// nothing here reads data, calls a command or holds state. Styles: ./brand.css (imported by each).
export { Seal, SEAL_STATES, arcDash, type SealProps, type SealState } from './Seal';
export { Mark } from './Mark';
export { Rosette } from './Rosette';
export { Graticule, type GraticuleProps } from './Graticule';
export { KeyArt, KEY_ART_MODULES, type KeyArtProps } from './KeyArt';
export { DialStrip, stripBeads, type DialStripItem, type DialStripProps } from './DialStrip';
export { dashes, degreeMarks, LOGO, MARK_D, ringFill, ROSETTE_RINGS, SEAL_BANDS, ticks } from './geometry';
