/**
 * The library-tree data model used by the chooser dialogs: a root holding
 * library nodes, holding item nodes, holding unit nodes. Mirrors
 * kicad/common/lib_tree_model.cpp (LIB_TREE_NODE and subclasses).
 */
import type { EdaCombinedMatcher, SearchTerm } from '@ziroeda/common';

/** Upstream LIB_TREE_NODE::TYPE — the numeric order matters for sorting. */
export enum LibTreeNodeType {
  ROOT = 0,
  LIBRARY = 1,
  ITEM = 2,
  UNIT = 3,
}

export type LibTreeNodeFilter = (node: LibTreeNode) => boolean;

/** Natural-order compare (upstream StrNumCmp with case-insensitivity). */
function strNumCmp(a: string, b: string): number {
  return (
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) || a.localeCompare(b)
  );
}

export class LibTreeNode {
  parent: LibTreeNode | null = null;
  type: LibTreeNodeType = LibTreeNodeType.ROOT;
  children: LibTreeNode[] = [];

  /** Displayed name (Item column). */
  name = '';
  /** Displayed description (Description column). */
  desc = '';
  /** Library nickname portion of the LIB_ID ('' for groups). */
  libNickname = '';
  /** Item name portion of the LIB_ID ('' for library rows). */
  libItemName = '';
  footprint = '';
  pinCount = 0;
  unit = 0;

  intrinsicRank = 0;
  score = 0;
  exactMatch = false;
  pinned = false;

  isRoot = false;
  isPower = false;
  isRecentlyUsedGroup = false;
  isAlreadyPlacedGroup = false;

  /** Weighted search terms, built by the creator (LIB_SYMBOL::GetSearchTerms). */
  searchTerms: SearchTerm[] = [];

  /** LIB_ID as written, e.g. "Device:R", or '' when the node has none. */
  get libId(): string {
    return this.libItemName ? `${this.libNickname}:${this.libItemName}` : '';
  }

  get isGroup(): boolean {
    return this.isRecentlyUsedGroup || this.isAlreadyPlacedGroup;
  }

  /**
   * LIB_TREE_NODE::AssignIntrinsicRanks — pre-sort children alphabetically so
   * they tie-break consistently once scores equalise. `presorted` preserves
   * the insertion order (used by the Recently Used group).
   */
  assignIntrinsicRanks(presorted = false): void {
    if (presorted) {
      const max = this.children.length - 1;
      this.children.forEach((child, i) => {
        child.intrinsicRank = max - i;
      });
    } else {
      const sorted = [...this.children].sort((a, b) => -strNumCmp(a.name, b.name));
      sorted.forEach((child, i) => {
        child.intrinsicRank = i;
      });
    }
  }

  /** LIB_TREE_NODE_*::UpdateScore — matches propagate scores down the tree. */
  updateScore(matchers: EdaCombinedMatcher[], filter: LibTreeNodeFilter | null): void {
    switch (this.type) {
      case LibTreeNodeType.ROOT:
        for (const child of this.children) child.updateScore(matchers, filter);
        return;

      case LibTreeNodeType.LIBRARY:
        if (this.children.length === 0) {
          // As-yet-unloaded libraries score on their own terms so a library
          // whose name matches still shows up.
          this.scoreSelf(matchers);
        } else {
          this.score = 0;
          this.exactMatch = false;
          for (const child of this.children) {
            child.updateScore(matchers, filter);
            this.score = Math.max(this.score, child.score);
            this.exactMatch ||= child.exactMatch;
          }
        }
        return;

      case LibTreeNodeType.ITEM:
        this.scoreSelf(matchers);
        if (filter && !filter(this)) this.score = 0;
        for (const child of this.children) child.updateScore(matchers, filter);
        return;

      case LibTreeNodeType.UNIT:
        // Match results are inherited from the parent symbol.
        this.score = 1;
        this.exactMatch = false;
        if (matchers.length > 0 && this.parent) {
          this.score = this.parent.score;
          this.exactMatch = this.parent.exactMatch;
        }
        if (filter && !filter(this)) this.score = 0;
        return;
    }
  }

  private scoreSelf(matchers: EdaCombinedMatcher[]): void {
    this.score = 1;
    this.exactMatch = false;
    for (const matcher of matchers) {
      const { score, exact } = matcher.scoreTerms(this.searchTerms);
      if (score === 0) {
        // Each search token must match somewhere; a miss vetoes the item.
        this.score = 0;
        this.exactMatch = false;
        return;
      }
      this.score += score;
      this.exactMatch ||= exact;
    }
  }

  sortNodes(useScores: boolean): void {
    this.children.sort((a, b) =>
      compareNodes(a, b, useScores) ? -1 : compareNodes(b, a, useScores) ? 1 : 0,
    );
    for (const child of this.children) child.sortNodes(useScores);
  }
}

/**
 * LIB_TREE_NODE::Compare — Recently Used first, then pinned libraries, then
 * exact matches, then score, then the intrinsic (alphabetical) rank.
 */
export function compareNodes(a: LibTreeNode, b: LibTreeNode, useScores: boolean): boolean {
  if (a.type !== b.type) return a.type < b.type;

  // Recently used sorts at top; the Already Placed group ("-- " prefix) next.
  if (a.isRecentlyUsedGroup) return !b.isRecentlyUsedGroup;
  if (b.isRecentlyUsedGroup) return false;
  if (a.name.startsWith('-- ') && !b.name.startsWith('-- ')) return true;
  if (b.name.startsWith('-- ')) return false;

  // Pinned nodes go next.
  if (a.pinned && !b.pinned) return true;
  if (b.pinned && !a.pinned) return false;

  if (useScores) {
    // Exact matches form a strictly higher tier than any accumulation of
    // partial matches.
    if (a.exactMatch !== b.exactMatch) return a.exactMatch;
    if (a.score !== b.score) return a.score > b.score;
  }

  return a.intrinsicRank > b.intrinsicRank;
}

/** LIB_TREE_NODE_LIBRARY — one library (or pseudo-library group) row. */
export function makeLibraryNode(parent: LibTreeNode, name: string, desc: string): LibTreeNode {
  const node = new LibTreeNode();
  node.type = LibTreeNodeType.LIBRARY;
  node.parent = parent;
  node.name = name;
  node.desc = desc;
  node.libNickname = name;
  node.searchTerms = [{ text: name, score: 8, isName: true }];
  parent.children.push(node);
  return node;
}

/** LIB_TREE_NODE_ITEM — one symbol row under a library. */
export function makeItemNode(parent: LibTreeNode, libNickname: string, name: string): LibTreeNode {
  const node = new LibTreeNode();
  node.type = LibTreeNodeType.ITEM;
  node.parent = parent;
  node.name = name;
  node.libNickname = libNickname;
  node.libItemName = name;
  parent.children.push(node);
  return node;
}

/** LIB_TREE_NODE_UNIT — "Unit A"… sub-rows of a multi-unit symbol. */
export function makeUnitNode(parent: LibTreeNode, name: string, unit: number): LibTreeNode {
  const node = new LibTreeNode();
  node.type = LibTreeNodeType.UNIT;
  node.parent = parent;
  node.name = name;
  node.unit = unit;
  node.libNickname = parent.libNickname;
  node.libItemName = parent.libItemName;
  node.intrinsicRank = -unit;
  parent.children.push(node);
  return node;
}
