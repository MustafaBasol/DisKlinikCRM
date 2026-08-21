/**
 * index.ts — barrel for the odontogram visual system (DENTAL-CHART-UX-001-R2).
 */
export { default as Odontogram } from './Odontogram';
export type { OdontogramProps } from './Odontogram';
export { default as ToothGlyph } from './ToothGlyph';
export type { ToothGlyphProps, ChartSize } from './ToothGlyph';
export { getToothIdentity } from './toothIdentity';
export type { ToothArch, ToothSide, ToothQuadrant, ToothFamily, ToothIdentity } from './toothIdentity';
