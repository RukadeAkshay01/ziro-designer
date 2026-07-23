/**
 * A fixed-width status-bar field. Counterpart:
 * `EDA_DRAW_FRAME::updateStatusBarWidths` (common/eda_draw_frame.cpp), which
 * sizes each KISTATUSBAR pane from a widest-case template string ("X
 * 00000.0000  Y 00000.0000", …) plus an "M"-width spacer — so the live values
 * never shift their neighbours as they change. The template renders invisibly
 * under the value to reserve exactly that width in the page font.
 */

import type { JSX, ReactNode } from 'react';

/** The template strings KiCad measures, verbatim. */
export const STATUS_FIELD_TEMPLATES = {
  zoom: 'Z 762000',
  coords: 'X 00000.0000  Y 00000.0000',
  deltas: 'dx 00000.0000  dy 00000.0000  dist 00000.0000',
  grid: 'grid 0000.0000 x 0000.0000',
  units: 'Inches',
  constraint: 'Constrain to H, V, 45',
} as const;

export function StatusField({
  template,
  children,
  testId,
}: {
  template: string;
  children?: ReactNode;
  testId?: string;
}): JSX.Element {
  return (
    <span className="cell sized" data-testid={testId}>
      <span className="ze-size-template" aria-hidden="true">
        {template}
      </span>
      <span className="ze-size-value">{children}</span>
    </span>
  );
}
