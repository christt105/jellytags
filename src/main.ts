import { Jellyfin } from '@jellyfin/sdk';
import { getItemsApi } from '@jellyfin/sdk/lib/utils/api/items-api';
import { getItemUpdateApi } from '@jellyfin/sdk/lib/utils/api/item-update-api';
import { getSystemApi } from '@jellyfin/sdk/lib/utils/api/system-api';
import { getUserApi } from '@jellyfin/sdk/lib/utils/api/user-api';
import { getUserViewsApi } from '@jellyfin/sdk/lib/utils/api/user-views-api';
import { BaseItemKind, ItemFields } from '@jellyfin/sdk/lib/generated-client/models';

// 1. Initialize SDK
const jellyfin = new Jellyfin({
    clientInfo: { name: 'JellyTags', version: '1.0.0' },
    deviceInfo: { name: 'Browser', id: 'browser-uuid' }
});

const serverUrl = import.meta.env.VITE_JELLYFIN_URL;
const token = import.meta.env.VITE_JELLYFIN_TOKEN;

const api = jellyfin.createApi(serverUrl);
api.accessToken = token;

const itemsApi = getItemsApi(api);
const updateApi = getItemUpdateApi(api);
const systemApi = getSystemApi(api);
const userApi = getUserApi(api);
const userViewsApi = getUserViewsApi(api);

type MediaItem = {
    Id: string;
    Name?: string;
    Type?: string;
    Tags?: string[];
    Genres?: string[];
    DateCreated?: string;
    OfficialRating?: string | null;
    CustomRating?: string | null;
    ImageTags?: { Primary?: string };
    SourceLibraryId?: string;
    SourceLibraryName?: string;
};

type SourceLibrary = {
    id: string;
    name: string;
};

let allItems: MediaItem[] = [];
let filteredItems: MediaItem[] = [];
let sourceLibraries: SourceLibrary[] = [];
let selectedIds = new Set<string>();
let currentUserId = '';
let proposedTags: string[] = [];
let proposedGenres: string[] = [];

// Tag filter: tags in `includeTagFilters` must be present on an item, tags in
// `excludeTagFilters` must be absent. A tag can only be in one set at a time.
let includeTagFilters = new Set<string>();
let excludeTagFilters = new Set<string>();

// Which metadata field the sidebar edits. Tags and genres share the same editor.
type EditField = 'Tags' | 'Genres';
let editTarget: EditField = 'Tags';

function getProposed(): string[] {
    return editTarget === 'Genres' ? proposedGenres : proposedTags;
}

function getItemValues(item: MediaItem): string[] {
    return (editTarget === 'Genres' ? item.Genres : item.Tags) || [];
}

// Lowercase singular noun for the active field, used in placeholders/messages.
function targetNoun(): string {
    return editTarget === 'Genres' ? 'genre' : 'tag';
}

// Escape user-controlled strings before injecting into innerHTML. Media names,
// tags and library names can contain <, >, &, or quotes which otherwise break
// rendering and allow HTML injection.
function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// 2. DOM Elements
const gridEl = document.getElementById('media-grid') as HTMLDivElement;
const loadingEl = document.getElementById('loading-indicator') as HTMLDivElement;
const sidebarEl = document.getElementById('tag-editor-sidebar') as HTMLDivElement;
const sidebarOverlay = document.getElementById('sidebar-overlay') as HTMLDivElement;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const refreshBtn = document.getElementById('refresh-btn') as HTMLButtonElement;
const selectAllBtn = document.getElementById('select-all-btn') as HTMLButtonElement;
const sortSelect = document.getElementById('sort-select') as HTMLSelectElement;
const sourceLibrarySelect = document.getElementById('source-library-select') as HTMLSelectElement;
const parentalRatingSelect = document.getElementById('parental-rating-select') as HTMLSelectElement;
const sidebarToggle = document.getElementById('sidebar-toggle') as HTMLButtonElement;
const sidebarClose = document.getElementById('sidebar-close') as HTMLButtonElement;
const tagFilterToggle = document.getElementById('tag-filter-toggle') as HTMLButtonElement;
const tagFilterPanel = document.getElementById('tag-filter-panel') as HTMLDivElement;
const tagFilterList = document.getElementById('tag-filter-list') as HTMLDivElement;
const tagFilterCount = document.getElementById('tag-filter-count') as HTMLSpanElement;
const tagFilterClear = document.getElementById('tag-filter-clear') as HTMLButtonElement;

function openSidebar() {
    sidebarEl.classList.add('open');
    sidebarOverlay.classList.add('visible');
    document.body.style.overflow = 'hidden';
}

function closeSidebar() {
    sidebarEl.classList.remove('open');
    sidebarOverlay.classList.remove('visible');
    document.body.style.overflow = '';
}

sidebarToggle?.addEventListener('click', openSidebar);
sidebarClose?.addEventListener('click', closeSidebar);
sidebarOverlay?.addEventListener('click', closeSidebar);

// On narrow screens the filter and sort controls are collapsed by default to
// free up vertical space; this button reveals them.
const filtersToggle = document.getElementById('filters-toggle');
const headerActions = document.querySelector('.header-actions');
filtersToggle?.addEventListener('click', () => {
    headerActions?.classList.toggle('show');
    filtersToggle.classList.toggle('active');
});

function openTagFilterPanel() {
    tagFilterPanel.classList.add('open');
    tagFilterToggle.classList.add('active');
}

function closeTagFilterPanel() {
    tagFilterPanel.classList.remove('open');
    tagFilterToggle.classList.remove('active');
}

tagFilterToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (tagFilterPanel.classList.contains('open')) {
        closeTagFilterPanel();
    } else {
        openTagFilterPanel();
    }
});

tagFilterPanel.addEventListener('click', (e) => e.stopPropagation());

document.addEventListener('click', () => closeTagFilterPanel());

tagFilterClear.addEventListener('click', () => {
    includeTagFilters.clear();
    excludeTagFilters.clear();
    renderTagFilterPanel();
    filterAndRender();
});

// Every known tag across the whole library, independent of the current
// filters, so a tag stays choosable even while it's actively excluded.
function getAllKnownTags(): string[] {
    const tags = new Set<string>();
    allItems.forEach(item => (item.Tags || []).forEach(t => tags.add(t)));
    return Array.from(tags).sort((a, b) => a.localeCompare(b));
}

// Cycles a tag through: unfiltered -> must have -> must not have -> unfiltered.
function cycleTagFilter(tag: string) {
    if (includeTagFilters.has(tag)) {
        includeTagFilters.delete(tag);
        excludeTagFilters.add(tag);
    } else if (excludeTagFilters.has(tag)) {
        excludeTagFilters.delete(tag);
    } else {
        includeTagFilters.add(tag);
    }
    renderTagFilterPanel();
    filterAndRender();
}

function renderTagFilterPanel() {
    const knownTags = getAllKnownTags();
    const activeCount = includeTagFilters.size + excludeTagFilters.size;

    tagFilterCount.textContent = String(activeCount);
    tagFilterCount.classList.toggle('visible', activeCount > 0);
    tagFilterToggle.classList.toggle('active', activeCount > 0);

    if (knownTags.length === 0) {
        tagFilterList.innerHTML = `<span class="tag-filter-empty-msg">No tags in your library yet.</span>`;
        return;
    }

    tagFilterList.innerHTML = knownTags.map(tag => {
        const state = includeTagFilters.has(tag) ? 'include' : excludeTagFilters.has(tag) ? 'exclude' : '';
        const prefix = state === 'include' ? '✓ ' : state === 'exclude' ? '✗ ' : '';
        return `<span data-tag-filter="${escapeHtml(tag)}" class="tag-filter-chip ${state}">${prefix}${escapeHtml(tag)}</span>`;
    }).join('');

    tagFilterList.querySelectorAll('[data-tag-filter]').forEach(el => {
        el.addEventListener('click', (e) => {
            const tag = (e.currentTarget as HTMLElement).getAttribute('data-tag-filter')!;
            cycleTagFilter(tag);
        });
    });
}

// 3. Core Logic
async function init() {
    try {
        await systemApi.getPublicSystemInfo();

        const usersRes = await userApi.getUsers();
        if (!usersRes.data || usersRes.data.length === 0) {
            throw new Error("No users found. Ensure your API Token has admin permissions.");
        }

        // Prefer an administrator account. The first user returned by the API may
        // be a restricted account whose limited library access would hide most items.
        const adminUser = usersRes.data.find(u => u.Policy?.IsAdministrator);
        currentUserId = (adminUser || usersRes.data[0]).Id as string;

        await fetchItems();
    } catch (e) {
        loadingEl.innerHTML = `<h3 class="error-message">Connection Failed. Check your .env file and ensure the Jellyfin server is running.</h3>`;
    }
}

async function fetchItems() {
    loadingEl.style.display = 'flex';
    gridEl.style.display = 'none';

    try {
        const viewsRes = await userViewsApi.getUserViews({ userId: currentUserId });
        const views = (viewsRes.data.Items || []).filter(v => v.Id && v.Name);

        sourceLibraries = views.map(v => ({
            id: v.Id as string,
            name: v.Name as string
        }));
        renderSourceLibraryOptions();

        const allItemsById = new Map<string, MediaItem>();

        if (sourceLibraries.length === 0) {
            const fallbackRes = await itemsApi.getItems({
                userId: currentUserId,
                recursive: true,
                includeItemTypes: [BaseItemKind.Movie, BaseItemKind.Series] as BaseItemKind[],
                fields: [ItemFields.Tags, ItemFields.Genres, ItemFields.DateCreated] as ItemFields[]
            });

            (fallbackRes.data.Items || []).forEach(item => {
                if (!item.Id) return;
                allItemsById.set(item.Id, item as MediaItem);
            });
        } else {
            const libraryItemResults = await Promise.all(sourceLibraries.map(async (library) => {
                const res = await itemsApi.getItems({
                    userId: currentUserId,
                    parentId: library.id,
                    recursive: true,
                    includeItemTypes: [BaseItemKind.Movie, BaseItemKind.Series] as BaseItemKind[],
                    fields: [ItemFields.Tags, ItemFields.Genres, ItemFields.DateCreated] as ItemFields[]
                });

                return (res.data.Items || []).map(item => ({
                    ...(item as MediaItem),
                    SourceLibraryId: library.id,
                    SourceLibraryName: library.name
                }));
            }));

            libraryItemResults.flat().forEach(item => {
                if (!item.Id) return;
                if (!allItemsById.has(item.Id)) {
                    allItemsById.set(item.Id, item);
                }
            });
        }

        allItems = Array.from(allItemsById.values());
        renderParentalRatingFilterOptions();
        renderTagFilterPanel();

        filterAndRender();
    } catch (err) {
        console.error(err);
        loadingEl.innerHTML = `<h3 class="error-message">Error fetching items. Check console.</h3>`;
    }
}

function renderSourceLibraryOptions() {
    const previousValue = sourceLibrarySelect.value;

    sourceLibrarySelect.innerHTML = `
        <option value="all">All Libraries</option>
        ${sourceLibraries.map(library => `<option value="${escapeHtml(library.id)}">${escapeHtml(library.name)}</option>`).join('')}
    `;

    const canRestoreSelection = sourceLibraries.some(library => library.id === previousValue);
    sourceLibrarySelect.value = canRestoreSelection ? previousValue : 'all';
}

function renderParentalRatingFilterOptions() {
    const previousParentalValue = parentalRatingSelect.value;

    const parentalRatings = Array.from(new Set(
        allItems
            .map(item => item.OfficialRating?.trim())
            .filter((rating): rating is string => Boolean(rating))
    )).sort((a, b) => a.localeCompare(b));

    parentalRatingSelect.innerHTML = `
        <option value="all">All Parental Ratings</option>
        ${parentalRatings.map(rating => `<option value="${escapeHtml(rating)}">${escapeHtml(rating)}</option>`).join('')}
    `;

    parentalRatingSelect.value = parentalRatings.includes(previousParentalValue) ? previousParentalValue : 'all';
}

function renderGrid(itemsToRender: MediaItem[]) {
    gridEl.innerHTML = '';

    if (itemsToRender.length === 0) {
        loadingEl.style.display = 'flex';
        loadingEl.innerHTML = `<h3>No items found.</h3>`;
        return;
    }

    loadingEl.style.display = 'none';
    gridEl.style.display = 'grid';

    const fragment = document.createDocumentFragment();

    itemsToRender.forEach(item => {
        const isSelected = selectedIds.has(item.Id);

        const card = document.createElement('div');
        card.className = isSelected ? 'glass-panel media-card selected' : 'glass-panel media-card';

        card.onclick = () => toggleSelection(item.Id);

        let imgHtml = `<div class="media-no-image">No Image</div>`;
        if (item.ImageTags && item.ImageTags.Primary) {
            const imageUrl = `${serverUrl}/Items/${item.Id}/Images/Primary?tag=${item.ImageTags.Primary}&maxWidth=400`;
            imgHtml = `<img src="${imageUrl}" class="media-image" loading="lazy" />`;
        }

        const tagsHtml = (item.Tags || []).map((t: string) =>
            `<span class="media-tag">${escapeHtml(t)}</span>`
        ).join('');

        const checkHtml = isSelected ? `<div class="media-card-check">✓</div>` : '';

        card.innerHTML = `
            ${checkHtml}
            <div class="media-card-image-wrapper">
                ${imgHtml}
            </div>
            <div class="media-card-info">
                <div class="media-card-title">${escapeHtml(item.Name)}</div>
                <div class="media-card-type">${escapeHtml(item.Type)}${item.SourceLibraryName ? ` • ${escapeHtml(item.SourceLibraryName)}` : ''}</div>
                <div class="media-card-tags">
                    ${tagsHtml}
                </div>
            </div>
        `;

        fragment.appendChild(card);
    });

    gridEl.appendChild(fragment);
    updateSidebar();
}

function toggleSelection(id: string) {
    if (selectedIds.has(id)) {
        selectedIds.delete(id);
    } else {
        selectedIds.add(id);
    }
    filterAndRender();
}

function clearSelection() {
    selectedIds.clear();
    filterAndRender();
}

function selectAllFiltered() {
    filteredItems.forEach(item => selectedIds.add(item.Id));
    filterAndRender();
}

function filterAndRender() {
    const q = searchInput.value.toLowerCase();
    const selectedLibraryId = sourceLibrarySelect.value;
    const selectedParentalRating = parentalRatingSelect.value;

    let filtered = allItems.filter(i => {
        const itemTags = i.Tags || [];
        return (selectedLibraryId === 'all' || i.SourceLibraryId === selectedLibraryId) &&
            (selectedParentalRating === 'all' || (i.OfficialRating || '').trim() === selectedParentalRating) &&
            (
                (i.Name || '').toLowerCase().includes(q) ||
                itemTags.some((t: string) => t.toLowerCase().includes(q))
            ) &&
            Array.from(includeTagFilters).every(t => itemTags.includes(t)) &&
            Array.from(excludeTagFilters).every(t => !itemTags.includes(t));
    });

    const sortVal = sortSelect.value;
    filtered.sort((a, b) => {
        if (sortVal === 'name-asc') {
            return (a.Name || '').localeCompare(b.Name || '');
        } else if (sortVal === 'name-desc') {
            return (b.Name || '').localeCompare(a.Name || '');
        } else if (sortVal === 'date-desc') {
            const dA = new Date(a.DateCreated || 0).getTime();
            const dB = new Date(b.DateCreated || 0).getTime();
            return dB - dA;
        } else if (sortVal === 'date-asc') {
            const dA = new Date(a.DateCreated || 0).getTime();
            const dB = new Date(b.DateCreated || 0).getTime();
            return dA - dB;
        }
        return 0;
    });

    filteredItems = filtered;
    renderGrid(filteredItems);
}

// 4. Sidebar Logic
function updateSidebar() {
    if (selectedIds.size === 0) {
        sidebarEl.innerHTML = `
            <div class="sidebar-header">
                <h3 class="sidebar-title">Tag Editor</h3>
                <button id="sidebar-close" class="sidebar-close-btn mobile-only">&times;</button>
            </div>
            <p class="sidebar-empty-msg">Select items from the grid to edit their tags and genres.</p>
        `;
        const closeBtn = document.getElementById('sidebar-close');
        closeBtn?.addEventListener('click', closeSidebar);
        closeSidebar();
        return;
    }

    // Count the values already present on the selection for the active field.
    const selectedItems = allItems.filter(i => selectedIds.has(i.Id));

    const valueCounts: Record<string, number> = {};
    selectedItems.forEach(i => {
        getItemValues(i).forEach((v: string) => {
            valueCounts[v] = (valueCounts[v] || 0) + 1;
        });
    });

    renderSidebarEditor(valueCounts);
}

function renderSidebarEditor(valueCounts: Record<string, number>) {
    const selectedItems = allItems.filter(i => selectedIds.has(i.Id));
    const applyButtonLabel = getApplyButtonLabel();
    const proposed = getProposed();

    sidebarEl.innerHTML = `
        <div>
            <div class="sidebar-top-bar">
                <h3 class="sidebar-title" style="margin: 0;">Edit ${editTarget}</h3>
                <div class="sidebar-actions-group">
                    <span class="sidebar-selection-count">
                        ${selectedIds.size} selected
                    </span>
                    <button id="sidebar-close" class="sidebar-close-btn mobile-only">&times;</button>
                </div>
            </div>
            <button id="clear-btn" class="clear-btn">
                Clear Selection
            </button>
        </div>

            <div class="edit-target-toggle">
                <button type="button" class="edit-target-btn ${editTarget === 'Tags' ? 'active' : ''}" data-target="Tags">Tags</button>
                <button type="button" class="edit-target-btn ${editTarget === 'Genres' ? 'active' : ''}" data-target="Genres">Genres</button>
            </div>

            <h4 class="section-subtitle">${editTarget} to Apply</h4>
            <div id="proposed-tags-container" class="proposed-tags-container">
                ${proposed.length === 0 ? `<span class="no-tags-msg">No ${targetNoun()}s</span>` : ''}
                ${proposed.map(t => `
                    <div class="proposed-tag">
                        ${escapeHtml(t)}
                        <span data-remove-tag="${escapeHtml(t)}" class="proposed-tag-remove">&times;</span>
                    </div>
                `).join('')}
            </div>

            <form id="add-tag-form" class="add-tag-form">
                <input id="new-tag-input" type="text" class="glass-input" placeholder="Add new ${targetNoun()}..." autocomplete="off" />
                <button type="submit" class="glass-button add-tag-btn">+</button>
            </form>

            ${Object.keys(valueCounts).length > 0 ? `
                <div class="existing-tags-section">
                    <h4 class="existing-tags-title">Existing ${editTarget} in Selection:</h4>
                    <div class="existing-tags-list">
                        ${Object.entries(valueCounts).map(([t, count]) => {
        const isStaged = proposed.includes(t);
        const hint = isStaged ? 'Staged — click to unstage' : `Present on ${count} item(s) — click to stage`;
        return `
                            <span data-add-tag="${escapeHtml(t)}" title="${hint}" class="existing-tag${isStaged ? ' staged' : ''}">
                                ${escapeHtml(t)} <span class="existing-tag-count">(${count})</span>
                            </span>
                        `;
    }).join('')}
                    </div>
                    <p class="existing-tag-hint">Click a tag to stage it for all selected items, then Apply. Click again to unstage.</p>
                </div>
            ` : ''}
        </div>

        <div style="display: flex; gap: 16px; margin-bottom: 12px; margin-top: 12px; padding: 0 4px;">
            <label style="display: flex; align-items: center; gap: 6px; font-size: 0.85rem; cursor: pointer; color: var(--text-main);">
                <input type="radio" name="apply-mode" value="append" checked style="accent-color: var(--jelly-blue);" /> Append
            </label>
            <label style="display: flex; align-items: center; gap: 6px; font-size: 0.85rem; cursor: pointer; color: var(--text-main);">
                <input type="radio" name="apply-mode" value="replace" style="accent-color: var(--jelly-blue);" /> Replace
            </label>
            <label style="display: flex; align-items: center; gap: 6px; font-size: 0.85rem; cursor: pointer; color: var(--text-main);">
                <input type="radio" name="apply-mode" value="remove" style="accent-color: var(--jelly-blue);" /> Remove
            </label>
        </div>
        <button id="apply-btn" class="glass-button apply-btn">
            ${applyButtonLabel} ${selectedIds.size} Items
        </button>

        <div class="selected-items-section">
            <h4 class="section-subtitle">Selected Items</h4>
            <div id="selected-items-list" class="selected-items-list">
                ${selectedItems.map(item => {
        let thumbHtml = `<div class="selected-item-thumb-placeholder">${item.Type === 'Movie' ? 'M' : 'S'}</div>`;
        if (item.ImageTags && item.ImageTags.Primary) {
            const thumbUrl = `${serverUrl}/Items/${item.Id}/Images/Primary?tag=${item.ImageTags.Primary}&maxWidth=80`;
            thumbHtml = `<img src="${thumbUrl}" class="selected-item-thumb-img" />`;
        }
        return `
                        <div data-deselect="${escapeHtml(item.Id)}" class="selected-item-card">
                            ${thumbHtml}
                            <div class="selected-item-info">
                                <div class="selected-item-name">${escapeHtml(item.Name)}</div>
                                <div class="selected-item-type">${escapeHtml(item.Type)}</div>
                            </div>
                            <span class="selected-item-remove">&times;</span>
                        </div>
                    `;
    }).join('')}
            </div>
    `;

    document.getElementById('clear-btn')?.addEventListener('click', clearSelection);

    document.getElementById('sidebar-close')?.addEventListener('click', closeSidebar);

    document.querySelectorAll('[data-target]').forEach(el => {
        el.addEventListener('click', (e) => {
            const target = (e.currentTarget as HTMLElement).getAttribute('data-target') as EditField;
            if (target !== editTarget) {
                editTarget = target;
                updateSidebar();
            }
        });
    });

    document.getElementById('add-tag-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('new-tag-input') as HTMLInputElement;
        const val = input.value.trim();
        const proposed = getProposed();
        if (val && !proposed.includes(val)) {
            proposed.push(val);
            renderSidebarEditor(valueCounts);
        }
    });

    document.querySelectorAll('input[name="apply-mode"]').forEach(el => {
        el.addEventListener('change', () => {
            const applyBtn = document.getElementById('apply-btn') as HTMLButtonElement | null;
            if (applyBtn) {
                applyBtn.innerText = `${getApplyButtonLabel()} ${selectedIds.size} Items`;
            }
        });
    });

    document.querySelectorAll('[data-remove-tag]').forEach(el => {
        el.addEventListener('click', (e) => {
            const value = (e.currentTarget as HTMLElement).getAttribute('data-remove-tag')!;
            const proposed = getProposed();
            proposed.splice(proposed.indexOf(value), 1);
            renderSidebarEditor(valueCounts);
        });
    });

    document.querySelectorAll('[data-add-tag]').forEach(el => {
        el.addEventListener('click', (e) => {
            const value = (e.currentTarget as HTMLElement).getAttribute('data-add-tag')!;
            const proposed = getProposed();
            const idx = proposed.indexOf(value);
            if (idx === -1) proposed.push(value);
            else proposed.splice(idx, 1);
            renderSidebarEditor(valueCounts);
        });
    });

    document.querySelectorAll('[data-deselect]').forEach(el => {
        el.addEventListener('click', (e) => {
            const id = (e.currentTarget as HTMLElement).getAttribute('data-deselect')!;
            selectedIds.delete(id);
            filterAndRender();
        });
    });

    document.getElementById('apply-btn')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        btn.innerText = 'Saving...';
        btn.disabled = true;
        btn.classList.add('apply-btn-disabled');

        const modeInput = document.querySelector('input[name="apply-mode"]:checked') as HTMLInputElement | null;
        const mode = modeInput ? modeInput.value : 'append';

        try {
            const ids = Array.from(selectedIds);
            let successCount = 0;
            const failedItems: string[] = [];

            for (let index = 0; index < ids.length; index++) {
                const id = ids[index];
                btn.innerText = `Saving ${index + 1}/${ids.length}...`;

                try {
                    const localItem = allItems.find(i => i.Id === id);
                    const itemRes = await itemsApi.getItems({
                        ids: [id],
                        userId: currentUserId,
                        fields: [
                            ItemFields.Tags,
                            ItemFields.Genres,
                            ItemFields.Overview,
                            ItemFields.ProviderIds,
                            ItemFields.Studios,
                            ItemFields.People,
                            ItemFields.Taglines,
                            ItemFields.ProductionLocations,
                            ItemFields.OriginalTitle,
                            ItemFields.SortName,
                            ItemFields.CustomRating,
                            ItemFields.DateCreated,
                            ItemFields.RemoteTrailers,
                            ItemFields.ExternalUrls,
                        ] as ItemFields[]
                    });
                    const serverItem = itemRes.data.Items?.[0];
                    if (!serverItem) {
                        throw new Error(`Item ${id} not found on server.`);
                    }
                    const itemName = serverItem.Name || localItem?.Name || '';

                    if (!itemName) {
                        throw new Error('Cannot update item without a Name field.');
                    }

                    const proposed = getProposed();
                    const currentValues = (editTarget === 'Genres'
                        ? (serverItem.Genres || localItem?.Genres)
                        : (serverItem.Tags || localItem?.Tags)) || [];
                    const updatedValues = mode === 'append'
                        ? Array.from(new Set([...currentValues, ...proposed]))
                        : mode === 'remove'
                            ? currentValues.filter((value: string) => !proposed.includes(value))
                            : [...proposed];

                    // Jellyfin rejects the round-tripped DTO when it carries a
                    // Trickplay map: TrickplayInfoDto fails to deserialize on the
                    // server and the whole update fails. Strip it before sending.
                    const { Trickplay: _trickplay, ...sanitizedItem } = serverItem;

                    await updateApi.updateItem({
                        itemId: id,
                        baseItemDto: {
                            ...sanitizedItem,
                            Id: id,
                            Name: itemName,
                            Tags: editTarget === 'Tags' ? updatedValues : (serverItem.Tags || []),
                            Genres: editTarget === 'Genres' ? updatedValues : (serverItem.Genres || []),
                            ProviderIds: serverItem.ProviderIds || {}
                        }
                    });

                    if (localItem) {
                        if (editTarget === 'Genres') localItem.Genres = [...updatedValues];
                        else localItem.Tags = [...updatedValues];
                    }

                    successCount++;
                } catch (itemError) {
                    const axiosLikeError = itemError as {
                        response?: { status?: number; data?: unknown };
                        message?: string;
                    };
                    console.error(
                        `Failed to update item ${id}`,
                        axiosLikeError?.message || itemError,
                        axiosLikeError?.response?.status,
                        axiosLikeError?.response?.data
                    );
                    const failedItem = allItems.find(i => i.Id === id);
                    failedItems.push(failedItem?.Name || id);
                }
            }

            if (successCount > 0) {
                clearSelection();
            }

            if (failedItems.length === 0) {
                alert(`Successfully updated ${editTarget.toLowerCase()} for ${successCount} items!`);
            } else {
                const preview = failedItems.slice(0, 10).join(', ');
                const remaining = failedItems.length > 10 ? ` (+${failedItems.length - 10} more)` : '';
                alert(
                    `Updated ${successCount}/${ids.length} items. Failed: ${failedItems.length}.\n` +
                    `Failed items: ${preview}${remaining}`
                );
            }
        } finally {
            btn.innerText = `${getApplyButtonLabel()} ${selectedIds.size} Items`;
            btn.disabled = false;
            btn.classList.remove('apply-btn-disabled');
        }
    });
}

function getApplyButtonLabel() {
    const modeInput = document.querySelector('input[name="apply-mode"]:checked') as HTMLInputElement | null;
    const mode = modeInput ? modeInput.value : 'append';

    if (mode === 'replace') {
        return 'Replace on';
    }

    if (mode === 'remove') {
        return 'Remove from';
    }

    return 'Append to';
}

// 5. Setup Listeners
searchInput.addEventListener('input', filterAndRender);
refreshBtn.addEventListener('click', fetchItems);
selectAllBtn.addEventListener('click', selectAllFiltered);
sortSelect.addEventListener('change', filterAndRender);
sourceLibrarySelect.addEventListener('change', filterAndRender);
parentalRatingSelect.addEventListener('change', filterAndRender);

// Boot
init();
