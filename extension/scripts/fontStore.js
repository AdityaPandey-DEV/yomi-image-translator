// Custom fonts, kept in the extension's own IndexedDB so every site shares them. Content scripts
// reach this through the background's font_* messages: an IndexedDB they opened themselves would
// belong to whichever page they happen to run on.
//
// Names and sizes are a store of their own, so listing never loads every font's bytes.
const FONT_DB_NAME = "YomiFontsDB"
const FONT_META_STORE = "meta"
const FONT_DATA_STORE = "data"

// Same failure as TranslationCache guards against: out of space, a transaction can neither commit
// nor error, and an await on it never returns. Writes of a large font get the longer deadline.
const FONT_OP_TIMEOUT_MS = 8000
const FONT_WRITE_TIMEOUT_MS = 30000

// sfnt (TrueType, OpenType, collections) and WOFF/WOFF2. A truncated or reassembled-wrong upload
// fails this before it can be stored as a font that never loads.
const FONT_SIGNATURES = ["\x00\x01\x00\x00", "OTTO", "true", "typ1", "ttcf", "wOFF", "wOF2"]

class FontStorageError extends Error {
    constructor(message, reason) {
        super(message)
        this.name = "FontStorageError"
        this.reason = reason
    }
}

function withFontTimeout(promise, label, timeoutMs) {
    let timer
    const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new FontStorageError("Font storage is not responding: " + label, "stalled")), timeoutMs)
    })
    return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

function isQuotaError(error) {
    return error?.name === "QuotaExceededError" ||
        error?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
        error?.message?.includes("quota") ||
        error?.message?.includes("QuotaExceededError") ||
        error?.message?.includes("not enough space") ||
        error?.message?.includes("operation failed for reasons unrelated")
}

// Private browsing and locked-down profiles open the database but refuse every write.
function isMutationError(error) {
    return error?.name === "InvalidStateError" ||
        error?.name === "ReadOnlyError" ||
        error?.message?.includes("database that did not allow mutations")
}

function bytesToBase64(bytes) {
    const CHUNK = 0x8000
    let binary = ""
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
    }
    return btoa(binary)
}

function base64ToBytes(base64) {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

function hasFontSignature(bytes) {
    if (bytes.length < 4) return false
    const head = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
    return FONT_SIGNATURES.includes(head)
}

function requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

function transactionDone(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error || new Error("Font transaction aborted"))
    })
}

class FontStore {
    constructor() {
        this.db = null
        this.dbPromise = null
        // A font is read in several slices, one message each; this spares re-reading it per slice.
        this.lastRead = null
    }

    open() {
        if (this.dbPromise) return this.dbPromise
        this.dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(FONT_DB_NAME, 1)
            request.onupgradeneeded = () => {
                const db = request.result
                if (!db.objectStoreNames.contains(FONT_META_STORE)) db.createObjectStore(FONT_META_STORE, { keyPath: "cleanName" })
                if (!db.objectStoreNames.contains(FONT_DATA_STORE)) db.createObjectStore(FONT_DATA_STORE)
            }
            request.onsuccess = () => {
                const db = request.result
                this.db = db
                db.onclose = () => this.forget()
                db.onversionchange = () => {
                    db.close()
                    this.forget()
                }
                resolve(db)
            }
            request.onerror = () => reject(request.error)
            request.onblocked = () => reject(new FontStorageError("Font storage upgrade blocked by another connection", "blocked"))
        })
        this.dbPromise.catch(() => this.forget())
        return this.dbPromise
    }

    forget() {
        this.db = null
        this.dbPromise = null
        this.lastRead = null
    }

    // Unlike the translation cache, a stall never retires the store: these are the user's files, so
    // the next request reopens it and tries again rather than the fonts vanishing for the session.
    async run(label, fn, timeoutMs = FONT_OP_TIMEOUT_MS) {
        try {
            const db = await withFontTimeout(this.open(), label + "/open", FONT_OP_TIMEOUT_MS)
            return await withFontTimeout(fn(db), label, timeoutMs)
        } catch (error) {
            if (error?.reason === "stalled") {
                try { this.db?.close() } catch (e) { }
                this.forget()
            }
            throw error
        }
    }

    // [{ cleanName, fileName, size }]. Key-only on the data side, so no font's bytes are loaded,
    // and an entry whose bytes are missing is left out rather than listed and failing to read.
    async list() {
        return this.run("list", async (db) => {
            const tx = db.transaction([FONT_META_STORE, FONT_DATA_STORE], "readonly")
            const [metas, dataKeys] = await Promise.all([
                requestToPromise(tx.objectStore(FONT_META_STORE).getAll()),
                requestToPromise(tx.objectStore(FONT_DATA_STORE).getAllKeys()),
            ])
            const present = new Set(dataKeys)
            return metas.filter(meta => present.has(meta.cleanName) && Number.isInteger(meta.size) && meta.size > 0)
        })
    }

    // Base64 of bytes [start, end). Callers slice on multiples of 3, so the pieces concatenate.
    async read(cleanName, start, end) {
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
            throw new FontStorageError(`Bad font read range ${start}-${end}`, "invalid")
        }
        if (this.lastRead?.cleanName !== cleanName) {
            const data = await this.run("read", db =>
                requestToPromise(db.transaction(FONT_DATA_STORE, "readonly").objectStore(FONT_DATA_STORE).get(cleanName)))
            if (!data) throw new FontStorageError("Font not found: " + cleanName, "missing")
            this.lastRead = { cleanName, bytes: new Uint8Array(data) }
        }
        return bytesToBase64(this.lastRead.bytes.subarray(start, end))
    }

    // expectedSize is the byte count the sender started with: a chunked upload that lost a piece on
    // the way still decodes, just to the wrong length.
    async put(cleanName, fileName, base64, expectedSize) {
        if (typeof cleanName !== "string" || !cleanName) throw new FontStorageError("Font has no name", "invalid")
        if (typeof base64 !== "string" || !base64) throw new FontStorageError("Font data did not arrive", "invalid")

        let bytes
        try {
            bytes = base64ToBytes(base64)
        } catch (error) {
            throw new FontStorageError("Font data arrived corrupted", "invalid")
        }
        if (Number.isInteger(expectedSize) && bytes.byteLength !== expectedSize) {
            throw new FontStorageError(`Font data arrived incomplete (${bytes.byteLength} of ${expectedSize} bytes)`, "invalid")
        }
        if (!hasFontSignature(bytes)) throw new FontStorageError("Not a font file", "invalid")

        await this.write("put", async (db) => {
            const tx = db.transaction([FONT_META_STORE, FONT_DATA_STORE], "readwrite")
            tx.objectStore(FONT_META_STORE).put({ cleanName, fileName, size: bytes.byteLength })
            tx.objectStore(FONT_DATA_STORE).put(bytes.buffer, cleanName)
            await transactionDone(tx)
        })
        if (this.lastRead?.cleanName === cleanName) this.lastRead = null
    }

    async delete(cleanName) {
        await this.write("delete", async (db) => {
            const tx = db.transaction([FONT_META_STORE, FONT_DATA_STORE], "readwrite")
            tx.objectStore(FONT_META_STORE).delete(cleanName)
            tx.objectStore(FONT_DATA_STORE).delete(cleanName)
            await transactionDone(tx)
        })
        if (this.lastRead?.cleanName === cleanName) this.lastRead = null
    }

    // Out of space or read-only, the write fails with a reason the user can act on and nothing else
    // is touched - fonts are never evicted, and no other store gives up room for them.
    async write(label, fn) {
        try {
            return await this.run(label, fn, FONT_WRITE_TIMEOUT_MS)
        } catch (error) {
            if (isMutationError(error)) {
                throw new FontStorageError("This browser profile doesn't allow saving fonts (private browsing or restricted storage).", "readonly")
            }
            if (isQuotaError(error)) throw new FontStorageError("Not enough storage space to save this font.", "quota")
            throw error
        }
    }
}

export {
    FontStore
}
