import { Jellyfin } from '@jellyfin/sdk';
import { getItemsApi } from '@jellyfin/sdk/lib/utils/api/items-api';
import { getItemUpdateApi } from '@jellyfin/sdk/lib/utils/api/item-update-api';
import { getSystemApi } from '@jellyfin/sdk/lib/utils/api/system-api';
import { getUserApi } from '@jellyfin/sdk/lib/utils/api/user-api';
import { getUserViewsApi } from '@jellyfin/sdk/lib/utils/api/user-views-api';
import { BaseItemKind, ItemFields, UserPolicy } from '@jellyfin/sdk/lib/generated-client/models';

// 1. Initialize SDK
const jellyfin = new Jellyfin({
    clientInfo: { name: 'JellyTags', version: '1.0.0' },
    deviceInfo: { name: 'Browser', id: 'browser-uuid' }
});

// Same-origin path; a reverse proxy (nginx in prod, Vite in dev) forwards
// this to the real Jellyfin server and injects the admin token, so the
// client bundle never contains it.
const apiBase = '/jellyfin';

// With no accessToken, the SDK still sends `Authorization: ... Token=""`
// on every request; the proxy overwrites that Authorization header outright
// with one carrying the real token, so this empty one never reaches Jellyfin.
const api = jellyfin.createApi(apiBase);

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
let managedUsers: Array<{ Id: string; Name?: string; Policy?: UserPolicy | null }> = [];
let currentAppView: 'media' | 'users' = 'media';
let selectedManagedUserIds = new Set<string>();

let bulkAddedAllowedTags = new Set<string>();
let bulkRemovedAllowedTags = new Set<string>();
let bulkAddedBlockedTags = new Set<string>();
let bulkRemovedBlockedTags = new Set<string>();
let proposedAllowedTags: string[] = [];
let proposedBlockedTags: string[] = [];
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
const tagFilterSearch = document.getElementById('tag-filter-search') as HTMLInputElement;
const tagFilterSearchStatus = document.getElementById('tag-filter-search-status') as HTMLSpanElement;
const mediaViewBtn = document.getElementById('media-view-btn') as HTMLButtonElement;
const usersViewBtn = document.getElementById('users-view-btn') as HTMLButtonElement;
const userManagementView = document.getElementById('user-management-view') as HTMLDivElement;

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
    tagFilterSearch.focus();
}

function closeTagFilterPanel() {
    tagFilterPanel.classList.remove('open');
    tagFilterToggle.classList.remove('active');
    if (tagFilterSearch.value) {
        tagFilterSearch.value = '';
        renderTagFilterPanel();
    }
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
    tagFilterSearch.value = '';
    renderTagFilterPanel();
    filterAndRender();
});

tagFilterSearch.addEventListener('input', () => renderTagFilterPanel());

tagFilterList.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest('[data-tag-filter]');
    if (!chip) return;
    cycleTagFilter(chip.getAttribute('data-tag-filter')!);
});

// Every known tag across the whole library, independent of the current
// filters, so a tag stays choosable even while it's actively excluded.
let knownTagsCache: string[] = [];
let knownTagsCacheSource: MediaItem[] | null = null;

function getAllKnownTags(): string[] {
    if (knownTagsCacheSource === allItems) {
        return knownTagsCache;
    }
    const tags = new Set<string>();
    allItems.forEach(item => (item.Tags || []).forEach(t => tags.add(t)));
    knownTagsCache = Array.from(tags).sort((a, b) => a.localeCompare(b));
    knownTagsCacheSource = allItems;
    return knownTagsCache;
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
        tagFilterSearchStatus.textContent = '';
        return;
    }

    const isActive = (tag: string) => includeTagFilters.has(tag) || excludeTagFilters.has(tag);
    const searchText = tagFilterSearch.value.trim().toLowerCase();

    // Pinned tags come first so an active include/exclude filter stays visible
    // even when it doesn't match the current search text.
    const pinnedTags = knownTags.filter(isActive);
    const matchingTags = knownTags.filter(tag => !isActive(tag) && (!searchText || tag.toLowerCase().includes(searchText)));
    const visibleTags = [...pinnedTags, ...matchingTags];

    if (visibleTags.length === 0) {
        tagFilterList.innerHTML = `<span class="tag-filter-empty-msg">No tags match your search.</span>`;
        tagFilterSearchStatus.textContent = 'No tags match your search.';
        return;
    }

    tagFilterSearchStatus.textContent = searchText && matchingTags.length === 0
        ? 'No other tags match your search.'
        : '';

    tagFilterList.innerHTML = visibleTags.map(tag => {
        const state = includeTagFilters.has(tag) ? 'include' : excludeTagFilters.has(tag) ? 'exclude' : '';
        const prefix = state === 'include' ? '✓ ' : state === 'exclude' ? '✗ ' : '';
        return `<span data-tag-filter="${escapeHtml(tag)}" class="tag-filter-chip ${state}">${prefix}${escapeHtml(tag)}</span>`;
    }).join('');
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
        managedUsers = usersRes.data
            .filter(u => u.Id)
            .map(u => ({ Id: u.Id as string, Name: u.Name, Policy: u.Policy }));
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
            const imageUrl = `${apiBase}/Items/${item.Id}/Images/Primary?tag=${item.ImageTags.Primary}&maxWidth=400`;
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
            const thumbUrl = `${apiBase}/Items/${item.Id}/Images/Primary?tag=${item.ImageTags.Primary}&maxWidth=80`;
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


// 5. User Tag Management
function getManagedUsers() {
    return managedUsers.filter(u => selectedManagedUserIds.has(u.Id));
}

function getManagedUser() {
    return getManagedUsers()[0];
}

function getKnownUserTags(): string[] {
    const tags = new Set<string>();

    allItems.forEach(item => {
        (item.Tags || []).forEach(tag => tags.add(tag));
    });

    getManagedUsers().forEach(user => {
        (user.Policy?.AllowedTags || []).forEach(tag => tags.add(tag));
        (user.Policy?.BlockedTags || []).forEach(tag => tags.add(tag));
    });

    return Array.from(tags).sort((a, b) => a.localeCompare(b));
}

function resetUserTagDraft() {
    bulkAddedAllowedTags.clear();
    bulkRemovedAllowedTags.clear();
    bulkAddedBlockedTags.clear();
    bulkRemovedBlockedTags.clear();

    const allowed = new Set<string>();
    const blocked = new Set<string>();

    getManagedUsers().forEach(user => {
        (user.Policy?.AllowedTags || []).forEach(tag => allowed.add(tag));
        (user.Policy?.BlockedTags || []).forEach(tag => blocked.add(tag));
    });

    proposedAllowedTags = Array.from(allowed).sort((a, b) => a.localeCompare(b));
    proposedBlockedTags = Array.from(blocked).sort((a, b) => a.localeCompare(b));
}

function renderUserTagChips(list: string[], dataAttr: string, emptyText: string) {
    if (list.length === 0) {
        return `<span class="user-tags-empty">${escapeHtml(emptyText)}</span>`;
    }

    return list.map(tag => `
        <button
            type="button"
            class="user-tag-chip"
            data-user-tag-action="${dataAttr}"
            data-user-tag="${escapeHtml(tag)}"
        >
            ${escapeHtml(tag)} <span aria-hidden="true">&times;</span>
        </button>
    `).join('');
}

function renderUserTagManager() {
    if (currentAppView !== 'users') return;

    if (managedUsers.length === 0) {
        userManagementView.innerHTML =
            '<div class="user-management-empty">No Jellyfin users found.</div>';
        return;
    }

    const knownTags = getKnownUserTags();

    const usedTags = new Set([
        ...proposedAllowedTags,
        ...proposedBlockedTags
    ]);

    const availableTags = knownTags.filter(tag => !usedTags.has(tag));

    const allSelected =
        managedUsers.length > 0 &&
        managedUsers.every(user => selectedManagedUserIds.has(user.Id));

    userManagementView.innerHTML = `
        <div class="user-management-header glass-panel">
            <div class="user-management-title">
                <h2>User Tag Access</h2>
                <p>Manage Jellyfin's allow and block tag lists for the selected users. Existing tags are preserved.</p>
            </div>
        </div>

        <section class="glass-panel user-tag-panel managed-user-selector">
            <div class="user-tag-panel-header">
                <div>
                    <h3>Users</h3>
                    <p>
                        ${selectedManagedUserIds.size} selected
                    </p>
                </div>

                <button
                    id="managed-user-select-all"
                    type="button"
                    class="glass-button"
                >
                    ${allSelected ? 'Deselect All' : 'Select All'}
                </button>
            </div>

            <div class="managed-user-list">
                ${managedUsers.map(user => `
                    <label class="managed-user-option">
                        <input
                            type="checkbox"
                            class="managed-user-checkbox"
                            data-managed-user-id="${escapeHtml(user.Id)}"
                            ${selectedManagedUserIds.has(user.Id) ? 'checked' : ''}
                        />

                        <span
                            class="managed-user-checkbox-box"
                            aria-hidden="true"
                        ></span>

                        <span class="managed-user-name">
                            ${escapeHtml(user.Name || user.Id)}
                        </span>

                        ${
                            user.Policy?.IsAdministrator
                                ? '<span class="managed-user-admin">Admin</span>'
                                : ''
                        }
                    </label>
                `).join('')}
            </div>
        </section>

        <div class="user-tag-panels">
            <section class="glass-panel user-tag-panel">
                <div class="user-tag-panel-header">
                    <div>
                        <h3>Allow items with tags</h3>
                        <p>Only items matching these tags are allowed when Jellyfin evaluates this list.</p>
                    </div>

                    <span class="user-tag-count">
                        ${proposedAllowedTags.length}
                    </span>
                </div>

                <div class="user-tag-chip-list">
                    ${renderUserTagChips(
                        proposedAllowedTags,
                        'allowed',
                        'No allowed tags'
                    )}
                </div>

                <form id="add-allowed-tag-form" class="user-tag-add-form">
                    <input
                        id="new-allowed-tag-input"
                        class="glass-input"
                        list="user-tag-options"
                        placeholder="Add allowed tag..."
                        autocomplete="off"
                    />

                    <button type="submit" class="glass-button">
                        Add
                    </button>
                </form>
            </section>

            <section class="glass-panel user-tag-panel">
                <div class="user-tag-panel-header">
                    <div>
                        <h3>Block items with tags</h3>
                        <p>Items matching these tags are blocked for this user.</p>
                    </div>

                    <span class="user-tag-count">
                        ${proposedBlockedTags.length}
                    </span>
                </div>

                <div class="user-tag-chip-list">
                    ${renderUserTagChips(
                        proposedBlockedTags,
                        'blocked',
                        'No blocked tags'
                    )}
                </div>

                <form id="add-blocked-tag-form" class="user-tag-add-form">
                    <input
                        id="new-blocked-tag-input"
                        class="glass-input"
                        list="user-tag-options"
                        placeholder="Add blocked tag..."
                        autocomplete="off"
                    />

                    <button type="submit" class="glass-button">
                        Add
                    </button>
                </form>
            </section>
        </div>

        <datalist id="user-tag-options">
            ${availableTags.map(tag =>
                `<option value="${escapeHtml(tag)}"></option>`
            ).join('')}
        </datalist>

        <div class="user-tag-actions">
            <button
                id="reset-user-tags-btn"
                type="button"
                class="glass-button"
            >
                Reset
            </button>

            <button
                id="save-user-tags-btn"
                type="button"
                class="glass-button apply-btn"
            >
                Save Changes
            </button>
        </div>
    `;

    // Select All / Deselect All
    document.getElementById('managed-user-select-all')?.addEventListener(
        'click',
        () => {
            if (allSelected) {
                selectedManagedUserIds.clear();
            } else {
                selectedManagedUserIds = new Set(
                    managedUsers.map(user => user.Id)
                );
            }

            resetUserTagDraft();
            renderUserTagManager();
        }
    );

    // Individual user selection
    document
        .querySelectorAll<HTMLInputElement>('.managed-user-checkbox')
        .forEach(input => {
            input.addEventListener('change', () => {
                const userId =
                    input.getAttribute('data-managed-user-id');

                if (!userId) return;

                // Remember the current scroll position before the list is rebuilt.
                const userList =
                    document.querySelector<HTMLElement>('.managed-user-list');

                const scrollTop = userList?.scrollTop ?? 0;

                if (input.checked) {
                    selectedManagedUserIds.add(userId);
                } else {
                    selectedManagedUserIds.delete(userId);
                }

                resetUserTagDraft();
                renderUserTagManager();

                // Restore the user's position after the list is rebuilt.
                requestAnimationFrame(() => {
                    const newUserList =
                        document.querySelector<HTMLElement>('.managed-user-list');

                    if (newUserList) {
                        newUserList.scrollTop = scrollTop;
                    }
                });
            });
        });

    // Removing a tag removes it from EVERY selected user.
    document
        .querySelectorAll('[data-user-tag-action]')
        .forEach(el => {
            el.addEventListener('click', e => {
                const target = e.currentTarget as HTMLElement;

                const action =
                    target.getAttribute('data-user-tag-action');

                const tag =
                    target.getAttribute('data-user-tag');

                if (!tag) return;

                const list =
                    action === 'allowed'
                        ? proposedAllowedTags
                        : proposedBlockedTags;

                const index = list.indexOf(tag);

                if (index >= 0) {
                    list.splice(index, 1);
                }

                if (action === 'allowed') {
                    bulkRemovedAllowedTags.add(tag);
                    bulkAddedAllowedTags.delete(tag);
                } else {
                    bulkRemovedBlockedTags.add(tag);
                    bulkAddedBlockedTags.delete(tag);
                }

                renderUserTagManager();
            });
        });

    // Adding a tag adds it to EVERY selected user.
    //
    // Even if the tag already appears in the displayed union because
    // another selected user already has it, we still stage the addition.
    const addTag = (
        list: string[],
        inputId: string,
        addedSet: Set<string>,
        removedSet: Set<string>
    ) => {
        const input =
            document.getElementById(inputId) as HTMLInputElement | null;

        const value = input?.value.trim();

        if (!value) return;

        removedSet.delete(value);
        addedSet.add(value);

        if (!list.includes(value)) {
            list.push(value);
            list.sort((a, b) => a.localeCompare(b));
        }

        renderUserTagManager();
    };

    document
        .getElementById('add-allowed-tag-form')
        ?.addEventListener('submit', e => {
            e.preventDefault();

            addTag(
                proposedAllowedTags,
                'new-allowed-tag-input',
                bulkAddedAllowedTags,
                bulkRemovedAllowedTags
            );
        });

    document
        .getElementById('add-blocked-tag-form')
        ?.addEventListener('submit', e => {
            e.preventDefault();

            addTag(
                proposedBlockedTags,
                'new-blocked-tag-input',
                bulkAddedBlockedTags,
                bulkRemovedBlockedTags
            );
        });

    document
        .getElementById('reset-user-tags-btn')
        ?.addEventListener('click', () => {
            resetUserTagDraft();
            renderUserTagManager();
        });

    // Save changes to every selected user.
    document
        .getElementById('save-user-tags-btn')
        ?.addEventListener('click', async () => {
            const btn =
                document.getElementById(
                    'save-user-tags-btn'
                ) as HTMLButtonElement;

            const selectedUsers = getManagedUsers();

            if (selectedUsers.length === 0) {
                alert('Select at least one Jellyfin user.');
                return;
            }

            btn.disabled = true;
            btn.innerText = 'Saving...';

            try {
                let savedCount = 0;

                for (const managed of selectedUsers) {
                    if (!managed.Id) continue;

                    // Get the latest policy so unrelated tags are never
                    // overwritten.
                    const freshUserRes =
                        await userApi.getUserById({
                            userId: managed.Id
                        });

                    const freshUser = freshUserRes.data;

                    if (!freshUser.Policy) {
                        throw new Error(
                            `Jellyfin returned no policy for ${
                                managed.Name || managed.Id
                            }.`
                        );
                    }

                    const existingAllowed = new Set(
                        freshUser.Policy.AllowedTags || []
                    );

                    const existingBlocked = new Set(
                        freshUser.Policy.BlockedTags || []
                    );

                    // Remove only explicitly removed tags.
                    bulkRemovedAllowedTags.forEach(tag => {
                        existingAllowed.delete(tag);
                    });

                    bulkRemovedBlockedTags.forEach(tag => {
                        existingBlocked.delete(tag);
                    });

                    // Add only explicitly added tags.
                    bulkAddedAllowedTags.forEach(tag => {
                        existingAllowed.add(tag);
                    });

                    bulkAddedBlockedTags.forEach(tag => {
                        existingBlocked.add(tag);
                    });

                    const updatedPolicy: UserPolicy = {
                        ...freshUser.Policy,

                        AllowedTags: Array.from(existingAllowed)
                            .sort((a, b) => a.localeCompare(b)),

                        BlockedTags: Array.from(existingBlocked)
                            .sort((a, b) => a.localeCompare(b))
                    };

                    await userApi.updateUserPolicy({
                        userId: managed.Id,
                        userPolicy: updatedPolicy
                    });

                    managed.Policy = updatedPolicy;
                    savedCount++;
                }

                resetUserTagDraft();
                renderUserTagManager();

                alert(
                    `Saved tag access settings for ${savedCount} selected user${
                        savedCount === 1 ? '' : 's'
                    }.`
                );
            } catch (error) {
                console.error(
                    'Failed to update user tag policies',
                    error
                );

                alert(
                    'Failed to save user tag settings. Check the Jellyfin connection and permissions.'
                );
            } finally {
                const currentBtn =
                    document.getElementById(
                        'save-user-tags-btn'
                    ) as HTMLButtonElement | null;

                if (currentBtn) {
                    currentBtn.disabled = false;
                    currentBtn.innerText = 'Save Changes';
                }
            }
        });
}

function showAppView(view: 'media' | 'users') {
    currentAppView = view;

    const isUsers = view === 'users';

    document
        .querySelector('.main-content')
        ?.classList.toggle('hidden-app-view', isUsers);

    document
        .querySelector('.header-actions')
        ?.classList.toggle('hidden-app-view', isUsers);

    document
        .querySelector('.sidebar-container')
        ?.classList.toggle('hidden-app-view', isUsers);

    document
        .querySelector('.header-search-wrapper')
        ?.classList.toggle('hidden-app-view', isUsers);

    userManagementView.classList.toggle('active', isUsers);
    mediaViewBtn.classList.toggle('active', !isUsers);
    usersViewBtn.classList.toggle('active', isUsers);

    if (isUsers) {
        resetUserTagDraft();
        renderUserTagManager();
    }
}

// 5. Setup Listeners
searchInput.addEventListener('input', filterAndRender);
refreshBtn.addEventListener('click', fetchItems);
selectAllBtn.addEventListener('click', selectAllFiltered);
sortSelect.addEventListener('change', filterAndRender);
sourceLibrarySelect.addEventListener('change', filterAndRender);
parentalRatingSelect.addEventListener('change', filterAndRender);
mediaViewBtn?.addEventListener('click', () => showAppView('media'));
usersViewBtn?.addEventListener('click', () => showAppView('users'));

// Boot
init();

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js');
    });
}
