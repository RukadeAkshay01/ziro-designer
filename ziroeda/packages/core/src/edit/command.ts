/**
 * Command bus with undo/redo.
 *
 * Every edit is an `EditCommand` that knows how to apply itself and to produce its
 * inverse against the pre-edit document (KiCad's commit/undo model, expressed
 * functionally). This single mechanism is the spine for undo/redo today and for
 * scripting / AI-driven edits later — they all just submit commands.
 */

import type { Schematic } from '../model/types.js';

export interface EditCommand {
  readonly label: string;
  /** Return a new document with this command applied. Must not mutate `doc`. */
  apply(doc: Schematic): Schematic;
  /** The inverse command, computed against the document as it was *before* apply. */
  invert(before: Schematic): EditCommand;
}

export class History {
  private undoStack: EditCommand[] = [];
  private redoStack: EditCommand[] = [];

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  /** Apply a command, recording its inverse for undo. Clears the redo stack. */
  execute(doc: Schematic, cmd: EditCommand): Schematic {
    const next = cmd.apply(doc);
    this.undoStack.push(cmd.invert(doc));
    this.redoStack = [];
    return next;
  }

  undo(doc: Schematic): Schematic | null {
    const inv = this.undoStack.pop();
    if (!inv) return null;
    const next = inv.apply(doc);
    this.redoStack.push(inv.invert(doc));
    return next;
  }

  redo(doc: Schematic): Schematic | null {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    const next = cmd.apply(doc);
    this.undoStack.push(cmd.invert(doc));
    return next;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
