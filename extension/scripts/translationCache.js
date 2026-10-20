// Caching implementation
async function sha256(buffer) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Deletes are writes: IndexedDB journals them so the transaction can roll back,
// so freeing space temporarily needs space. Deleting in small, separately
// committed chunks keeps that journal tiny, and each commit frees room for the
// next one - which is what lets an already-full store dig itself out.
const DELETE_CHUNK = 5;

// Mirrors the popup's INPAINT_MULTIPLIER_DEFAULT. Kept here rather than imported because the
// service worker never loads popup.js; if one moves, move the other.
const INPAINT_MULTIPLIER_DEFAULT = 1;

// IndexedDB on a device that is out of space can leave a transaction that neither commits nor
// errors: its promise never settles, so an await on it hangs with nothing to catch. The cache is
// an optimisation and must never be able to hold up a translation, so every operation is raced
// against a deadline. The shorter one covers work a caller is waiting on; the longer one covers
// cursor scans and the fire-and-forget write, where a slow device is not yet a wedged one.
const CACHE_OP_TIMEOUT_MS = 8000;
const CACHE_BULK_TIMEOUT_MS = 30000;

function withCacheTimeout(promise, label, timeoutMs) {
    let timer;

    const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
            const error = new Error("TranslationCache stalled: " + label);
            error.cacheStalled = true;
            reject(error);
        }, timeoutMs);
    });

    return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

class TranslationCache {
    constructor() {
        this.dbName = 'TranslationCacheDB';
        this.storeName = 'translations';
        this.version = 3;
        this.db = null;
        this.initPromise = null;
        this.unavailable = false;
    }

    // Every storage operation funnels through here: skip a cache that has already proven it will
    // not answer, bound the wait, and swallow a stall so the caller carries on cacheless. Real
    // IndexedDB errors still propagate - only the unsettleable ones are absorbed.
    async run(label, fallback, fn, timeoutMs = CACHE_OP_TIMEOUT_MS) {
        if (this.unavailable) return fallback;

        try {
            await withCacheTimeout(this.init(), label + "/init", timeoutMs);
            return await withCacheTimeout(fn(), label, timeoutMs);
        } catch (error) {
            if (error && error.cacheStalled) {
                this.retire(error);
                return fallback;
            }

            throw error;
        }
    }

    retire(error) {
        if (this.unavailable) return;

        this.unavailable = true;
        console.warn("Translation cache retired for this session:", error.message);

        try {
            if (this.db) this.db.close();
        } catch (e) { }

        this.db = null;
        this.initPromise = null;
    }

    async init() {
        if (this.db) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = (event) => {
                this.initPromise = null;
                reject(event.target.error);
            };

            // An older connection elsewhere blocks the upgrade; nothing resolves until it closes.
            request.onblocked = () => {
                this.initPromise = null;
                reject(new Error("Cache upgrade blocked by another connection"));
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                this.initPromise = null;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                let store;

                if (event.oldVersion < 3 && db.objectStoreNames.contains(this.storeName)) {
                    db.deleteObjectStore(this.storeName);
                }

                if (!db.objectStoreNames.contains(this.storeName)) {
                    store = db.createObjectStore(this.storeName);
                } else {
                    store = request.transaction.objectStore(this.storeName);
                }

                if (!store.indexNames.contains('timestamp')) {
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });

        return this.initPromise;
    }

    async generateKey(input, headers) {
        let buffer;
        if (typeof input === 'string') {
            buffer = new TextEncoder().encode(input);
        } else {
            buffer = await input.arrayBuffer();
        }

        const blobHash = await sha256(buffer);

        let headerKey;

        // Whether the multiplier belongs in a key at all is decided in one place, for both
        // branches below: an inpaint-only run is inpainting too, so a changed spread has to miss
        // there as well. Omitted at the default for the same reason reasoning_effort is omitted
        // at "none" - see the note further down.
        const inpaintMultiplierKeyPart = headers.inpaint_multiplier
            && parseFloat(headers.inpaint_multiplier) !== INPAINT_MULTIPLIER_DEFAULT
            ? { inpaint_multiplier: headers.inpaint_multiplier }
            : null;

        if (headers.inpaint_only === "true") {
            headerKey = JSON.stringify({
                inpaint_only: headers.inpaint_only,
                ...inpaintMultiplierKeyPart
            });
        } else {
            const header = {
                target_lang: headers.target_lang,
                translator: headers.translator,
                font: headers.font,
                min_font_size: headers.min_font_size,
                stroke_enabled: !headers.stroke_disabled,
                legacy_inpaint: headers.legacy_inpaint,
                bubbles_only: headers.bubbles_only,
                inpaint_only: headers.inpaint_only,
                text_align: headers.text_align,
                context: headers.context !== "false",
                custom_prompt: headers.custom_prompt
            };

            // Appended, never inserted, and only when they are NOT at their default. Every key
            // ever written was hashed from an object without these fields, back when reasoning
            // was disabled server-side for everyone and the spread was fixed. Including either
            // unconditionally - even as "none" or "1" - would change the hash and orphan every
            // cached translation in every user's history. Omitting them at their defaults
            // reproduces the old object byte for byte, so those entries keep hitting; any other
            // value is a genuinely different translation and should miss.
            Object.assign(header, inpaintMultiplierKeyPart);

            if (headers.reasoning_effort && headers.reasoning_effort !== "none") {
                header.reasoning_effort = headers.reasoning_effort;
            }

            headerKey = JSON.stringify(header);
        }

        const headerBuffer = new TextEncoder().encode(headerKey);
        const headerHash = await sha256(headerBuffer);

        return `${headerHash}-${blobHash}`;
    }

    async get(key) {
        return this.run("get", undefined, () => new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(key);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            transaction.onabort = () => reject(transaction.error || new Error("Get transaction aborted"));
        }));
    }

    // Read-only, so it needs no journal space and works even when the store is
    // completely full. Key-only, so multi-MB record values are never deserialized.
    async collectKeys(count, range = null) {
        return this.run("collectKeys", [], () => new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const index = transaction.objectStore(this.storeName).index('timestamp');
            const request = index.openKeyCursor(range);
            const keys = [];

            request.onsuccess = (event) => {
                const cursor = event.target.result;

                if (cursor && (count === null || keys.length < count)) {
                    keys.push(cursor.primaryKey);
                    cursor.continue();
                    return;
                }

                resolve(keys);
            };

            request.onerror = (event) => reject(event.target.error);
            transaction.onabort = () => reject(new Error("Key scan transaction aborted"));
        }), CACHE_BULK_TIMEOUT_MS);
    }

    // One small transaction per chunk. A chunk that can't get journal space aborts
    // on its own without taking the rest down, and every chunk that does commit
    // frees room for the ones after it.
    async deleteKeys(keys) {
        let deleted = 0;

        for (let i = 0; i < keys.length; i += DELETE_CHUNK) {
            const chunk = keys.slice(i, i + DELETE_CHUNK);

            try {
                await this.run("deleteKeys", null, () => new Promise((resolve, reject) => {
                    const transaction = this.db.transaction([this.storeName], 'readwrite');
                    const store = transaction.objectStore(this.storeName);

                    for (const key of chunk) {
                        store.delete(key);
                    }

                    transaction.oncomplete = () => resolve();
                    transaction.onerror = (event) => reject(event.target.error);
                    transaction.onabort = (event) => reject(event.target.error || new Error("Delete transaction aborted"));
                }));
            } catch (error) {
                console.warn("Cache delete chunk failed, continuing", error);
                continue;
            }

            // A retired cache swallowed the chunk rather than committing it, so it neither counts
            // nor is there any point trying the rest.
            if (this.unavailable) break;

            deleted += chunk.length;
        }

        return deleted;
    }

    // Last resort for a store so full that not even one chunk can commit. Dropping
    // the database is a file-level operation with no per-record journal, so it
    // succeeds where incremental deletes cannot. Losing the cache beats a cache
    // that can neither store nor evict anything.
    async reset() {
        try {
            if (this.db) this.db.close();
        } catch (e) { }

        this.db = null;
        this.initPromise = null;

        return withCacheTimeout(new Promise((resolve) => {
            const request = indexedDB.deleteDatabase(this.dbName);

            request.onsuccess = () => resolve(true);
            request.onerror = () => resolve(false);
            // Another context (e.g. the popup) holds the database open.
            request.onblocked = () => resolve(false);
        }), "reset", CACHE_OP_TIMEOUT_MS).catch((error) => {
            this.retire(error);
            return false;
        });
    }

    async put(key, data, preserveTimestamp = false) {
        if (this.unavailable) return;

        if (!preserveTimestamp) {
            data.timestamp = Date.now();
        }

        // A stall resolves instead of throwing, so the recovery below runs only for real errors:
        // a store that has stopped answering cannot be pruned or reset its way out either.
        const attemptPut = () => {
            return this.run("put", undefined, () => new Promise((resolve, reject) => {
                const transaction = this.db.transaction([this.storeName], 'readwrite');
                const store = transaction.objectStore(this.storeName);
                const request = store.put(data, key);

                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve();
                transaction.onabort = () => reject(transaction.error || new Error("Put transaction aborted"));
            }), CACHE_BULK_TIMEOUT_MS);
        };

        try {
            await attemptPut();
        } catch (error) {
            const isMutationError =
                error.name === 'InvalidStateError' ||
                error.name === 'ReadOnlyError' ||
                error.message?.includes("database that did not allow mutations") ||
                error.message?.includes("transaction aborted") ||
                error.message?.includes("Prune transaction aborted");

            if (isMutationError) {
                console.warn("Storage mutations disabled (e.g. Firefox private browsing or restricted storage). Skipping local cache put.");
                return;
            }

            // Handle QuotaExceededError (Chrome) and NS_ERROR_DOM_QUOTA_REACHED (Firefox)
            const isQuotaError =
                error.name === 'QuotaExceededError' ||
                error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
                error.message?.includes("quota limitations") ||
                error.message?.includes("QuotaExceededError") ||
                error.message?.includes("not enough space") ||
                error.message?.includes("operation failed for reasons unrelated");

            if (isQuotaError) {
                console.warn("Storage quota exceeded. Attempting to free space...");

                // Try pruning in stages
                let retryCount = 0;
                let success = false;

                while (retryCount < 3 && !success) {
                    retryCount++;
                    // Prune progressively more items (50, 100, 200)
                    const pruneCount = retryCount * 50;
                    const deleted = await this.pruneOldest(pruneCount).catch(() => 0);

                    if (deleted === 0) {
                        // Chunked deletes freed nothing, so the store is wedged:
                        // full, and without the headroom to evict its way out.
                        console.warn("Storage quota exceeded and pruning freed nothing. Resetting cache.");

                        const wasReset = await this.reset();

                        if (wasReset) {
                            try {
                                await attemptPut();
                            } catch (resetError) {
                                console.warn("Cache put failed after reset", resetError);
                            }
                        }

                        return;
                    }

                    try {
                        await attemptPut();
                        success = true;
                        console.log(`Successfully stored item after pruning ${deleted} items (retry ${retryCount}).`);
                    } catch (retryError) {
                        if (retryCount === 3) return;
                        console.warn(`Retry ${retryCount} failed, pruning more...`);
                    }
                }
            } else {
                throw error;
            }
        }
    }

    async pruneOldest(count = 10) {
        // The timestamp index is ascending, so the first keys are the oldest.
        const keys = await this.collectKeys(count);

        if (keys.length === 0) return 0;

        const deleted = await this.deleteKeys(keys);

        if (deleted > 0) console.log(`Cache pruning complete. Deleted ${deleted} oldest items.`);

        return deleted;
    }

    async delete(key) {
        return this.run("delete", undefined, () => new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(key);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
            transaction.onabort = () => reject(transaction.error || new Error("Delete transaction aborted"));
        }));
    }

    async getRecent(limit = 10, offset = 0) {
        return this.run("getRecent", [], () => new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const index = store.index('timestamp');
            const request = index.openCursor(null, 'prev'); // Descending order

            const results = [];
            let hasAdvanced = false;

            request.onsuccess = (event) => {
                const cursor = event.target.result;

                if (!cursor) {
                    resolve(results);
                    return;
                }

                if (offset > 0 && !hasAdvanced) {
                    hasAdvanced = true;
                    cursor.advance(offset);
                    return;
                }

                try {
                    const item = cursor.value;
                    item.key = cursor.primaryKey;
                    results.push(item);
                } catch (e) {
                    console.warn("Failed to read IndexedDB value:", e);
                    results.push({
                        key: cursor.primaryKey,
                        isCorrupted: true,
                        error: e
                    });
                }

                if (results.length < limit) {
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };

            request.onerror = (event) => reject(event.target.error);
            transaction.onabort = () => reject(transaction.error || new Error("Recent scan transaction aborted"));
        }), CACHE_BULK_TIMEOUT_MS);
    }

    async cleanup(ttlMilliseconds = 604800000) { // Default 1 week
        if (ttlMilliseconds === -1) return; // Never delete

        const cutoff = Date.now() - ttlMilliseconds;
        const keys = await this.collectKeys(null, IDBKeyRange.upperBound(cutoff));

        if (keys.length === 0) return;

        await this.deleteKeys(keys);
    }

    async getAll() {
        return this.run("getAll", [], () => new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.openCursor();
            const results = [];

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const item = cursor.value;
                    item.key = cursor.primaryKey;
                    results.push(item);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };

            request.onerror = (event) => reject(event.target.error);
            transaction.onabort = () => reject(transaction.error || new Error("Scan transaction aborted"));
        }), CACHE_BULK_TIMEOUT_MS);
    }
}

export {
    TranslationCache
}
