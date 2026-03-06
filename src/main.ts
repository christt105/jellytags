import { Jellyfin } from '@jellyfin/sdk';
import { getItemsApi } from '@jellyfin/sdk/lib/utils/api/items-api';
import { getItemUpdateApi } from '@jellyfin/sdk/lib/utils/api/item-update-api';
import { getSystemApi } from '@jellyfin/sdk/lib/utils/api/system-api';
import { getUserApi } from '@jellyfin/sdk/lib/utils/api/user-api';
import { getUserLibraryApi } from '@jellyfin/sdk/lib/utils/api/user-library-api';

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

// 2. DOM Elements
const gridEl = document.getElementById('media-grid') as HTMLDivElement;
const loadingEl = document.getElementById('loading-indicator') as HTMLDivElement;
const sidebarEl = document.getElementById('tag-editor-sidebar') as HTMLDivElement;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const refreshBtn = document.getElementById('refresh-btn') as HTMLButtonElement;
const sortSelect = document.getElementById('sort-select') as HTMLSelectElement;

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
        loadingEl.innerHTML = `<h3 style="color: #ff4d4f">Connection Failed. Check your .env file and ensure the Jellyfin server is running.</h3>`;
    }
}

async function fetchItems() {
    loadingEl.style.display = 'flex';
    gridEl.style.display = 'none';

    try {
        const res = await itemsApi.getItems({
            recursive: true,
            includeItemTypes: ['Movie', 'Series'],
            fields: ['Tags', 'ImageTags', 'DateCreated'] as any[]
        });
        allItems = res.data.Items || [];
        filterAndRender();
    } catch (err) {
        console.error(err);
        loadingEl.innerHTML = `<h3 style="color: #ff4d4f">Error fetching items. Check console.</h3>`;
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
        card.className = 'glass-panel';
        card.style.padding = '12px';
        card.style.cursor = 'pointer';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.transform = isSelected ? 'scale(1.05)' : 'scale(1)';
        card.style.borderColor = isSelected ? 'var(--jelly-blue)' : 'var(--glass-border)';
        card.style.boxShadow = isSelected ? '0 0 20px rgba(0, 164, 220, 0.4)' : 'var(--glass-shadow)';
        card.style.transition = 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)';
        card.style.position = 'relative';

        card.onclick = () => toggleSelection(item.Id);

        let imgHtml = `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--text-muted)">No Image</div>`;
        if (item.ImageTags && item.ImageTags.Primary) {
            const imageUrl = `${serverUrl}/Items/${item.Id}/Images/Primary?tag=${item.ImageTags.Primary}&maxWidth=400`;
            imgHtml = `<img src="${imageUrl}" style="width: 100%; height: 100%; object-fit: cover;" loading="lazy" />`;
        }

        const tagsHtml = (item.Tags || []).map((t: string) =>
            `<span style="background: rgba(170, 92, 195, 0.2); color: #e5b3fe; padding: 2px 8px; border-radius: 12px; font-size: 0.7rem; white-space: nowrap;">${t}</span>`
        ).join('');

        const checkHtml = isSelected ? `<div style="position: absolute; top: -10px; right: -10px; background: var(--jelly-blue); color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 10px rgba(0,0,0,0.3); font-weight: bold; z-index: 10;">✓</div>` : '';

        card.innerHTML = `
            ${checkHtml}
            <div style="width: 100%; aspect-ratio: 2/3; background: rgba(0,0,0,0.3); border-radius: 8px; overflow: hidden; margin-bottom: 12px;">
                ${imgHtml}
            </div>
            <div style="flex: 1; display: flex; flex-direction: column;">
                <div style="font-weight: 600; font-size: 0.95rem; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">${item.Name}</div>
                <div style="font-size: 0.8rem; color: var(--text-muted);">${item.Type}</div>
                <div style="margin-top: auto; padding-top: 8px; display: flex; flex-wrap: wrap; gap: 4px;">
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
            <h3 style="color: var(--text-main); margin-bottom: 16px;">Tag Editor</h3>
            <p style="font-size: 0.9rem;">Select items from the grid to edit their tags.</p>
        `;
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

    // Populate commonTags solely on init for these items (if we just selected items)
    // For simplicity in Vanilla JS, we will just manage an array of proposedTags globally or recalculate.
    // We'll calculate tags present exclusively on all selected items:
    const proposedTags = Object.entries(tagCounts)
        .filter(([_, count]) => count === selectedItems.length)
        .map(([t]) => t);

    renderSidebarEditor(proposedTags, tagCounts);
}

function renderSidebarEditor(proposedTags: string[], tagCounts: Record<string, number>) {
    const selectedItems = allItems.filter(i => selectedIds.has(i.Id));

    sidebarEl.innerHTML = `
        <div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <h3 style="margin: 0; color: var(--text-main)">Edit Tags</h3>
                <span style="font-size: 0.8rem; background: var(--jelly-blue); color: white; padding: 2px 8px; border-radius: 12px; font-weight: bold;">
                    ${selectedIds.size} selected
                </span>
            </div>
            <button id="clear-btn" style="background: transparent; border: 1px solid var(--glass-border); color: var(--text-muted); padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.8rem; width: 100%;">
                Clear Selection
            </button>
        </div>

            <h4 style="font-size: 0.9rem; margin-bottom: 12px; color: var(--text-muted);">Tags to Apply</h4>
            <div id="proposed-tags-container" style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px;">
                ${proposedTags.length === 0 ? '<span style="font-size: 0.85rem; color: var(--glass-border);">No tags</span>' : ''}
                ${proposedTags.map(t => `
                    <div style="background: rgba(170, 92, 195, 0.2); color: #e5b3fe; padding: 4px 10px; border-radius: 16px; font-size: 0.85rem; display: flex; align-items: center; gap: 6px;">
                        ${t}
                        <span data-remove-tag="${t}" style="cursor: pointer; font-weight: bold; color: white; opacity: 0.7;">&times;</span>
                    </div>
                `).join('')}
            </div>

            <form id="add-tag-form" style="display: flex; gap: 8px;">
                <input id="new-tag-input" type="text" class="glass-input" placeholder="Add new tag..." autocomplete="off" />
                <button type="submit" class="glass-button" style="padding: 8px 16px;">+</button>
            </form>

            ${Object.keys(tagCounts).length > 0 ? `
                <div style="margin-top: 24px;">
                    <h4 style="font-size: 0.85rem; margin-bottom: 8px; color: var(--text-muted);">Existing Tags in Selection:</h4>
                    <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                        ${Object.entries(tagCounts).map(([t, count]) => `
                            <span data-add-tag="${t}" title="Present on ${count} item(s)" style="font-size: 0.75rem; padding: 2px 6px; background: rgba(255,255,255,0.05); border-radius: 4px; cursor: pointer; border: 1px solid transparent;">
                                ${t} <span style="opacity: 0.5;">(${count})</span>
                            </span>
                        `).join('')}
                    </div>
                    <p style="font-size: 0.7rem; color: var(--text-muted); margin-top: 8px;">Click to add to all</p>
                </div>
            ` : ''}
        </div>

        <button id="apply-btn" class="glass-button" style="width: 100%;">
            Apply to ${selectedIds.size} Items
        </button>

        <div style="flex: 1; overflow-y: auto;">
            <h4 style="font-size: 0.9rem; margin-bottom: 12px; color: var(--text-muted);">Selected Items</h4>
            <div id="selected-items-list" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px; max-height: 240px; overflow-y: auto;">
                ${selectedItems.map(item => {
                    let thumbHtml = `<div style="width: 36px; height: 36px; background: rgba(0,0,0,0.3); border-radius: 4px; display: flex; align-items: center; justify-content: center; color: var(--text-muted); font-size: 0.7rem;">${item.Type === 'Movie' ? 'M' : 'S'}</div>`;
                    if (item.ImageTags && item.ImageTags.Primary) {
                        const thumbUrl = `${serverUrl}/Items/${item.Id}/Images/Primary?tag=${item.ImageTags.Primary}&maxWidth=80`;
                        thumbHtml = `<img src="${thumbUrl}" style="width: 36px; height: 36px; object-fit: cover; border-radius: 4px;" />`;
                    }
                    return `
                        <div data-deselect="${item.Id}" style="display: flex; align-items: center; gap: 10px; padding: 6px; background: rgba(0,0,0,0.2); border-radius: 6px; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(0,0,0,0.2)'">
                            ${thumbHtml}
                            <div style="flex: 1; min-width: 0;">
                                <div style="font-size: 0.85rem; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.Name}</div>
                                <div style="font-size: 0.7rem; color: var(--text-muted);">${item.Type}</div>
                            </div>
                            <span style="color: var(--text-muted); font-size: 1rem;">&times;</span>
                        </div>
                    `;
                }).join('')}
            </div>
    `;

    document.getElementById('clear-btn')?.addEventListener('click', clearSelection);

    document.getElementById('add-tag-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('new-tag-input') as HTMLInputElement;
        const val = input.value.trim();
        if (val && !proposedTags.includes(val)) {
            proposedTags.push(val);
            renderSidebarEditor(proposedTags, tagCounts);
        }
    });

    document.querySelectorAll('[data-remove-tag]').forEach(el => {
        el.addEventListener('click', (e) => {
            const tag = (e.currentTarget as HTMLElement).getAttribute('data-remove-tag')!;
            proposedTags.splice(proposedTags.indexOf(tag), 1);
            renderSidebarEditor(proposedTags, tagCounts);
        });
    });

    document.querySelectorAll('[data-add-tag]').forEach(el => {
        el.addEventListener('click', (e) => {
            const tag = (e.currentTarget as HTMLElement).getAttribute('data-add-tag')!;
            if (!proposedTags.includes(tag)) {
                proposedTags.push(tag);
                renderSidebarEditor(proposedTags, tagCounts);
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
        btn.style.opacity = '0.7';

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
            btn.style.opacity = '1';
        }
    });
}

// 5. Setup Listeners
searchInput.addEventListener('input', filterAndRender);
refreshBtn.addEventListener('click', fetchItems);
sortSelect.addEventListener('change', filterAndRender);

// Boot
init();
