/**
 * File-type detection and dispatch, mirroring GerbView's file-open logic
 * (`GERBVIEW_FRAME::LoadFileOrShowDialog` + `IsExcellonFile`). Given the text of
 * a loaded file, decide whether it is RS-274X Gerber or an Excellon drill file
 * and parse it into a GERBER_FILE_IMAGE. Also parses `.gbrjob` job files (JSON)
 * enough to recover per-file layer functions for auto-colouring.
 */

import type { GERBER_FILE_IMAGE } from './gerber_file_image.js';
import { parseGerber } from './gerber_file_image_parse.js';
import { parseExcellon } from './excellon.js';

/** Heuristic: does this look like an Excellon drill file? */
export function isExcellonFile(text: string, fileName = ''): boolean {
  const head = text.slice(0, 4000);
  // Extensions strongly associated with drill files.
  if (/\.(drl|nc|xln|tap|drd|txt)$/i.test(fileName) && /M48|T\d+C/.test(head)) return true;
  // Gerber markers rule Excellon out.
  if (/%FS|%MO(MM|IN)|%AD|%AM/.test(head)) return false;
  // Excellon markers.
  if (/^\s*M48/m.test(head)) return true;
  if (/FMAT|;FILE_FORMAT|INCH,\s*[LT]Z|METRIC,\s*[LT]Z/.test(head)) return true;
  if (/^\s*T\d+C[-+0-9.]/m.test(head)) return true;
  return false;
}

/** Detect the file type and parse into a GERBER_FILE_IMAGE. */
export function readGerberOrDrill(text: string, fileName: string): GERBER_FILE_IMAGE {
  if (isExcellonFile(text, fileName)) return parseExcellon(text, fileName);
  return parseGerber(text, fileName);
}

/** A single entry parsed from a `.gbrjob` job file. */
export interface JobFileEntry {
  path: string;
  fileFunction: string;
  filePolarity?: string;
}

/** Parse a KiCad/Ucamco `.gbrjob` (JSON) into per-file layer descriptors. */
export function parseJobFile(text: string): JobFileEntry[] {
  try {
    const json = JSON.parse(text) as {
      FilesAttributes?: {
        Path?: string;
        FileFunction?: string;
        FilePolarity?: string;
      }[];
    };
    const files = json.FilesAttributes ?? [];
    return files.map((f) => ({
      path: f.Path ?? '',
      fileFunction: f.FileFunction ?? '',
      ...(f.FilePolarity ? { filePolarity: f.FilePolarity } : {}),
    }));
  } catch {
    return [];
  }
}
