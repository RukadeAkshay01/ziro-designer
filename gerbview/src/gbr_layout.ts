/**
 * GBR_LAYOUT — the collection of loaded Gerber/drill images, mirroring
 * `gerbview/gbr_layout.h`. GerbView holds up to GERBER_DRAWLAYERS_COUNT active
 * layers; this container tracks them in draw order and computes the overall
 * bounding box for zoom-to-fit.
 */

import type { GERBER_FILE_IMAGE } from './gerber_file_image.js';
import type { BBox } from './gerber_draw_item.js';
import { GERBER_DRAWLAYERS_COUNT } from './types.js';

export class GBR_LAYOUT {
  images: (GERBER_FILE_IMAGE | null)[] = new Array(GERBER_DRAWLAYERS_COUNT).fill(null);

  /** First free layer slot, or -1 when all 32 are taken. */
  firstFreeLayer(): number {
    return this.images.findIndex((im) => im === null);
  }

  activeImages(): GERBER_FILE_IMAGE[] {
    return this.images.filter((im): im is GERBER_FILE_IMAGE => im !== null);
  }

  /** Bounding box over every visible image (IU). `visible[i]` gates layer i. */
  computeBoundingBox(visible?: boolean[]): BBox {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    let any = false;
    this.images.forEach((im, idx) => {
      if (!im || !im.hasContent()) return;
      if (visible && !visible[idx]) return;
      const b = im.computeBoundingBox();
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
      any = true;
    });
    if (!any) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    return { minX, minY, maxX, maxY };
  }
}
