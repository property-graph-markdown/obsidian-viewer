/**
 * Browser-style navigation over caller-owned snapshots.
 * Entries are stored and returned by reference; callers supply independent
 * snapshots when preserving mutable view state.
 */
export class NavigationHistory<T> {
  private entries: T[] = [];
  private index = -1;

  get current(): T | undefined {
    return this.entries[this.index];
  }

  get canGoBack(): boolean {
    return this.index > 0;
  }

  get canGoForward(): boolean {
    return this.index >= 0 && this.index < this.entries.length - 1;
  }

  reset(entry: T): void {
    this.entries = [entry];
    this.index = 0;
  }

  /** Update the current snapshot without discarding the forward branch. */
  replaceCurrent(entry: T): void {
    if (this.index < 0) {
      this.reset(entry);
      return;
    }
    this.entries[this.index] = entry;
  }

  /** Navigate to a new entry, replacing any branch ahead of the current one. */
  push(entry: T): void {
    this.entries.splice(this.index + 1);
    this.entries.push(entry);
    this.index = this.entries.length - 1;
  }

  /**
   * Remove invalid snapshots while preserving the current entry when possible.
   * If it is removed, prefer the nearest retained predecessor, then successor.
   */
  retain(predicate: (entry: T) => boolean): void {
    const retained: T[] = [];
    let current = -1;
    for (const [index, entry] of this.entries.entries()) {
      if (!predicate(entry)) continue;
      if (index <= this.index) current = retained.length;
      retained.push(entry);
    }
    this.entries = retained;
    this.index = retained.length === 0 ? -1 : Math.max(0, current);
  }

  back(): T | undefined {
    if (!this.canGoBack) return undefined;
    this.index -= 1;
    return this.entries[this.index];
  }

  forward(): T | undefined {
    if (!this.canGoForward) return undefined;
    this.index += 1;
    return this.entries[this.index];
  }
}
