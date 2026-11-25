/**
 * Replaces every value in `sources` with `target`, keeping the position of the
 * first replaced (or already present) occurrence and dropping duplicates of
 * `target`. Matching is exact, so values that differ only in case can be
 * merged into a single spelling.
 */
export function mergeValues(values: string[], sources: ReadonlySet<string>, target: string): string[] {
    const merged: string[] = [];
    let targetPlaced = false;
    for (const value of values) {
        if (value === target || sources.has(value)) {
            if (!targetPlaced) {
                merged.push(target);
                targetPlaced = true;
            }
        } else {
            merged.push(value);
        }
    }
    return merged;
}

export function needsMerge(values: string[], sources: ReadonlySet<string>, target: string): boolean {
    return values.some(value => value !== target && sources.has(value));
}
