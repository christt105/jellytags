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

// 2. DOM Elements
const gridEl = document.getElementById('media-grid') as HTMLDivElement;
const loadingEl = document.getElementById('loading-indicator') as HTMLDivElement;
const sidebarEl = document.getElementById('tag-editor-sidebar') as HTMLDivElement;
const sidebarOverlay = document.getElementById('sidebar-overlay') as HTMLDivElement;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const refreshBtn = document.getElementById('refresh-btn') as HTMLButtonElement;
const selectAllBtn = document.getElementById('select-all-btn') as HTMLButtonElement;
const sortSelect = document.getElementById('sort-select') as HTMLSelectElement;
const userSelect = document.getElementById('user-select') as HTMLSelectElement;
const sourceLibrarySelect = document.getElementById('source-library-select') as HTMLSelectElement;
const parentalRatingSelect = document.getElementById('parental-rating-select') as HTMLSelectElement;
const sidebarToggle = document.getElementById('sidebar-toggle') as HTMLButtonElement;
const sidebarClose = document.getElementById('sidebar-close') as HTMLButtonElement;

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

// 3. Core Logic
async function init() {
    try {
        await systemApi.getPublicSystemInfo();

        const usersRes = await userApi.getUsers();
        if (!usersRes.data || usersRes.data.length === 0) {
            throw new Error("No users found. Ensure your API Token has admin permissions.");
        }

        userSelect.innerHTML = usersRes.data.map(u => `<option value="${u.Id}">${u.Name}</option>`).join('');
        
        const prvUser = usersRes.data.find(u => u.Name === 'prv');
        if (prvUser) {
            userSelect.value = prvUser.Id as string;
            currentUserId = prvUser.Id as string;
        } else {
            currentUserId = usersRes.data[0].Id as string;
            userSelect.value = currentUserId;
        }

        userSelect.addEventListener('change', () => {
            currentUserId = userSelect.value;
            fetchItems();
        });

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
                includeItemTypes: ['Movie', 'Series', 'Video'] as BaseItemKind[],
                fields: [ItemFields.Tags, ItemFields.DateCreated] as ItemFields[]
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
                    includeItemTypes: ['Movie', 'Series', 'Video'] as BaseItemKind[],
                    fields: [ItemFields.Tags, ItemFields.DateCreated] as ItemFields[]
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
        ${sourceLibraries.map(library => `<option value="${library.id}">${library.name}</option>`).join('')}
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
        ${parentalRatings.map(rating => `<option value="${rating}">${rating}</option>`).join('')}
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
            `<span class="media-tag">${t}</span>`
        ).join('');

        const checkHtml = isSelected ? `<div class="media-card-check">✓</div>` : '';

        card.innerHTML = `
            ${checkHtml}
            <div class="media-card-image-wrapper">
                ${imgHtml}
            </div>
            <div class="media-card-info">
                <div class="media-card-title">${item.Name}</div>
                <div class="media-card-type">${item.Type}${item.SourceLibraryName ? ` • ${item.SourceLibraryName}` : ''}</div>
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

    let filtered = allItems.filter(i =>
        (selectedLibraryId === 'all' || i.SourceLibraryId === selectedLibraryId) &&
        (selectedParentalRating === 'all' || (i.OfficialRating || '').trim() === selectedParentalRating) &&
        (
            (i.Name || '').toLowerCase().includes(q) ||
            (i.Tags && i.Tags.some((t: string) => t.toLowerCase().includes(q)))
        )
    );

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
            <p class="sidebar-empty-msg">Select items from the grid to edit their tags.</p>
        `;
        const closeBtn = document.getElementById('sidebar-close');
        closeBtn?.addEventListener('click', closeSidebar);
        closeSidebar();
        return;
    }

    // Determine tags to propose
    const selectedItems = allItems.filter(i => selectedIds.has(i.Id));

    const tagCounts: Record<string, number> = {};
    selectedItems.forEach(i => {
        (i.Tags || []).forEach((t: string) => {
            tagCounts[t] = (tagCounts[t] || 0) + 1;
        });
    });

    renderSidebarEditor(tagCounts);
}

function renderSidebarEditor(tagCounts: Record<string, number>) {
    const selectedItems = allItems.filter(i => selectedIds.has(i.Id));
    const applyButtonLabel = getApplyButtonLabel();

    sidebarEl.innerHTML = `
        <div>
            <div class="sidebar-top-bar">
                <h3 class="sidebar-title" style="margin: 0;">Edit Tags</h3>
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

            <h4 class="section-subtitle">Tags to Apply</h4>
            <div id="proposed-tags-container" class="proposed-tags-container">
                ${proposedTags.length === 0 ? '<span class="no-tags-msg">No tags</span>' : ''}
                ${proposedTags.map(t => `
                    <div class="proposed-tag">
                        ${t}
                        <span data-remove-tag="${t}" class="proposed-tag-remove">&times;</span>
                    </div>
                `).join('')}
            </div>

            <form id="add-tag-form" class="add-tag-form">
                <input id="new-tag-input" type="text" class="glass-input" placeholder="Add new tag..." autocomplete="off" />
                <button type="submit" class="glass-button add-tag-btn">+</button>
            </form>

            ${Object.keys(tagCounts).length > 0 ? `
                <div class="existing-tags-section">
                    <h4 class="existing-tags-title">Existing Tags in Selection:</h4>
                    <div class="existing-tags-list">
                        ${Object.entries(tagCounts).map(([t, count]) => `
                            <span data-add-tag="${t}" title="Present on ${count} item(s)" class="existing-tag">
                                ${t} <span class="existing-tag-count">(${count})</span>
                            </span>
                        `).join('')}
                    </div>
                    <p class="existing-tag-hint">Click to add to all</p>
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
        let thumbHtml = `<div class="selected-item-thumb-placeholder">${item.Type === 'Movie' ? 'M' : item.Type === 'Series' ? 'S' : 'V'}</div>`;
        if (item.ImageTags && item.ImageTags.Primary) {
            const thumbUrl = `${serverUrl}/Items/${item.Id}/Images/Primary?tag=${item.ImageTags.Primary}&maxWidth=80`;
            thumbHtml = `<img src="${thumbUrl}" class="selected-item-thumb-img" />`;
        }
        return `
                        <div data-deselect="${item.Id}" class="selected-item-card">
                            ${thumbHtml}
                            <div class="selected-item-info">
                                <div class="selected-item-name">${item.Name}</div>
                                <div class="selected-item-type">${item.Type}</div>
                            </div>
                            <span class="selected-item-remove">&times;</span>
                        </div>
                    `;
    }).join('')}
            </div>
    `;

    document.getElementById('clear-btn')?.addEventListener('click', clearSelection);

    document.getElementById('sidebar-close')?.addEventListener('click', closeSidebar);

    document.getElementById('add-tag-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('new-tag-input') as HTMLInputElement;
        const val = input.value.trim();
        if (val && !proposedTags.includes(val)) {
            proposedTags.push(val);
            renderSidebarEditor(tagCounts);
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
            const tag = (e.currentTarget as HTMLElement).getAttribute('data-remove-tag')!;
            proposedTags.splice(proposedTags.indexOf(tag), 1);
            renderSidebarEditor(tagCounts);
        });
    });

    document.querySelectorAll('[data-add-tag]').forEach(el => {
        el.addEventListener('click', (e) => {
            const tag = (e.currentTarget as HTMLElement).getAttribute('data-add-tag')!;
            if (!proposedTags.includes(tag)) {
                proposedTags.push(tag);
                renderSidebarEditor(tagCounts);
            }
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

                    const currentTags = serverItem.Tags || localItem?.Tags || [];
                    const updatedTags = mode === 'append'
                        ? Array.from(new Set([...currentTags, ...proposedTags]))
                        : mode === 'remove'
                            ? currentTags.filter((tag: string) => !proposedTags.includes(tag))
                            : [...proposedTags];

                    await updateApi.updateItem({
                        itemId: id,
                        baseItemDto: {
                            ...serverItem,
                            Id: id,
                            Name: itemName,
                            Tags: updatedTags,
                            Genres: serverItem.Genres || [],
                            ProviderIds: serverItem.ProviderIds || {}
                        }
                    });

                    if (localItem) localItem.Tags = [...updatedTags];

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
                alert(`Successfully updated tags for ${successCount} items!`);
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
