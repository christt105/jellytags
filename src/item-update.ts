import type { ItemsApi } from '@jellyfin/sdk/lib/generated-client/api/items-api';
import type { ItemUpdateApi } from '@jellyfin/sdk/lib/generated-client/api/item-update-api';
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models';
import type { EditField } from './edit-field';

export type ValuesTransform = (current: string[]) => string[];

export type UpdateProgress = {
    index: number;
    total: number;
};

export type UpdateOutcome = {
    updated: Map<string, string[]>;
    unchangedIds: string[];
    failedIds: string[];
    skippedIds: string[];
};

export type UpdateOptions = {
    onProgress?: (progress: UpdateProgress) => void;
    shouldStop?: () => boolean;
};

const roundTripFields = [
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
] as ItemFields[];

function sameValues(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Rewrites one metadata field on each item, one item at a time, using the
 * server's current values as the transform's input.
 *
 * Jellyfin only updates items by posting the whole item back, so every item is
 * fetched fresh with all the fields that update would otherwise wipe. Items
 * whose values the transform leaves untouched are not written at all.
 */
export class ItemFieldUpdater {
    constructor(
        private readonly itemsApi: ItemsApi,
        private readonly updateApi: ItemUpdateApi,
        private readonly getUserId: () => string,
    ) {}

    async updateItems(ids: string[], field: EditField, transform: ValuesTransform, options: UpdateOptions = {}): Promise<UpdateOutcome> {
        const outcome: UpdateOutcome = { updated: new Map(), unchangedIds: [], failedIds: [], skippedIds: [] };

        for (let index = 0; index < ids.length; index++) {
            const id = ids[index];
            if (options.shouldStop?.()) {
                outcome.skippedIds.push(...ids.slice(index));
                break;
            }
            options.onProgress?.({ index, total: ids.length });

            try {
                const updatedValues = await this.updateItem(id, field, transform);
                if (updatedValues) outcome.updated.set(id, updatedValues);
                else outcome.unchangedIds.push(id);
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
                outcome.failedIds.push(id);
            }
        }

        return outcome;
    }

    private async updateItem(id: string, field: EditField, transform: ValuesTransform): Promise<string[] | null> {
        const itemRes = await this.itemsApi.getItems({
            ids: [id],
            userId: this.getUserId(),
            fields: roundTripFields
        });
        const serverItem = itemRes.data.Items?.[0];
        if (!serverItem) {
            throw new Error(`Item ${id} not found on server.`);
        }
        if (!serverItem.Name) {
            throw new Error('Cannot update item without a Name field.');
        }

        const currentValues = (field === 'Genres' ? serverItem.Genres : serverItem.Tags) || [];
        const updatedValues = transform(currentValues);
        if (sameValues(currentValues, updatedValues)) {
            return null;
        }

        // Jellyfin rejects the round-tripped DTO when it carries a
        // Trickplay map: TrickplayInfoDto fails to deserialize on the
        // server and the whole update fails. Strip it before sending.
        const { Trickplay: _trickplay, ...sanitizedItem } = serverItem;

        await this.updateApi.updateItem({
            itemId: id,
            baseItemDto: {
                ...sanitizedItem,
                Id: id,
                Tags: field === 'Tags' ? updatedValues : (serverItem.Tags || []),
                Genres: field === 'Genres' ? updatedValues : (serverItem.Genres || []),
                ProviderIds: serverItem.ProviderIds || {}
            }
        });

        return updatedValues;
    }
}
