import type { EditField } from './edit-field';
import { escapeHtml } from './html';
import type { ItemFieldUpdater, UpdateOutcome } from './item-update';
import type { MediaItem } from './media-item';
import { mergeValues, needsMerge } from './merge';

export type MergeResult = {
    field: EditField;
    sources: ReadonlySet<string>;
    target: string;
    outcome: UpdateOutcome;
};

export type MergeDialogHost = {
    getItems(): MediaItem[];
    onMerged(result: MergeResult): void;
};

const previewLimit = 50;

function valuesOf(item: MediaItem, field: EditField): string[] {
    return (field === 'Genres' ? item.Genres : item.Tags) || [];
}

function quoted(value: string): string {
    return `"${value}"`;
}

/**
 * Modal that folds several tags (or genres) into one across the whole library.
 * Renaming is the single-source case. The target may be an existing value or
 * a new one.
 */
export class MergeDialog {
    private field: EditField = 'Tags';
    private sources = new Set<string>();
    private running = false;
    private stopRequested = false;

    private readonly fieldButtons: HTMLButtonElement[];
    private readonly sourcesTitle: HTMLElement;
    private readonly sourceSearch: HTMLInputElement;
    private readonly sourceList: HTMLElement;
    private readonly targetInput: HTMLInputElement;
    private readonly targetOptions: HTMLDataListElement;
    private readonly targetHint: HTMLElement;
    private readonly preview: HTMLElement;
    private readonly status: HTMLElement;
    private readonly cancelButton: HTMLButtonElement;
    private readonly confirmButton: HTMLButtonElement;

    constructor(
        private readonly dialog: HTMLDialogElement,
        private readonly updater: ItemFieldUpdater,
        private readonly host: MergeDialogHost,
    ) {
        this.fieldButtons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('[data-merge-field]'));
        this.sourcesTitle = this.part('#merge-sources-title');
        this.sourceSearch = this.part('#merge-source-search');
        this.sourceList = this.part('#merge-source-list');
        this.targetInput = this.part('#merge-target-input');
        this.targetOptions = this.part('#merge-target-options');
        this.targetHint = this.part('#merge-target-hint');
        this.preview = this.part('#merge-preview');
        this.status = this.part('#merge-status');
        this.cancelButton = this.part('#merge-cancel-btn');
        this.confirmButton = this.part('#merge-confirm-btn');

        this.fieldButtons.forEach(button => button.addEventListener('click', () => {
            this.setField(button.getAttribute('data-merge-field') as EditField);
        }));
        this.sourceSearch.addEventListener('input', () => this.renderSources());
        this.sourceList.addEventListener('click', (e) => {
            const chip = (e.target as HTMLElement).closest('[data-merge-source]');
            if (!chip || this.running) return;
            this.toggleSource(chip.getAttribute('data-merge-source')!);
        });
        this.targetInput.addEventListener('input', () => this.render());
        this.part<HTMLButtonElement>('#merge-dialog-close').addEventListener('click', () => this.close());
        this.cancelButton.addEventListener('click', () => {
            if (this.running) this.stopRequested = true;
            else this.close();
        });
        this.confirmButton.addEventListener('click', () => this.run());
        dialog.addEventListener('cancel', (e) => {
            if (this.running) e.preventDefault();
        });
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) this.close();
        });
    }

    open(field: EditField = 'Tags') {
        this.field = field;
        this.reset();
        this.status.textContent = '';
        this.render();
        this.dialog.showModal();
        this.sourceSearch.focus();
    }

    close() {
        if (this.running) return;
        this.dialog.close();
    }

    private part<T extends HTMLElement>(selector: string): T {
        const element = this.dialog.querySelector<T>(selector);
        if (!element) throw new Error(`Merge dialog is missing ${selector}`);
        return element;
    }

    private noun(): string {
        return this.field === 'Genres' ? 'genre' : 'tag';
    }

    private reset() {
        this.sources.clear();
        this.sourceSearch.value = '';
        this.targetInput.value = '';
    }

    private pruneMissingSources() {
        const counts = this.valueCounts();
        this.sources = new Set(Array.from(this.sources).filter(value => counts.has(value)));
    }

    private setField(field: EditField) {
        if (this.running || field === this.field) return;
        this.field = field;
        this.reset();
        this.status.textContent = '';
        this.render();
    }

    private toggleSource(value: string) {
        if (this.sources.has(value)) this.sources.delete(value);
        else this.sources.add(value);
        this.status.textContent = '';
        this.render();
    }

    private target(): string {
        return this.targetInput.value.trim();
    }

    private effectiveSources(): Set<string> {
        const target = this.target();
        return new Set(Array.from(this.sources).filter(value => value !== target));
    }

    private valueCounts(): Map<string, number> {
        const counts = new Map<string, number>();
        this.host.getItems().forEach(item => valuesOf(item, this.field).forEach(value => {
            counts.set(value, (counts.get(value) || 0) + 1);
        }));
        return counts;
    }

    private affectedItems(): MediaItem[] {
        const target = this.target();
        const sources = this.effectiveSources();
        if (!target || sources.size === 0) return [];
        return this.host.getItems().filter(item => needsMerge(valuesOf(item, this.field), sources, target));
    }

    private render() {
        const noun = this.noun();
        this.fieldButtons.forEach(button => {
            const active = button.getAttribute('data-merge-field') === this.field;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
            button.disabled = this.running;
        });
        this.sourcesTitle.textContent = `${this.field} to merge`;
        this.sourceSearch.placeholder = `Search ${noun}s...`;
        this.sourceSearch.setAttribute('aria-label', `Search ${noun}s`);
        this.sourceSearch.disabled = this.running;
        this.targetInput.placeholder = `New or existing ${noun}`;
        this.targetInput.disabled = this.running;

        this.renderSources();
        this.renderTarget();
        this.renderPreview();
    }

    private renderSources() {
        const counts = this.valueCounts();
        const values = Array.from(counts.keys()).sort((a, b) => a.localeCompare(b));
        const searchText = this.sourceSearch.value.trim().toLowerCase();

        this.targetOptions.innerHTML = values.map(value => `<option value="${escapeHtml(value)}"></option>`).join('');

        if (values.length === 0) {
            this.sourceList.innerHTML = `<span class="tag-filter-empty-msg">No ${this.noun()}s in your library yet.</span>`;
            return;
        }

        const pinned = values.filter(value => this.sources.has(value));
        const matching = values.filter(value => !this.sources.has(value) && (!searchText || value.toLowerCase().includes(searchText)));
        const visible = [...pinned, ...matching];

        if (visible.length === 0) {
            this.sourceList.innerHTML = `<span class="tag-filter-empty-msg">No ${this.noun()}s match your search.</span>`;
            return;
        }

        this.sourceList.innerHTML = visible.map(value => {
            const selected = this.sources.has(value);
            return `<button type="button" data-merge-source="${escapeHtml(value)}" class="tag-filter-chip merge-source-chip${selected ? ' selected' : ''}" aria-pressed="${selected}"${this.running ? ' disabled' : ''}>${selected ? '✓ ' : ''}${escapeHtml(value)} <span class="existing-tag-count">(${counts.get(value)})</span></button>`;
        }).join('');
    }

    private renderTarget() {
        const noun = this.noun();
        const target = this.target();
        const counts = this.valueCounts();

        if (!target) {
            this.targetHint.textContent = `Type a new name or pick an existing ${noun}.`;
            return;
        }

        const existing = counts.get(target);
        if (existing !== undefined) {
            this.targetHint.textContent = `${quoted(target)} already exists on ${existing} item${existing === 1 ? '' : 's'}. The selected ${noun}s will be folded into it.`;
            return;
        }

        const lowerTarget = target.toLowerCase();
        const sameSpelling = Array.from(counts.keys()).filter(value => value.toLowerCase() === lowerTarget);
        this.targetHint.textContent = sameSpelling.length > 0
            ? `${quoted(target)} is new, but differs only in case from ${sameSpelling.map(quoted).join(', ')}. Select ${sameSpelling.length === 1 ? 'it' : 'them'} above to end up with a single spelling.`
            : `${quoted(target)} is a new ${noun}.`;
    }

    private renderPreview() {
        const noun = this.noun();
        const target = this.target();
        const sources = this.effectiveSources();
        const affected = this.affectedItems();

        let blocker = '';
        if (this.sources.size === 0) blocker = `Select the ${noun}s you want to merge.`;
        else if (!target) blocker = `Choose the ${noun} to merge them into.`;
        else if (sources.size === 0) blocker = `Select at least one ${noun} other than ${quoted(target)}.`;

        if (!this.running) {
            this.confirmButton.disabled = blocker !== '' || affected.length === 0;
            this.confirmButton.textContent = this.confirmLabel(sources, target, affected.length);
            this.cancelButton.textContent = 'Close';
        }

        if (blocker) {
            this.preview.innerHTML = `<p class="merge-hint">${escapeHtml(blocker)}</p>`;
            return;
        }

        const shown = affected.slice(0, previewLimit);
        const remaining = affected.length - shown.length;
        this.preview.innerHTML = `
            <p class="merge-preview-count">${affected.length} item${affected.length === 1 ? '' : 's'} will change.</p>
            ${affected.length > 0 ? `
                <details class="merge-preview-details">
                    <summary>Show affected items</summary>
                    <ul class="merge-preview-list">
                        ${shown.map(item => `<li>${escapeHtml(item.Name)}</li>`).join('')}
                        ${remaining > 0 ? `<li class="merge-hint">+${remaining} more</li>` : ''}
                    </ul>
                </details>
                <p class="merge-hint">Each item is saved back to Jellyfin one at a time, and JellyTags can't undo it. ${this.field} added by metadata providers or NFO files can come back on the next metadata refresh unless the item's ${noun}s are locked in Jellyfin.</p>
            ` : ''}
        `;
    }

    private confirmLabel(sources: Set<string>, target: string, affectedCount: number): string {
        if (!target || sources.size === 0) return 'Merge';
        const items = `(${affectedCount} item${affectedCount === 1 ? '' : 's'})`;
        if (sources.size === 1) {
            return `Rename ${quoted(Array.from(sources)[0])} to ${quoted(target)} ${items}`;
        }
        return `Merge ${sources.size} ${this.noun()}s into ${quoted(target)} ${items}`;
    }

    private async run() {
        const field = this.field;
        const target = this.target();
        const sources = this.effectiveSources();
        const affected = this.affectedItems();
        if (this.running || !target || sources.size === 0 || affected.length === 0) return;

        this.running = true;
        this.stopRequested = false;
        this.render();
        this.confirmButton.disabled = true;
        this.cancelButton.textContent = 'Stop';
        this.status.textContent = '';

        let outcome: UpdateOutcome;
        try {
            outcome = await this.updater.updateItems(
                affected.map(item => item.Id),
                field,
                values => mergeValues(values, sources, target),
                {
                    onProgress: ({ index, total }) => {
                        this.confirmButton.textContent = `Saving ${index + 1}/${total}...`;
                    },
                    shouldStop: () => this.stopRequested
                }
            );
        } finally {
            this.running = false;
        }

        this.host.onMerged({ field, sources, target, outcome });
        if (outcome.failedIds.length === 0 && outcome.skippedIds.length === 0) {
            this.reset();
        } else {
            this.pruneMissingSources();
        }
        this.render();
        this.status.textContent = this.summary(outcome, target, affected);
    }

    private summary(outcome: UpdateOutcome, target: string, affected: MediaItem[]): string {
        const done = outcome.updated.size + outcome.unchangedIds.length;
        const nameOf = (id: string) => affected.find(item => item.Id === id)?.Name || id;
        const parts = [`Merged into ${quoted(target)} on ${done} of ${affected.length} items.`];
        if (outcome.failedIds.length > 0) {
            const names = outcome.failedIds.slice(0, 10).map(nameOf).join(', ');
            const more = outcome.failedIds.length > 10 ? ` (+${outcome.failedIds.length - 10} more)` : '';
            parts.push(`${outcome.failedIds.length} failed: ${names}${more}.`);
        }
        if (outcome.skippedIds.length > 0) {
            parts.push(`Stopped before ${outcome.skippedIds.length} item${outcome.skippedIds.length === 1 ? '' : 's'}.`);
        }
        if (outcome.failedIds.length > 0 || outcome.skippedIds.length > 0) {
            parts.push('The selection is kept, so you can run the merge again to finish the rest.');
        }
        return parts.join(' ');
    }
}
