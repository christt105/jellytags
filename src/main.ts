import { Jellyfin } from '@jellyfin/sdk';
import { getItemsApi } from '@jellyfin/sdk/lib/utils/api/items-api';
import { getItemUpdateApi } from '@jellyfin/sdk/lib/utils/api/item-update-api';
import { getSystemApi } from '@jellyfin/sdk/lib/utils/api/system-api';
import { getUserApi } from '@jellyfin/sdk/lib/utils/api/user-api';
import { getUserLibraryApi } from '@jellyfin/sdk/lib/utils/api/user-library-api';
import { BaseItemKind, ItemFields } from '@jellyfin/sdk/lib/generated-client/models';
import type { ItemsApi } from '@jellyfin/sdk/lib/generated-client/api/items-api';

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
const userLibraryApi = getUserLibraryApi(api);

let allItems: any[] = [];
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
const sortSelect = document.getElementById('sort-select') as HTMLSelectElement;
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

        currentUserId = usersRes.data[0].Id as string;

        await fetchItems();
    } catch (e) {
        loadingEl.innerHTML = `<h3 class="error-message">Connection Failed. Check your .env file and ensure the Jellyfin server is running.</h3>`;
    }
}

async function fetchItems() {
    loadingEl.style.display = 'flex';
    gridEl.style.display = 'none';

    try {
        const res = await itemsApi.getItems({
            recursive: true,
            includeItemTypes: [BaseItemKind.Movie, BaseItemKind.Series] as BaseItemKind[],
            fields: [ItemFields.Tags, ItemFields.DateCreated] as ItemFields[]
        },);
        allItems = res.data.Items || [];

        filterAndRender();
    } catch (err) {
        console.error(err);
        loadingEl.innerHTML = `<h3 class="error-message">Error fetching items. Check console.</h3>`;
    }
}

function renderGrid(itemsToRender: any[]) {
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
                <div class="media-card-type">${item.Type}</div>
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

function filterAndRender() {
    const q = searchInput.value.toLowerCase();
    let filtered = allItems.filter(i =>
        i.Name.toLowerCase().includes(q) ||
        (i.Tags && i.Tags.some((t: string) => t.toLowerCase().includes(q)))
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

    renderGrid(filtered);
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
    const isMobile = window.innerWidth <= 768;

    sidebarEl.innerHTML = `
        <div>
            <div class="sidebar-top-bar">
                <h3 class="sidebar-title" style="margin: 0;">Edit Tags</h3>
                <div class="sidebar-actions-group">
                    <span class="sidebar-selection-count">
                        ${selectedIds.size} selected
                    </span>
                    ${isMobile ? '<button id="sidebar-close" class="sidebar-close-btn">&times;</button>' : ''}
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

        <button id="apply-btn" class="glass-button apply-btn">
            Apply to ${selectedIds.size} Items
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

        try {
            const ids = Array.from(selectedIds);
            // Updating tags: we fetch the item first, apply new tags, update.
            // Jellyfin usually accepts the full item object via POST to /Items/{Id}
            for (const id of ids) {
                // Fetch the full BaseItemDto contextually tied to this exact user resolving any validation errors.
                const itemRes = await userLibraryApi.getItem({ itemId: id, userId: currentUserId });
                const fullItem = itemRes.data;

                // Update tags and send the full schema back
                fullItem.Tags = [...proposedTags];
                await updateApi.updateItem({ itemId: id, baseItemDto: fullItem });

                const localItem = allItems.find(i => i.Id === id);
                if (localItem) localItem.Tags = [...proposedTags];
            }
            alert(`Successfully updated tags for ${ids.length} items!`);
            clearSelection();
        } catch (err) {
            console.error(err);
            alert('Error updating tags.');
        } finally {
            btn.innerText = `Apply to ${selectedIds.size} Items`;
            btn.disabled = false;
            btn.classList.remove('apply-btn-disabled');
        }
    });
}

// 5. Setup Listeners
searchInput.addEventListener('input', filterAndRender);
refreshBtn.addEventListener('click', fetchItems);
sortSelect.addEventListener('change', filterAndRender);

// Boot
init();
