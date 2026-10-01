import useSWR, { mutate as mutateGlobal } from 'swr'
import { IS_DEMO } from '../lib/apiUrl'
import { ApiError, apiFetch } from '../lib/session'
import type {
    Collection,
    CollectionResponse,
    CollectionSection,
    CollectionsResponse,
    Visibility,
} from '../types/api'
import { useSession } from './useSession'

const KEY_PREFIX = 'collections'

/** null: the server has no collection routes yet. */
async function fetchCollections([, section]: [string, CollectionSection, string]): Promise<CollectionsResponse | null> {
    try {
        return await apiFetch<CollectionsResponse>(`/api/collections?section=${section}&items=1`)
    } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null
        throw error
    }
}

/** Refetches every cached collection list, after any change. */
export function refreshCollections() {
    return mutateGlobal((key) => Array.isArray(key) && key[0] === KEY_PREFIX)
}

/** The member's own collections in one section, newest change first, with items. */
export function useCollections(section: CollectionSection) {
    const session = useSession()
    const key = !IS_DEMO && session ? ([KEY_PREFIX, section, session.user.id] as [string, CollectionSection, string]) : null
    const { data, error, isLoading } = useSWR(key, fetchCollections, {
        revalidateOnFocus: true,
        dedupingInterval: 5_000,
    })
    return {
        collections: data?.collections ?? [],
        mediaToken: data?.mediaToken ?? '',
        isLoading: Boolean(key) && isLoading,
        error: error as Error | undefined,
        /** The demo, or a server too old for collections. */
        unsupported: IS_DEMO || data === null,
    }
}

async function write(path: string, method: string, json?: unknown): Promise<Collection> {
    const result = await apiFetch<CollectionResponse>(path, { method, json })
    void refreshCollections()
    return result.collection
}

export interface CollectionFields {
    title?: string
    description?: string
    visibility?: Visibility
    coverItemId?: string
}

export const collectionApi = {
    create: (section: CollectionSection, fields: CollectionFields & { title: string }, mediaIds: string[] = []) =>
        write('/api/collections', 'POST', { section, ...fields, mediaIds }),
    update: (id: string, fields: CollectionFields) => write(`/api/collections/${id}`, 'PATCH', fields),
    addItems: (id: string, mediaIds: string[]) => write(`/api/collections/${id}/items`, 'POST', { mediaIds }),
    removeItem: (id: string, itemId: string) => write(`/api/collections/${id}/items/${itemId}`, 'DELETE'),
    reorder: (id: string, itemIds: string[]) => write(`/api/collections/${id}/order`, 'PUT', { itemIds }),
    resetShare: (id: string) => write(`/api/collections/${id}/share/reset`, 'POST'),
    remove: async (id: string) => {
        await apiFetch(`/api/collections/${id}`, { method: 'DELETE' })
        void refreshCollections()
    },
}
