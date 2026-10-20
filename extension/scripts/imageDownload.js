const api = typeof browser !== "undefined" ? browser : chrome

// How long a download may take to start before the caller moves on without it.
const DOWNLOAD_START_TIMEOUT_MS = 5000

function dataUrlToBlob(dataUrl) {
    const [header, base64] = dataUrl.split(",")
    const mime = header.match(/:(.*?);/)[1]
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new Blob([bytes], { type: mime })
}

// Firefox's downloads.download() refuses data: URLs, but its background page can make blob: URLs.
// Chrome's background is a service worker with no URL.createObjectURL, and takes data: URLs as is.
// Detected rather than sniffed, so the Chrome and Firefox background scripts stay the same file.
function toDownloadUrl(imageUrl) {
    if (!imageUrl.startsWith("data:") || typeof URL.createObjectURL !== "function") {
        return { url: imageUrl, revoke: null }
    }
    const url = URL.createObjectURL(dataUrlToBlob(imageUrl))
    return { url, revoke: () => URL.revokeObjectURL(url) }
}

// A blob: URL has to outlive the download reading it, so it is freed only once the download ends.
function revokeWhenFinished(downloadId, revoke) {
    let revoked = false
    const finish = () => {
        if (revoked) return
        revoked = true
        api.downloads.onChanged.removeListener(onChanged)
        revoke()
    }
    const onChanged = (delta) => {
        const state = delta.state?.current
        if (delta.id === downloadId && (state === "complete" || state === "interrupted")) finish()
    }
    api.downloads.onChanged.addListener(onChanged)
    // A small image can finish before the listener above was attached.
    api.downloads.search({ id: downloadId })
        .then(([item]) => { if (!item || item.state !== "in_progress") finish() })
        .catch(() => { })
}

// Resolves once the download has started, or after DOWNLOAD_START_TIMEOUT_MS so a browser that is
// slow to start it can't hold up the caller. Rejects if the browser refuses the download outright.
async function downloadImage(imageUrl, filename) {
    const { url, revoke } = toDownloadUrl(imageUrl)
    const downloadTask = api.downloads.download({ url, filename, conflictAction: "uniquify", saveAs: false })
    if (revoke) downloadTask.then(id => revokeWhenFinished(id, revoke), revoke)

    let timer
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve("timeout"), DOWNLOAD_START_TIMEOUT_MS) })
    try {
        if (await Promise.race([downloadTask, timeout]) === "timeout") {
            console.log("Download timed out, continuing...")
            downloadTask.catch(e => console.warn("Late download error:", e))
        }
    } finally {
        clearTimeout(timer)
    }
}

export {
    downloadImage
}
