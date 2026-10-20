
async function translateWithGeminiVision(blob, url, settings, headers) {
    let apiKey = (settings['yomi_byok_google'] || '').trim();

    // 1. Check local plain key storage for offline private mode
    if (!apiKey || apiKey.includes(':') || apiKey.includes('...')) {
        try {
            const local = await api.storage.local.get({
                yomi_byok_google_plain: '',
                raw_byok_google: '',
                yomi_byok_google: ''
            });
            const sync = await api.storage.sync.get({
                yomi_byok_google: ''
            });
            if (local.yomi_byok_google_plain) {
                apiKey = local.yomi_byok_google_plain.trim();
            } else if (local.raw_byok_google) {
                apiKey = local.raw_byok_google.trim();
            } else if (local.yomi_byok_google && !local.yomi_byok_google.includes(':') && !local.yomi_byok_google.includes('...')) {
                apiKey = local.yomi_byok_google.trim();
            } else if (sync.yomi_byok_google && !sync.yomi_byok_google.includes(':') && !sync.yomi_byok_google.includes('...')) {
                apiKey = sync.yomi_byok_google.trim();
            }
        } catch (_) {}
    }

    // 2. If key is encrypted vault payload (salt:iv:ciphertext), decrypt client-side
    if (apiKey && apiKey.includes(':')) {
        try {
            const vaultUser = settings['yomi_vault_user'] || currentUser?.email || 'yomi-local-user';
            const { decryptApiKey } = await import('./vaultCrypto.js');
            const decrypted = await decryptApiKey(apiKey, vaultUser);
            if (decrypted) apiKey = decrypted.trim();
        } catch (e) {
            console.error('[Yomi Vault] Decryption error:', e);
        }
    }

    // 3. Check encrypted vault setting if still not resolved
    if (!apiKey && settings['yomi_encrypted_vault']) {
        try {
            const vaultUser = settings['yomi_vault_user'] || currentUser?.email || 'user@yomi.local';
            const { decryptApiKey } = await import('./vaultCrypto.js');
            apiKey = (await decryptApiKey(settings['yomi_encrypted_vault'], vaultUser) || '').trim();
        } catch (e) {
            console.error('[Yomi Vault] Decryption error:', e);
        }
    }

    if (!apiKey) {
        return {
            success: false,
            content: { error: 'Please enter your Google Gemini API Key in the Yomi extension popup (under BYOK Settings) to translate for free!' }
        };
    }

    let imageBlob = blob;
    if (!imageBlob && url) {
        try {
            const res = await fetchWithReferer(url, url);
            if (res && res.ok) {
                imageBlob = await res.blob();
            }
        } catch (e) {
            console.error('fetchWithReferer failed', e);
        }
    }

    if (!imageBlob) {
        return { success: false, content: { error: 'No image data available to translate.' } };
    }

    const bitmap = await createImageBitmap(imageBlob);
    const w = bitmap.width;
    const h = bitmap.height;

    const originalDataUrl = await blobToImage(imageBlob);
    const base64Data = originalDataUrl.split(',')[1];
    const mimeType = originalDataUrl.substring(originalDataUrl.indexOf(':') + 1, originalDataUrl.indexOf(';')) || 'image/jpeg';

    const selectedModel = settings['translation_model'] || 'gemini-3.8-flash';
    const targetLang = settings['yomi_target_lang'] || 'en';
    const customPrompt = settings['yomi_custom_prompt'] || '';

    const candidateModels = Array.from(new Set([
        selectedModel,
        'gemini-3.8-flash',
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite',
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemini-2.0-flash',
        'gemini-1.5-flash'
    ]));

    const systemPrompt = `You are Yomi Manga & Manhwa Translator.
This image has dimensions: width=${w}px, height=${h}px.
TASK: Detect ALL speech bubbles, dialogue balloons, narration boxes, thoughts, and text in the manga image.
Translate all dialogue accurately into: ${targetLang}.
${customPrompt ? `User instructions: ${customPrompt}` : ''}

CRITICAL: For every speech bubble or text block, provide exact normalized 2D bounding boxes:
- "box_2d": [ymin, xmin, ymax, xmax] as integers normalized from 0 to 1000 (0,0 is top-left, 1000,1000 is bottom-right).
- "raw_text": original foreign text (Korean/Japanese/Chinese)
- "translated_text": natural translation in target language

Return STRICT valid JSON conforming exactly to this structure:
{
  "summary": "Short scene summary",
  "bubbles": [
    {
      "box_2d": [ymin, xmin, ymax, xmax],
      "raw_text": "original text",
      "translated_text": "natural translation",
      "vertical": false
    }
  ]
}`;

    let lastError = null;
    let detectionResult = null;

    for (const model of candidateModels) {
        try {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [
                            {
                                parts: [
                                    { text: systemPrompt },
                                    {
                                        inline_data: {
                                            mime_type: mimeType,
                                            data: base64Data
                                        }
                                    }
                                ]
                            }
                        ],
                        generationConfig: {
                            response_mime_type: 'application/json',
                            temperature: 0.1
                        }
                    })
                }
            );

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`Gemini (${model}) ${res.status}: ${errText}`);
            }

            const json = await res.json();
            const textPart = json.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!textPart) throw new Error('Empty response from Gemini');

            let cleaned = textPart.trim();
            if (cleaned.startsWith('```json')) {
                cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
            } else if (cleaned.startsWith('```')) {
                cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
            }

            detectionResult = JSON.parse(cleaned);
            break;
        } catch (err) {
            lastError = err;
            console.warn(`[Yomi Background] Model ${model} failed:`, err.message || err);
        }
    }

    if (!detectionResult || !Array.isArray(detectionResult.bubbles)) {
        bitmap.close();
        return {
            success: false,
            content: { error: lastError?.message || 'Gemini Vision could not detect text in image.' }
        };
    }

    // Parse bubbles accurately to pixel space
    const parsedBubbles = detectionResult.bubbles.map(b => {
        let left, top, width, height, centerX, centerY;
        if (Array.isArray(b.box_2d) && b.box_2d.length === 4) {
            const [ymin, xmin, ymax, xmax] = b.box_2d;
            const scale = (ymax <= 1.0 && xmax <= 1.0) ? 1.0 : 1000.0;
            top = (ymin / scale) * h;
            left = (xmin / scale) * w;
            const bottom = (ymax / scale) * h;
            const right = (xmax / scale) * w;
            width = Math.max(30, right - left);
            height = Math.max(20, bottom - top);
            centerX = left + width / 2;
            centerY = top + height / 2;
        } else {
            width = Number(b.width) || 120;
            height = Number(b.height) || 80;
            centerX = Number(b.x) || width / 2;
            centerY = Number(b.y) || height / 2;
            if (centerX <= 1 && centerY <= 1) {
                centerX *= w;
                centerY *= h;
                width *= w;
                height *= h;
            } else if (centerX <= 1000 && centerY <= 1000 && w > 1200) {
                centerX = (centerX / 1000) * w;
                centerY = (centerY / 1000) * h;
                width = (width / 1000) * w;
                height = (height / 1000) * h;
            }
            left = centerX - width / 2;
            top = centerY - height / 2;
        }
        return {
            left: Math.max(0, Math.round(left)),
            top: Math.max(0, Math.round(top)),
            width: Math.max(30, Math.round(width)),
            height: Math.max(20, Math.round(height)),
            centerX: Math.round(centerX),
            centerY: Math.round(centerY),
            raw_text: b.raw_text || '',
            translated_text: b.translated_text || b.text || '',
            vertical: Boolean(b.vertical)
        };
    });

    // 1. Inpainting: cleanly erase the original Korean/Japanese characters
    const inpaintCanvas = new OffscreenCanvas(w, h);
    const inpaintCtx = inpaintCanvas.getContext('2d');
    inpaintCtx.drawImage(bitmap, 0, 0);

    parsedBubbles.forEach(b => {
        inpaintCtx.save();
        inpaintCtx.fillStyle = '#ffffff';
        const radius = Math.min(b.width, b.height) * 0.35;
        inpaintCtx.beginPath();
        if (typeof inpaintCtx.roundRect === 'function') {
            inpaintCtx.roundRect(b.left, b.top, b.width, b.height, radius);
        } else {
            inpaintCtx.ellipse(b.centerX, b.centerY, b.width / 2, b.height / 2, 0, 0, Math.PI * 2);
        }
        inpaintCtx.fill();
        inpaintCtx.restore();
    });

    const inpaintedBlob = await inpaintCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
    const inpaintedDataUrl = await blobToImage(inpaintedBlob);

    // 2. Typesetting: wrap and render English text inside the bubble
    const transCanvas = new OffscreenCanvas(w, h);
    const transCtx = transCanvas.getContext('2d');
    transCtx.drawImage(inpaintCanvas, 0, 0);

    const textObjects = [];
    parsedBubbles.forEach(b => {
        const transText = (b.translated_text || '').toUpperCase().trim();
        if (!transText) return;

        const padX = Math.max(8, b.width * 0.12);
        const padY = Math.max(6, b.height * 0.12);
        const maxTextW = b.width - padX * 2;
        const maxTextH = b.height - padY * 2;

        let bestFontSize = 18;
        let bestLines = [transText];

        for (let size = 28; size >= 10; size -= 1.5) {
            transCtx.font = `bold ${size}px "WildWords", "Comic Neue", "Bangers", Arial, sans-serif`;
            const words = transText.split(/\s+/);
            const lines = [];
            let cur = '';
            for (const word of words) {
                const test = cur ? cur + ' ' + word : word;
                if (transCtx.measureText(test).width > maxTextW && cur) {
                    lines.push(cur);
                    cur = word;
                } else {
                    cur = test;
                }
            }
            if (cur) lines.push(cur);

            const lineHeight = size * 1.18;
            const totalH = lines.length * lineHeight;
            if (totalH <= maxTextH || size <= 11) {
                bestFontSize = size;
                bestLines = lines;
                break;
            }
        }

        transCtx.save();
        transCtx.font = `bold ${bestFontSize}px "WildWords", "Comic Neue", "Bangers", Arial, sans-serif`;
        transCtx.textAlign = 'center';
        transCtx.textBaseline = 'middle';

        const lineHeight = bestFontSize * 1.18;
        const totalHeight = bestLines.length * lineHeight;
        const startY = b.centerY - (totalHeight / 2) + (lineHeight / 2);

        bestLines.forEach((line, i) => {
            const lineY = startY + i * lineHeight;
            transCtx.strokeStyle = '#ffffff';
            transCtx.lineWidth = 3.5;
            transCtx.lineJoin = 'round';
            transCtx.strokeText(line, b.centerX, lineY);

            transCtx.fillStyle = '#000000';
            transCtx.fillText(line, b.centerX, lineY);
        });
        transCtx.restore();

        textObjects.push({
            x: b.left,
            y: b.top,
            width: b.width,
            height: b.height,
            text: b.translated_text,
            originalText: b.raw_text,
            font: settings['yomi_font'] || 'wildwords',
            fontSize: bestFontSize,
            color: '#000000',
            strokeColor: '#ffffff',
            strokeWidth: 3.5
        });
    });

    const translatedBlob = await transCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
    const translatedDataUrl = await blobToImage(translatedBlob);

    bitmap.close();

    return {
        success: true,
        content: {
            original: originalDataUrl,
            inpainted: inpaintedDataUrl,
            translated: translatedDataUrl,
            image: translatedDataUrl,
            text: textObjects,
            context: detectionResult.summary || '',
            credits: 999999
        }
    };
}

import {
    initializeApp,
    getAuth,
    GoogleAuthProvider,
    OAuthProvider,
    signInWithCredential,
    signOut,
    signInWithEmailLink,
    sendSignInLinkToEmail,
    doc,
    getDoc,
    setDoc,
    initializeFirestore
} from "./firebase.js"
import { TranslationCache } from "./translationCache.js"
import { FontStore } from "./fontStore.js"
import { downloadImage } from "./imageDownload.js"

// One namespace for all three packages, so the builds stay true copies of each other. Firefox
// must have browser.* - its chrome.* is callback-only while these calls are promise-returning -
// and Chrome has no browser at all. Safari provides both and works either way.
const api = typeof browser !== "undefined" ? browser : chrome

const firebaseConfig = {
    apiKey: "AIzaSyB_qiJGMFVc2hab1Gqk0nIvicdrswmOMOU",
    authDomain: "yomi-translator.vercel.app",
    projectId: "yomi-image-translator",
    storageBucket: "yomi-image-translator.appspot.com",
    messagingSenderId: "7062330756",
    appId: "1:7062330756:web:ab07bef7254b1cc0eb11d1",
    measurementId: "G-V4S47Z5WZP",
}

const defaultFreeUser = {
    uid: "free-yomi-user",
    email: "free@yomi.local",
    displayName: "Yomi Free User",
    photoURL: null,
    getIdToken: async () => "free_token"
};

let initialized = true;
let currentUser = defaultFreeUser;
let loginResult = null
let receivedLoginResult = false
// Every waiting sign-in picks up the same token, and an Apple token works only once (a second
// exchange fails as "Duplicate credential"), so the first attempt to reach a token keeps it.
let claimedSignInToken = null
let isCreatingUser = false
let sentErrors = 0
let lastErrorsResetTime = Date.now()
const app = initializeApp(firebaseConfig)
const db = initializeFirestore(app, { experimentalForceLongPolling: true })
const auth = getAuth(app)
const translationCache = new TranslationCache();
const fontStore = new FontStore();

const downloadFilenames = new Map();
const chunkStore = new Map();

if (api.declarativeNetRequest) {
    api.declarativeNetRequest.getSessionRules().then(async (rules) => {
        const ids = rules.map(r => r.id);
        if (ids.length > 0) {
            await api.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids });
        }

        // Add startup rule for global image CORS modifications
        const startupRules = [
            {
                id: 999999,
                priority: 2,
                action: {
                    type: "modifyHeaders",
                    responseHeaders: [
                        {
                            header: "access-control-allow-origin",
                            operation: "set",
                            value: "*"
                        }
                    ]
                },
                condition: {
                    urlFilter: "*",
                    resourceTypes: ["image"]
                }
            }
        ];
        await api.declarativeNetRequest.updateSessionRules({ addRules: startupRules });
    }).catch(err => console.error("Error clearing/setting session rules on launch", err));
}

const activeRuleIds = new Set();
let nextSessionRuleId = 100000;
function getUniqueRuleId() {
    while (activeRuleIds.has(nextSessionRuleId)) {
        nextSessionRuleId++;
        if (nextSessionRuleId > 900000) {
            nextSessionRuleId = 100000;
        }
    }
    const allocatedId = nextSessionRuleId;
    activeRuleIds.add(allocatedId);
    nextSessionRuleId++;
    return allocatedId;
}

// A host's rules match every background request to it, so concurrent fetches for different referers
// would send each other's headers. Same-referer fetches set identical headers and share the host.
const hostLeases = new Map();
const HOST_LEASE_WAIT_MS = 15000;

async function leaseHost(host, referer) {
    let blocker = null;
    let blockedSince = 0;
    for (;;) {
        const lease = hostLeases.get(host);
        if (!lease) {
            const fresh = { host, referer, holders: 1, contended: false };
            fresh.done = new Promise(resolve => { fresh.release = resolve; });
            hostLeases.set(host, fresh);
            return fresh;
        }
        // Once someone is waiting, later same-referer fetches queue behind them instead of joining.
        if (lease.referer === referer && !lease.contended) {
            lease.holders++;
            return lease;
        }
        if (lease.referer !== referer) lease.contended = true;

        if (lease !== blocker) {
            blocker = lease;
            blockedSince = performance.now();
        }
        const remaining = blockedSince + HOST_LEASE_WAIT_MS - performance.now();
        if (remaining <= 0) {
            // Its holder's fetch never answered. Evicted, so nobody else queues behind it either.
            hostLeases.delete(host);
            lease.release();
            continue;
        }
        let timer;
        await Promise.race([lease.done, new Promise(resolve => { timer = setTimeout(resolve, remaining); })]);
        clearTimeout(timer);
    }
}

function releaseHost(lease) {
    if (!lease || --lease.holders > 0) return;
    // An evicted lease may already have been replaced by a newer one.
    if (hostLeases.get(lease.host) === lease) hostLeases.delete(lease.host);
    lease.release();
}

// One budget for both attempts and the caller's body read, so a host that never answers can't hang
// a translation.
const IMAGE_FETCH_TIMEOUT_MS = 60000;

async function fetchWithReferer(url, referer, checkCacheOnly = false, contentFailures = "") {
    let cleanReferer = referer;
    if (cleanReferer) {
        try {
            const refUrl = new URL(cleanReferer);
            cleanReferer = refUrl.origin;
        } catch (e) {
            cleanReferer = cleanReferer.split(/[?#]/)[0];
        }
    }
    const signal = AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS);

    if (!api.declarativeNetRequest) {
        return await fetch(url, {
            signal,
            referrer: cleanReferer,
            referrerPolicy: "no-referrer-when-downgrade",
            credentials: "include",
            headers: {
                "Referer": cleanReferer
            }
        });
    }

    let ruleId = null;
    let ruleAdded = false;
    let hostLease = null;
    let response = null;
    let fetchError = null;

    try {
        ruleId = getUniqueRuleId();
        let urlFilterHost;
        try {
            urlFilterHost = new URL(url).hostname;
        } catch (e) {
            urlFilterHost = url.split('?')[0];
        }
        hostLease = await leaseHost(urlFilterHost, cleanReferer);

        let secFetchSite = "cross-site";
        try {
            const targetHost = new URL(url).hostname;
            const refererHost = new URL(referer).hostname;
            if (targetHost === refererHost) {
                secFetchSite = "same-origin";
            } else {
                const getRegistrableDomain = (hostname) => {
                    const parts = hostname.split('.');
                    if (parts.length <= 2) return hostname;
                    const prev = parts[parts.length - 2];
                    if (['com', 'co', 'net', 'org', 'gov', 'edu'].includes(prev) && parts.length >= 3) {
                        return parts.slice(-3).join('.');
                    }
                    return parts.slice(-2).join('.');
                };
                if (getRegistrableDomain(targetHost) === getRegistrableDomain(refererHost)) {
                    secFetchSite = "same-site";
                }
            }
        } catch (e) { }

        let cookieHeaderValue = "";
        if (api.cookies && typeof api.cookies.getAll === "function") {
            try {
                // 1. Get standard unpartitioned cookies
                let cookies = await api.cookies.getAll({ url: url });

                // 2. Get partitioned cookies if referer is available (for CHIPS support)
                if (cleanReferer && cleanReferer.startsWith("http")) {
                    try {
                        const partitioned = await api.cookies.getAll({
                            url: url,
                            partitionKey: { topLevelSite: cleanReferer }
                        });
                        if (partitioned && partitioned.length > 0) {
                            cookies = cookies.concat(partitioned);
                        }
                    } catch (e) {
                        console.warn("partitionKey query failed", e);
                    }
                }

                // De-duplicate cookies by name
                const uniqueCookies = [];
                const seenNames = new Set();
                for (const c of cookies) {
                    if (!seenNames.has(c.name)) {
                        seenNames.add(c.name);
                        uniqueCookies.push(c);
                    }
                }

                if (uniqueCookies.length > 0) {
                    cookieHeaderValue = uniqueCookies.map(c => `${c.name}=${c.value}`).join("; ");
                }
            } catch (e) {
                console.warn("Failed to get cookies via api.cookies", e);
            }
        }

        const requestHeaders = [
            {
                header: "referer",
                operation: "set",
                value: cleanReferer
            },
            {
                header: "origin",
                operation: "remove"
            },
            {
                header: "sec-fetch-dest",
                operation: "set",
                value: "image"
            },
            {
                header: "sec-fetch-mode",
                operation: "set",
                value: "no-cors"
            },
            {
                header: "sec-fetch-site",
                operation: "set",
                value: secFetchSite
            },
            {
                header: "accept",
                operation: "set",
                value: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
            }
        ];

        if (cookieHeaderValue) {
            requestHeaders.push({
                header: "cookie",
                operation: "set",
                value: cookieHeaderValue
            });
        }

        const rule = {
            id: ruleId,
            priority: 1,
            action: {
                type: "modifyHeaders",
                requestHeaders: requestHeaders
            },
            condition: {
                urlFilter: urlFilterHost,
                // Without it, the page's own requests to this host get these headers too while the
                // rule exists. Safari has no tabIds and silently ignores it.
                tabIds: [api.tabs.TAB_ID_NONE],
                resourceTypes: ["xmlhttprequest", "other", "image"]
            }
        };

        try {
            await api.declarativeNetRequest.updateSessionRules({ addRules: [rule] });
        } catch (error) {
            // Safari's DNR before WebKit's 2023 rewrite may reject keys it doesn't know.
            delete rule.condition.tabIds;
            await api.declarativeNetRequest.updateSessionRules({ addRules: [rule] });
        }
        ruleAdded = true;

        response = await fetch(url, { credentials: "include", signal });
    } catch (error) {
        fetchError = error;
    } finally {
        if (ruleId !== null) {
            try {
                await api.declarativeNetRequest.updateSessionRules({
                    removeRuleIds: [ruleId]
                });
            } catch (e) {
                sendError(e, "declarativeNetRequest removeRuleIds failed");
            }
            activeRuleIds.delete(ruleId);
        }
        releaseHost(hostLease);
    }

    // If the referer-modified fetch succeeded, return it
    if (!fetchError && response && response.ok) {
        return response;
    }

    // Otherwise try once more without our rule. Another fetch's rule for this host can still
    // apply, and Firefox sends this referrer anyway.
    let fallbackResponse = null;
    let fallbackError = null;
    try {
        fallbackResponse = await fetch(url, {
            signal,
            referrer: cleanReferer,
            referrerPolicy: "no-referrer-when-downgrade",
            credentials: "include",
            headers: {
                "Referer": cleanReferer
            }
        });
    } catch (error) {
        fallbackError = error;
    }

    const fallbackFailed = !fallbackResponse || !fallbackResponse.ok;
    // A rejected rule is our bug even when the fallback rescues the image.
    if (!checkCacheOnly && (fallbackFailed || !ruleAdded)) {
        const ruleOutcome = ruleAdded ? describeFetchOutcome(response, fetchError) : `rule not added: ${fetchError}`;
        reportImageFetchFailure(url, referer, contentFailures, ruleOutcome, describeFetchOutcome(fallbackResponse, fallbackError));
    }

    return fallbackResponse;
}

function describeFetchOutcome(response, error) {
    return error ? String(error) : `status ${response ? response.status : "none"}`;
}

// Without access, every image a site serves from another host fails the same way, and some hosts
// (H@H) give each image its own subdomain. One report per site per session says it all.
const sitesReportedWithoutAccess = new Set();

async function reportImageFetchFailure(url, referer, contentFailures, ruleOutcome, fallbackOutcome) {
    let hostAccess = "unknown";
    try {
        const { protocol, hostname } = new URL(url);
        hostAccess = await api.permissions.contains({ origins: [`${protocol}//${hostname}/*`] });
    } catch (e) { }

    if (hostAccess === false) {
        let site = referer;
        try { site = new URL(referer).origin; } catch (e) { }
        if (sitesReportedWithoutAccess.has(site)) return;
        sitesReportedWithoutAccess.add(site);
    }

    const safeUrlLog = url ? (url.length > 500 ? url.substring(0, 500) + "..." : url) : "none";
    sendError(
        new Error(`content script: ${contentFailures || "none recorded"}; rule: ${ruleOutcome}; fallback: ${fallbackOutcome}; host access: ${hostAccess}`),
        `fetchWithReferer failed (url: ${safeUrlLog}, ref: ${referer})`
    );
}

const downloadListener = (item, suggest) => {
    // Only handle downloads initiated by this extension
    if (item.byExtensionId === api.runtime.id || downloadFilenames.has(item.url)) {
        const suggestedFilename = downloadFilenames.get(item.url);
        if (suggestedFilename) {
            suggest({ filename: suggestedFilename, conflictAction: 'uniquify' });
            // Clean up the map
            downloadFilenames.delete(item.url);
            return;
        }
    }
};

function setupDownloadListener() {
    if (api.downloads && api.downloads.onDeterminingFilename) {
        if (!api.downloads.onDeterminingFilename.hasListener(downloadListener)) {
            api.downloads.onDeterminingFilename.addListener(downloadListener);
            console.log("Download listener added");
        }
    }
}

async function performDownloadAllCached() {
    try {
        // Keys first, then one record at a time: every record holds a whole translated image, and
        // with retention set to "never" loading them all at once can run the background out of memory.
        const keys = await translationCache.collectKeys(null)
        const settings = await api.storage.sync.get({ yomi_auto_save: false, yomi_auto_save_folder: "YomiTranslations" })

        if (settings.yomi_auto_save) {
            if (!api.downloads || !api.downloads.download) {
                return { success: false, error: "Auto-save is not supported on this browser." }
            }
            let downloadCount = 0
            for (const key of keys) {
                const item = await translationCache.get(key)
                if (item && !item.downloaded) {
                    try {
                        let filename = item.filename || `yomi_${item.timestamp || Date.now()}.jpg`

                        // Only append .jpg if no common image extension is found
                        if (!filename.match(/\.(jpg|jpeg|png|webp|gif)$/i)) {
                            filename += ".jpg"
                        }

                        const folder = settings.yomi_auto_save_folder || "YomiTranslations"
                        filename = `${folder}/${filename}`

                        // Store the filename mapping
                        downloadFilenames.set(item.image, filename);

                        await downloadImage(item.image, filename)

                        item.downloaded = true
                        await translationCache.put(key, item, true)
                        downloadCount++
                    } catch (e) {
                        console.warn("Failed to auto-download cached item", e)
                    }
                }
            }
            return { success: true, count: downloadCount }
        }
        return { success: true, count: 0 }
    } catch (error) {
        sendError(error, "Auto-save failed")
        console.warn("Failed to download cached items", error)
        return { success: false, error: "Failed to download cached items." }
    }
}

const CACHE_CLEANUP_INTERVAL = 6 * 60 * 60 * 1000

// The popup was the only thing that ever ran retention cleanup, so a user who rarely opens it
// kept a store that only ever grew. Run it from the background instead, throttled so it costs
// nothing on a normal startup.
async function runScheduledCacheCleanup() {
    try {
        const stored = await api.storage.local.get({
            yomi_recent_ttl: 604800000,
            yomi_last_cache_cleanup: 0
        })

        if (Date.now() - stored.yomi_last_cache_cleanup < CACHE_CLEANUP_INTERVAL) return

        await api.storage.local.set({ yomi_last_cache_cleanup: Date.now() })

        const ttl = parseInt(stored.yomi_recent_ttl)

        // TTL is the only retention rule; cleanup() ignores -1 ("never delete").
        if (!isNaN(ttl)) {
            await translationCache.cleanup(ttl)
        }
    } catch (error) {
        console.warn("Scheduled cache cleanup failed", error)
    }
}

// Delayed so it never competes with a translation the user is waiting on. If the service
// worker suspends first, it simply runs on the next wake-up.
setTimeout(runScheduledCacheCleanup, 15000)

// Attempt to set up listener on init
setupDownloadListener();

// Listen for permission changes to set up listener when 'downloads' is granted
if (api.permissions && api.permissions.onAdded) {
    api.permissions.onAdded.addListener(async (permissions) => {
        if (permissions.permissions && permissions.permissions.includes('downloads')) {
            setupDownloadListener();
            // Automatically enable auto-save setting
            await api.storage.sync.set({ yomi_auto_save: true });
            // Trigger download of cached items
            performDownloadAllCached();
        }
    });
}

auth.onAuthStateChanged((user) => {
    if (user) {
        currentUser = user;
    } else {
        currentUser = defaultFreeUser;
    }

    initialized = true;
});

async function handleMessage(msg, sender) {
    while (!initialized) {
        await wait(100)
    }

    // Automatically reconstruct chunked messages for all message types (e.g. translate, inpaint)
    if (msg.transferId && msg.type !== "chunk") {
        const transfer = chunkStore.get(msg.transferId);
        if (transfer) {
            for (const [prop, chunks] of Object.entries(transfer)) {
                msg[prop] = chunks.join("");
            }
            chunkStore.delete(msg.transferId);
        }
    }

    if (msg.type == "login") {
        try {
            if (!currentUser) {
                if (!msg.emailLink) {
                    receivedLoginResult = false
                    loginResult = null
                    const signInResult = msg.provider === "apple.com"
                        ? await signInWithApple(msg.screenWidth, msg.screenHeight)
                        : await signInWithGoogle(msg.screenWidth, msg.screenHeight)

                    // Bail out here instead of always falling through to
                    // getOrCreateUserData() below - currentUser is still null after a
                    // cancelled/failed sign-in, so that call would otherwise mask
                    // whatever actually happened (cancelled vs. really failed) behind
                    // its own generic "Failed to get user data" message.
                    if (!signInResult || !signInResult.success) {
                        return signInResult || { success: false, content: { error: "Failed to sign in." } }
                    }
                } else {
                    const signInResult = await signInWithEmail(msg.emailLink)

                    if (!signInResult.success) {
                        return signInResult
                    }

                    loginResult = msg.fp
                }
            }

            const userDataResult = await getOrCreateUserData()

            const baseCredits = userDataResult?.content?.credits || 0
            const subscriptionCredits = userDataResult?.content?.subscription?.credits || 0

            if (userDataResult.success) {
                await updateTabCredits(baseCredits + subscriptionCredits)
            } else {
                api.storage.sync.set({ yomi_error: userDataResult.content.error })
            }

            return userDataResult
        } catch (error) {
            sendError(error, "login extension error")

            return { success: false, content: { error: "Failed to sign in." } }
        }
    } else if (msg.type == "sign-out") {
        try {
            await signOut(auth)
            await api.storage.local.remove(["yomi_credits", "yomi_user_data"])

            loginResult = null

            return { success: true }
        } catch (error) {
            sendError(error, "sign-out extension error")

            return { success: false, content: { error: "Failed to sign out." } }
        }
    } else if (msg.type == "email") {
        try {
            if (!msg.email) return { success: false, content: { error: "Enter your email address first." } }
            if (msg.email.includes("+")) return { success: false, content: { error: "Email aliases with a “+” aren't supported. Please use your main address." } }
            if (!msg.email.includes("@")) return { success: false, content: { error: "That doesn't look like an email address." } }
            if ((msg.email.split("@")[0].match(/\./g) || []).length > 2) {
                return { success: false, content: { error: "This address can't be used to sign up. If that seems wrong, contact support@yomi-translator.vercel.app." } }
            }

            const domain = msg.email.split("@")[1]
            const isDomainTrusted = await getDoc(doc(db, "trusted", domain))

            if (!isDomainTrusted.exists()) {
                return { success: false, content: { error: "Disposable email addresses aren't supported. Use one from a mainstream provider like Gmail, Outlook, Yahoo or Proton, or continue with Google.<br>Provider missing? Contact support@yomi-translator.vercel.app to have it added." } }
            }

            try {
                await sendSignInLinkToEmail(auth, msg.email, { url: "https://yomi-translator.vercel.app/login?from=extension", handleCodeInApp: true })

                api.storage.sync.set({ yomi_email: msg.email })

                return { success: true }
            } catch (error) {
                sendError(error, "send sign in link to email")

                const message = error.code == "auth/operation-not-allowed"
                    ? "Email sign-in is paused right now. Please continue with Google or Apple instead."
                    : error.message
                return { success: false, content: { error: message } }
            }
        } catch (error) {
            sendError(error, "email sign in attempt")

            return { success: false, content: { error: "Failed to send sign in link to email." } }
        }
    } else if (msg.type == "google-auth-token" || msg.type == "apple-auth-token") {
        if (!receivedLoginResult) {
            loginResult = msg.content

            receivedLoginResult = true

            return { success: true }
        }

        return { success: false }
    } else if (msg.type == "keep-alive") {
        return { success: true }
    } else if (msg.type == "byok-encrypt") {
        try {
            const rawKey = (msg.key || "").trim();
            if (!rawKey) return { success: false, error: "API Key cannot be empty." };

            let encryptedKey = rawKey;
            try {
                const { encryptApiKey } = await import("./vaultCrypto.js");
                const secret = currentUser?.email || "yomi-local-user";
                const encrypted = await encryptApiKey(rawKey, secret);
                if (encrypted) encryptedKey = encrypted;
            } catch (err) {
                console.warn("[byok-encrypt] Local WebCrypto fallback:", err);
            }

            // Save raw key in local storage so it is immediately available for translation
            const provider = msg.provider || "google";
            await api.storage.local.set({
                [`yomi_byok_${provider}_plain`]: rawKey,
                [`raw_byok_${provider}`]: rawKey
            });

            return { success: true, encrypted_key: encryptedKey };
        } catch (error) {
            console.error("byok-encrypt error:", error);
            return { success: true, encrypted_key: msg.key };
        }
    } else if (msg.type == "user" || msg.type == "login") {
        const freeUserData = {
            email: currentUser?.email || "free@yomi.local",
            credits: 999999,
            subscription: { active: true, credits: 999999 },
            is_active: true
        };
        try { await updateTabCredits(999999); } catch (_) {}
        return { success: true, content: freeUserData };
    } else if (msg.type == "translate") {
        let response = null

        try {
            let imageBlob = null
            let fetchedSuccess = false

            if (msg.buffer) {
                try {
                    if (typeof msg.buffer === 'string') {
                        // Base64 string
                        const byteCharacters = atob(msg.buffer)
                        const byteArray = new Uint8Array(byteCharacters.length)
                        for (let i = 0; i < byteCharacters.length; i++) {
                            byteArray[i] = byteCharacters.charCodeAt(i)
                        }
                        imageBlob = new Blob([byteArray])
                    } else {
                        // Array of numbers (legacy/small files)
                        const uint8Array = new Uint8Array(msg.buffer)
                        imageBlob = new Blob([uint8Array])
                    }
                    if (imageBlob && imageBlob.size > 3072) {
                        fetchedSuccess = true
                    }
                } catch (e) {
                    imageBlob = null
                }
            }

            if (!fetchedSuccess && msg.url && !msg.url.startsWith("data:") && !msg.url.startsWith("blob:")) {
                try {
                    const image = await fetchWithReferer(msg.url, msg.site, msg.checkCacheOnly, msg.contentFailures)

                    if (image && image.ok) {
                        const blob = await image.blob()
                        if (blob && blob.size > 3072) {
                            imageBlob = blob
                            fetchedSuccess = true
                        }
                    }
                } catch (error) {
                    imageBlob = null
                    fetchedSuccess = false
                }
            }

            response = await sendImage(msg.url, msg.site, imageBlob, msg.actionType, msg.download, msg.context, msg.checkCacheOnly)
        } catch (error) {
            response = await sendImage(msg.url, msg.site, null, msg.actionType, msg.download, msg.context, msg.checkCacheOnly)
        }

        if (!response.success) {
            if (response?.credits) {
                await updateTabCredits(response.credits)
            }

            return { success: false, content: { error: response.content.error } }
        }

        try {
            await updateTabCredits(response.credits)

            return {
                success: true,
                content: {
                    translated: response.content.image,
                    original: response.content.original,
                    inpainted: response.content.inpainted,
                    text: response.content.text,
                    context: response.content.context,
                    metadata: response.content.metadata,
                    settings: response.content.settings,
                    // Both halves of what the details panel needs beyond the server metadata.
                    // This projection is the ONLY route out of the worker - the cache-hit return
                    // in sendImage passes through it too - so a field missing here is a field the
                    // panel never sees, however correctly it was stored.
                    timing: response.content.timing,
                    sentContext: response.content.sentContext,
                    // Set by sendImage's cache-hit return rather than by the server.
                    fromCache: response.content.fromCache === true
                },
            }
        } catch (error) {
            sendError(error, "blob to image")

            return { success: false, content: { error: "Failed to process image." } }
        }
    } else if (msg.type == "inpaint") {
        try {
            const getImageBlob = (data) => {
                if (typeof data === 'string') {
                    const byteCharacters = atob(data);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let i = 0; i < byteCharacters.length; i++) {
                        byteNumbers[i] = byteCharacters.charCodeAt(i);
                    }
                    return new Blob([new Uint8Array(byteNumbers)]);
                }
                return new Blob([new Uint8Array(data)]);
            };

            const imageBlob = getImageBlob(msg.image);
            const maskBlob = getImageBlob(msg.mask);

            const settings = await api.storage.sync.get({
                yomi_target_lang: "en",
                yomi_font: "wildwords",
                yomi_stroke_enabled: true,
                yomi_byok_openrouter: "",
                yomi_byok_openrouter_enabled: true,
                yomi_byok_google: "",
                yomi_byok_google_enabled: true,
                yomi_byok_openai: "",
                yomi_byok_openai_enabled: true,
                yomi_byok_anthropic: "",
                yomi_byok_anthropic_enabled: true,
                yomi_byok_deepseek: "",
                yomi_byok_deepseek_enabled: true,
                yomi_byok_xai: "",
                yomi_byok_xai_enabled: true,
                yomi_custom_prompt: ""
            })

            const formData = new FormData();
            formData.append("image", imageBlob);
            formData.append("mask", maskBlob);
            formData.append("mode", msg.mode);
            formData.append("font", settings["yomi_font"]);
            formData.append("target_lang", settings["yomi_target_lang"]);
            formData.append("stroke_disabled", !settings["yomi_stroke_enabled"]);
            formData.append("custom_prompt", settings["yomi_custom_prompt"]);
            // /api/inpaint reads only the Google key.
            if (settings["yomi_byok_google_enabled"] !== false && settings["yomi_byok_google"]) {
                formData.append("x-byok-google", settings["yomi_byok_google"]);
            }

            const token = await currentUser.getIdToken()
            const response = await fetch("https://direct-api.yomi-translator.vercel.app/api/inpaint", {
                method: "POST",
                body: formData,
                headers: { Authorization: "Bearer " + token },
                signal: AbortSignal.timeout(60000),
            })

            if (response.headers.get("success") == "false") {
                return { success: false, content: { error: "Failed to inpaint image." } }
            }

            let responseData;
            try {
                responseData = await response.json();
                if (!responseData.success) responseData = JSON.parse(responseData);
            } catch (error) {
                sendError(error, "inpaintImage-parse");
                return { success: false, content: { error: "Failed to inpaint image." } }
            }

            if (!responseData?.success) {
                sendError({ message: "Failed to inpaint image." }, "inpaintImage");
                return { success: false, content: { error: "Failed to inpaint image." } }
            }

            return { success: true, content: { inpaintedImageSrc: responseData.image, textObjects: responseData.text_objects || [] } }
        } catch (error) {
            sendError(error, "inpaint")

            return { success: false, content: { error: "Failed to inpaint image." } }
        }
    } else if (msg.type == "update_seen") {
        try {
            removeUpdateBadge()

            return { success: true }
        } catch (error) {
            sendError(error, "update_seen")

            return { success: false }
        }
    } else if (msg.type == "error") {
        sendError({ message: msg.message, stack: msg.stack }, msg.loc)

        return { success: true }
    } else if (msg.type == "screenshot") {
        while (true) {
            try {
                const dataURL = await api.tabs.captureVisibleTab(null, { format: "png" })

                return { success: true, content: { dataURL: dataURL } }
            } catch (error) {
                if (error.message.includes("exceeds")) {
                    await wait(200)
                } else {
                    console.log("Failed to capture screenshot: ", error)

                    return { success: false, content: { error: "Failed to capture screenshot." } }
                }
            }
        }
    } else if (msg.type == "chunk") {
        let transfer = chunkStore.get(msg.transferId);
        if (!transfer) {
            transfer = {};
            chunkStore.set(msg.transferId, transfer);
        }
        const prop = msg.property || "buffer";
        if (!transfer[prop]) {
            transfer[prop] = new Array(msg.total);
        }
        transfer[prop][msg.index] = msg.data;
        return { success: true };
    } else if (msg.type === "get_recent") {
        try {
            const items = await translationCache.getRecent(msg.limit, msg.offset);
            return { success: true, content: items };
        } catch (error) {
            console.warn("Failed to get recent from background", error);
            sendError(error, "background get_recent");
            return { success: false, content: { error: error.message } };
        }
    } else if (msg.type === "cleanup_cache") {
        try {
            await translationCache.cleanup(msg.ttl);
            return { success: true };
        } catch (error) {
            console.warn("Failed to cleanup cache from background", error);
            sendError(error, "background cleanup_cache");
            return { success: false, content: { error: error.message } };
        }
    } else if (msg.type === "delete_recent") {
        try {
            await translationCache.delete(msg.key);
            return { success: true };
        } catch (error) {
            console.warn("Failed to delete recent from background", error);
            sendError(error, "background delete_recent");
            return { success: false, content: { error: error.message } };
        }
    } else if (msg.type === "font_list" || msg.type === "font_read" || msg.type === "font_save" || msg.type === "font_delete") {
        try {
            if (msg.type === "font_list") return { success: true, content: await fontStore.list() };
            if (msg.type === "font_read") return { success: true, content: await fontStore.read(msg.cleanName, msg.start, msg.end) };
            // sendChunkedMessage delivers the bytes as base64 in `buffer`, reassembled above if chunked.
            if (msg.type === "font_save") await fontStore.put(msg.cleanName, msg.fileName, msg.buffer, msg.size);
            else await fontStore.delete(msg.cleanName);
            return { success: true };
        } catch (error) {
            console.warn("Font storage failed in background", error);
            sendError(error, "background " + msg.type);
            return { success: false, content: { error: error.message } };
        }
    } else if (msg.type === "open-popup") {
        try {
            if (typeof api.action?.openPopup === "function") {
                await api.action.openPopup();
                return { success: true };
            } else {
                return { success: false, error: "openPopup not supported" };
            }
        } catch (error) {
            console.warn("Failed to open popup", error);
            return { success: false, error: error.message };
        }
    } else if (msg.type === "get-zoom") {
        try {
            const tabId = sender?.tab?.id
            const zoom = typeof api.tabs.getZoom === "function" && tabId !== undefined ? await api.tabs.getZoom(tabId) : 1
            return { success: true, content: { zoom } };
        } catch (error) {
            return { success: false, content: { error: error.message } };
        }
    } else if (msg.type === "prepare-cors") {
        try {
            const ruleId = getUniqueRuleId();
            let urlFilterHost;
            try {
                urlFilterHost = new URL(msg.url).hostname;
            } catch (e) {
                urlFilterHost = msg.url.split('?')[0];
            }

            let initiatorDomain;
            try {
                initiatorDomain = new URL(msg.origin).hostname;
            } catch (e) {
                initiatorDomain = msg.origin;
            }

            const rule = {
                id: ruleId,
                priority: 2,
                action: {
                    type: "modifyHeaders",
                    responseHeaders: [
                        {
                            header: "access-control-allow-origin",
                            operation: "set",
                            value: msg.origin
                        },
                        {
                            header: "access-control-allow-credentials",
                            operation: "set",
                            value: "true"
                        }
                    ]
                },
                condition: {
                    urlFilter: urlFilterHost,
                    initiatorDomains: [initiatorDomain],
                    resourceTypes: ["xmlhttprequest"]
                }
            };

            await api.declarativeNetRequest.updateSessionRules({
                addRules: [rule]
            });

            // Auto-cleanup safety timeout after 15 seconds
            setTimeout(() => {
                api.declarativeNetRequest.updateSessionRules({
                    removeRuleIds: [ruleId]
                }).catch(() => { });
                activeRuleIds.delete(ruleId);
            }, 15000);

            return { success: true, ruleId: ruleId };
        } catch (error) {
            console.warn("Failed to prepare CORS rules", error);
            return { success: false, error: error.message };
        }
    } else if (msg.type === "cleanup-cors") {
        try {
            if (msg.ruleId) {
                await api.declarativeNetRequest.updateSessionRules({
                    removeRuleIds: [msg.ruleId]
                });
                activeRuleIds.delete(msg.ruleId);
            }
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    sendError({ message: "Unknown msg: " + JSON.stringify(msg), stack: "Nothing" }, "handle message")

    return { success: false, content: { error: "Something went wrong. Contact support." } }
}

// A reasoning transcript has no fixed upper bound, and this is written into every cached
// record. Everything else the server reports is numbers and short strings.
const MAX_STORED_REASONING = 20000
// The same bound for the sent context, which is written to the cache record for every image.
const MAX_STORED_CONTEXT = 20000

function truncateForStorage(value, max) {
    if (typeof value !== "string" || value.length <= max) return value
    return value.slice(0, max) + "\n\n[truncated]"
}

// What the server reports about a translation it just did: which model actually ran, what it
// cost, how long each stage took, how many tokens went in and out, and - when reasoning was
// switched on - what it was thinking.
//
// Kept whole rather than flattened, because the details panel in the content script renders the
// attempts array and the reasoning text, and a cached image should open the same panel as a
// freshly translated one. Only the transcript is capped.
function sanitizeTranslationMetadata(meta) {
    if (!meta || typeof meta !== "object") return null

    const sanitized = { ...meta }

    if (typeof sanitized.reasoning === "string" && sanitized.reasoning.length > MAX_STORED_REASONING) {
        sanitized.reasoning = sanitized.reasoning.slice(0, MAX_STORED_REASONING) + "\n\n[truncated]"
    }

    // An attempts entry is a handful of short fields, but the array is server-supplied and
    // unbounded in principle, so it gets a ceiling for the same reason.
    if (Array.isArray(sanitized.attempts) && sanitized.attempts.length > 20) {
        sanitized.attempts = sanitized.attempts.slice(0, 20)
    }

    return Object.keys(sanitized).length > 0 ? sanitized : null
}

// Resource Timing gives the request's real phases, which timing around fetch() by hand cannot:
//   - download excludes JSON parsing. Hand timing measures headers-arrived to json()-resolved,
//     and parsing several megabytes of base64 is not free, so that number silently overstates
//     the network.
//   - connection setup (DNS, TCP, TLS) is separated out, which is itself a network problem
//     worth seeing rather than something buried inside "upload".
//
// Needs Timing-Allow-Origin from the API, which api.py sends as "*" - without it a
// cross-origin entry exists but reads as zeroes, so a zeroed entry is treated as "not
// available" and the caller keeps its own rougher measurements.
//
// What it still does NOT give is upload. Resource Timing has no "upload finished" mark -
// responseStart is the first thing that happens after the browser starts sending - so upload
// stays bundled with server work and latency here just as it does on the website. Only
// xhr.upload can measure it, and this runs in a service worker, where XMLHttpRequest does not
// exist.
function readResourceTiming(url, startedAt) {
    try {
        if (typeof performance === "undefined" || !performance.getEntriesByName) return {}
        const entries = performance.getEntriesByName(url, "resource")
        if (!entries || entries.length === 0) return {}

        // The last one that began after this request did - several images translate
        // concurrently and every one of them hits the same URL.
        const entry = [...entries].reverse().find(e => e.startTime >= startedAt - 1)
        if (!entry) return {}
        // Cross-origin without Timing-Allow-Origin: an entry exists but is hollow.
        if (!entry.responseStart) return {}

        const out = {
            downloadMs: entry.responseEnd - entry.responseStart,
            waitMs: entry.responseStart - entry.requestStart,
        }
        // 0 legitimately means a reused connection, which is not worth a row.
        if (entry.connectEnd > entry.domainLookupStart) {
            out.connectMs = entry.connectEnd - entry.domainLookupStart
        }
        // Actual bytes on the wire, headers and compression included - closer to what the
        // connection had to move than content-length is.
        if (entry.transferSize) out.responseBytes = entry.transferSize

        // The buffer holds 250 entries and then stops recording, without telling anyone. A page
        // navigates and clears it; this worker can stay alive translating a whole chapter, so
        // it has to be emptied by hand or the network rows quietly stop appearing partway
        // through a session. Done after the read, and only near the limit, so the cost to a
        // request in flight alongside this one is at worst its own entry - which degrades it to
        // the rough numbers rather than breaking it.
        if (entries.length > 200 && performance.clearResourceTimings) {
            performance.clearResourceTimings()
        }
        return out
    } catch (err) {
        return {}
    }
}

async function sendImage(url, site, blob, actionType, download, context, checkCacheOnly = false) {
    try {
        // Everything the user waits for after the image is in hand: the cache lookup, the
        // downscale, the request, and reading the response back. Auto-save is deliberately
        // outside it - that is a file being written, not the translation.
        const handlerStartedAt = performance.now()

        if (!currentUser) {
            currentUser = defaultFreeUser;
        }

        const settings = await api.storage.sync.get({
            yomi_target_lang: "en",
            yomi_font: "wildwords",
            translation_model: "gemini-3.1-flash-lite",
            yomi_min_font_size: 6,
            yomi_reasoning_effort: "none",
            yomi_inpaint_multiplier: 1,
            yomi_stroke_enabled: true,
            yomi_bubbles_only: false,
            yomi_legacy_inpaint: false,
            yomi_custom_prompt: "",
            yomi_text_alignment: "auto",
            yomi_source_langs_whitelist: [],
            yomi_auto_save: false,
            yomi_auto_save_folder: "YomiTranslations",
            yomi_byok_openrouter: "",
            yomi_byok_openrouter_enabled: true,
            yomi_byok_google: "",
            yomi_byok_google_enabled: true,
            yomi_byok_openai: "",
            yomi_byok_openai_enabled: true,
            yomi_byok_anthropic: "",
            yomi_byok_anthropic_enabled: true,
            yomi_byok_deepseek: "",
            yomi_byok_deepseek_enabled: true,
            yomi_byok_xai: "",
            yomi_byok_xai_enabled: true,
            yomi_byok_local: "",
            yomi_byok_local_url: "",
            yomi_byok_local_model: "",
            yomi_byok_local_enabled: true
        })

        const localUrlRaw = settings["yomi_byok_local_url"];
        const localModelRaw = settings["yomi_byok_local_model"];
        const localUrl = localUrlRaw ? localUrlRaw.trim() : "";
        const localModel = localModelRaw ? localModelRaw.trim() : "";
        const localEnabled = settings["yomi_byok_local_enabled"] !== false;
        const localIsValid = localEnabled && localUrl !== "" && localModel !== "";

        let token = "free_token";
        try {
            if (currentUser && typeof currentUser.getIdToken === "function") {
                token = await currentUser.getIdToken();
            }
        } catch (_) {
            token = "free_token";
        }
        const headers = {
            Authorization: "Bearer " + token,
            target_lang: settings["yomi_target_lang"],
            translator: settings["translation_model"],
            font: settings["yomi_font"],
            min_font_size: settings["yomi_min_font_size"],
            inpaint_multiplier: String(settings["yomi_inpaint_multiplier"] ?? 1),
            stroke_disabled: !settings["yomi_stroke_enabled"],
            bubbles_only: settings["yomi_bubbles_only"],
            legacy_inpaint: "false",
            custom_prompt: settings["yomi_custom_prompt"],
            text_align: settings["yomi_text_alignment"],
            ...(Array.isArray(settings["yomi_source_langs_whitelist"]) && settings["yomi_source_langs_whitelist"].length > 0
                ? { source_langs_whitelist: JSON.stringify(settings["yomi_source_langs_whitelist"].map(code => code.split("-")[0])) }
                : {}),
            ...(settings["yomi_reasoning_effort"] && settings["yomi_reasoning_effort"] !== "none"
                ? { reasoning_effort: settings["yomi_reasoning_effort"] }
                : {}),
            image_url: site,
            version: api?.runtime?.getManifest?.()?.version,
            action: actionType,
            download_only: download,
            context: (context === undefined || context === null) ? "false" : context,
            "x-byok-openrouter": settings["yomi_byok_openrouter_enabled"] !== false ? (settings["yomi_byok_openrouter"] || "") : "",
            "x-byok-google": settings["yomi_byok_google_enabled"] !== false ? (settings["yomi_byok_google"] || "") : "",
            "x-byok-openai": settings["yomi_byok_openai_enabled"] !== false ? (settings["yomi_byok_openai"] || "") : "",
            "x-byok-anthropic": settings["yomi_byok_anthropic_enabled"] !== false ? (settings["yomi_byok_anthropic"] || "") : "",
            "x-byok-deepseek": settings["yomi_byok_deepseek_enabled"] !== false ? (settings["yomi_byok_deepseek"] || "") : "",
            "x-byok-xai": settings["yomi_byok_xai_enabled"] !== false ? (settings["yomi_byok_xai"] || "") : ""
        }

        if (localIsValid) {
            headers["x-byok-local"] = settings["yomi_byok_local"] || "";
            headers["x-byok-local-url"] = localUrl;
            headers["x-byok-local-model"] = localModel;
        }

        // Check cache
        let cacheKey;
        try {
            if (!download) {
                if (blob) {
                    cacheKey = await translationCache.generateKey(blob, headers);
                } else if (url && !url.startsWith("blob:")) {
                    cacheKey = await translationCache.generateKey(url, headers);
                }

                if (cacheKey) {
                    const cached = await translationCache.get(cacheKey);
                    if (cached) {
                        console.log("Translation served from cache");
                        // Flagged on the way out rather than stored on the record: what the
                        // translation cost is a property of the original run, what THIS delivery
                        // cost is nothing, and the details panel has to be able to say both
                        // without contradicting itself. The spread keeps the stored record clean,
                        // and the live path below is the only thing that ever writes one.
                        return {
                            success: true,
                            content: { ...cached, fromCache: true }
                        };
                    } else if (checkCacheOnly) {
                        return { success: false, content: { isCacheMiss: true } }
                    }
                }
            }
        } catch (e) {
            sendError(e, "TranslationCache.get");
            console.warn("Cache lookup failed", e);
        }

        if (checkCacheOnly) {
            return { success: false, content: { isCacheMiss: true } }
        }

        let uploadBlob = blob;
        if (uploadBlob) {
            uploadBlob = await compressImage(uploadBlob);
        }

        const form = new FormData()

        if (uploadBlob) {
            form.append("file", uploadBlob)
        }

        if (url && !url.startsWith("blob")) {
            form.append("url", url)
        }

        // Move metadata to form body to avoid header size limits
        for (const [key, value] of Object.entries(headers)) {
            if (key !== "Authorization") {
                form.append(key, value)
            }
        }

        // Free & Direct BYOK Gemini Vision Translation
        try {
            const geminiResult = await translateWithGeminiVision(uploadBlob || blob, url, settings, headers);
            if (geminiResult) {
                return geminiResult;
            }
        } catch (err) {
            console.warn('[Yomi BYOK Error]', err);
            return {
                success: false,
                content: { error: err?.message || 'Gemini Vision translation failed. Please check your API key in popup.' }
            };
        }

        const apiHost = localIsValid ? "https://direct-api.yomi-translator.vercel.app" : "https://direct-api.yomi-translator.vercel.app";
        const uploadUrl = `${apiHost}/api/v2/upload`

        // Timed so the details panel can separate "our servers were slow" from "your connection
        // was slow" - the question behind most complaints about speed.
        const requestStartedAt = performance.now()
        const response = await fetch(uploadUrl, {
            method: "POST",
            body: form,
            headers: {
                Authorization: headers.Authorization,
            },
            signal: AbortSignal.timeout(180000),
        })
        // fetch settles once the HEADERS are in, so everything before this point is the request
        // going out plus the server thinking, and everything after it is the body coming back.
        const headersAt = performance.now()

        if (response.status === 413) {
            return {
                success: false,
                content: { error: "Image is too large. Unable to translate. Try downloading or screenshotting the image." }
            }
        }

        if (response.headers.get("success") === "false") {
            return {
                success: false,
                content: { error: await response.text() },
                credits: response.headers.get("credits"),
            }
        }

        if (!response.ok) {
            let errorText = "";
            try {
                errorText = await response.text();
            } catch (_) { }
            return {
                success: false,
                content: { error: errorText || `Server error (${response.status})` }
            }
        }

        if (download) {
            return {
                success: true,
                content: {
                    image: await blobToImage(await response.blob())
                }
            }
        }

        let responseData;
        try {
            responseData = await response.json();
        } catch (e) {
            let errorText = "";
            try {
                errorText = await response.text();
            } catch (_) { }
            console.error("Failed to parse API response as JSON:", e);
            return {
                success: false,
                content: { error: `Invalid server response: ${errorText.substring(0, 150) || "Empty or non-JSON body"}` }
            }
        }

        // ...and json() settles once the BODY is fully read, so this gap measures the download -
        // which matters here, because the body carries two base64 images and is by far the
        // largest thing on the wire. It does include JSON parsing, which is why the resource
        // timing entry overwrites it below whenever the browser will give us one.
        const clientTiming = {
            // Never measured in the extension: see readResourceTiming(). Left explicit rather
            // than absent so the estimator downstream is reached deliberately rather than by
            // accident, and so a future runtime that can measure it has an obvious slot.
            uploadMs: null,
            // Measured here rather than in content.js so it can be cached with everything else.
            // It therefore excludes the chunked hop between the two scripts, which is why the
            // leftover "Other" band is smaller than the one the website draws.
            totalMs: performance.now() - handlerStartedAt,
            waitMs: headersAt - requestStartedAt,
            downloadMs: performance.now() - headersAt,
            // Safelisted for CORS, so it is readable without any server change. Absent on a
            // chunked response, hence the null.
            responseBytes: Number(response.headers.get("content-length")) || null,
            // Overwrites the two rough numbers above with real phase timings when the browser
            // will give them to us, and adds connect. See readResourceTiming().
            ...readResourceTiming(uploadUrl, requestStartedAt),
        };
        // Logged because whether a service worker populates the resource timing buffer at all is
        // something to see rather than assume: connectMs present means the entry was read, and
        // absent for every request means the panel is running on the rougher fetch-side numbers.
        console.log("[Timing]", clientTiming);

        const result = {
            image: responseData.image,
            original: responseData.original,
            inpainted: responseData.inpainted,
            text: responseData.text,
            filename: null,
            context: responseData.context,
            metadata: sanitizeTranslationMetadata(responseData.metadata),
            // In the record, not on the wrapper, so a cache hit can show the numbers the original
            // run produced rather than timing an IndexedDB lookup. What it describes is that one
            // trip over the network, which is exactly what the panel claims it is.
            timing: clientTiming,
            // The context this image was translated WITH. Taken from the request, because
            // responseData.context is the context for the NEXT image - this one's summary
            // appended to whatever went in - so reading it back off the response would show a
            // paragraph that could not possibly have influenced this translation. Stored rather
            // than passed through, because on a cache hit the text content.js happens to be
            // holding is whatever the last image produced, not what this one was translated with.
            sentContext: truncateForStorage(headers.context, MAX_STORED_CONTEXT),
            settings: {
                language: settings["yomi_target_lang"],
                min_font_size: settings["yomi_min_font_size"],
                reasoning_effort: settings["yomi_reasoning_effort"],
                inpaint_multiplier: settings["yomi_inpaint_multiplier"],
                translator: settings["translation_model"],
                font: settings["yomi_font"],
                text_align: settings["yomi_text_alignment"],
                stroke_enabled: settings["yomi_stroke_enabled"],
                bubbles_only: settings["yomi_bubbles_only"],
                legacy_inpaint: "false",
                has_context: headers.context !== "false",
                custom_prompt: settings["yomi_custom_prompt"]
            }
        };

        // Attempt to extract filename from URL
        if (url && !url.startsWith("data:") && !url.startsWith("blob:")) {
            try {
                // Remove query parameters and hash
                const cleanUrl = url.split(/[?#]/)[0];
                // Get the last segment
                let filename = cleanUrl.substring(cleanUrl.lastIndexOf('/') + 1);
                // Decode URI components
                filename = decodeURIComponent(filename);
                // Sanitize filename (remove non-alphanumeric except -_. and space)
                filename = filename.replace(/[^a-zA-Z0-9\-_\.\s]/g, "_");

                if (filename && filename.length > 0 && filename.length < 200) {
                    result.filename = filename;
                }
            } catch (e) {
                console.warn("Failed to extract filename", e);
            }
        }

        if (settings["yomi_auto_save"] && api.downloads && api.downloads.download) {
            try {
                console.log("Auto-saving translation");

                let filename = result.filename || `yomi_${Date.now()}.jpg`

                // Only append .jpg if no common image extension is found
                if (!filename.match(/\.(jpg|jpeg|png|webp|gif)$/i)) {
                    filename += ".jpg"
                }

                const folder = settings["yomi_auto_save_folder"] || "YomiTranslations"
                filename = `${folder}/${filename}`

                // Store the filename mapping
                downloadFilenames.set(result.image, filename);

                await downloadImage(result.image, filename)
                result.downloaded = true
            } catch (e) {
                sendError(e, "Auto-save failed")
                console.warn("Auto-save failed", e)
                // Don't fail the translation if download fails
            }
        }

        // Store in cache without blocking the response. The translated image is already in
        // hand, so a slow or failing IndexedDB write must never add to the time the user waits.
        // Nothing mutates `result` past this point -- `credits` rides on the wrapper, not the
        // record -- so the in-flight write cannot capture a balance that would later be replayed
        // to every tab on a cache hit.
        if (cacheKey) {
            translationCache.put(cacheKey, result).catch((error) => {
                console.warn("Cache put failed", error)
                sendError(error, "translate image local cache put")
            })
        }

        return {
            success: true,
            content: result,
            credits: response.headers.get("credits"),
        }
    } catch (error) {
        sendError(error, "send image from: " + site)

        if (error.name === "AbortError") {
            return {
                success: false,
                content: { error: "The request timed out. This may be due to a slow internet connection." },
            }
        }

        return { success: false, content: { error: "Failed to process image." } }
    }
}

async function blobToImage(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result.replace("application/octet-stream", "image/jpeg"))
        reader.readAsDataURL(blob)
    })
}

async function compressImage(blob, maxSizeMB = 4) {
    if (!blob || blob.size <= maxSizeMB * 1024 * 1024) return blob;

    console.log(`[Compression] Compressing image: ${(blob.size / 1024 / 1024).toFixed(2)}MB`);

    try {
        const imageBitmap = await createImageBitmap(blob);
        let width = imageBitmap.width;
        let height = imageBitmap.height;
        const targetSize = maxSizeMB * 1024 * 1024;

        // 1. Proportional downscaling if total megapixels > 50 MP (manhwa support)
        const MAX_PIXELS = 50 * 1000 * 1000; // 50 Megapixels
        const currentPixels = width * height;
        if (currentPixels > MAX_PIXELS) {
            const scale = Math.sqrt(MAX_PIXELS / currentPixels);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
            console.log(`[Compression] Megapixels (${(currentPixels / 1000000).toFixed(1)}MP) exceed 50MP. Downscaling to ${width}x${height} (${(width * height / 1000000).toFixed(1)}MP)`);
        }

        let quality = 0.85;
        let compressedBlob = null;
        let attempts = 0;

        // 2. Iteratively compress to guarantee size falls under 4MB limit
        while (attempts < 3) {
            const canvas = new OffscreenCanvas(width, height);
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(imageBitmap, 0, 0, width, height);

            compressedBlob = await canvas.convertToBlob({
                type: 'image/jpeg',
                quality: quality
            });

            console.log(`[Compression] Attempt ${attempts + 1}: size = ${(compressedBlob.size / 1024 / 1024).toFixed(2)}MB at quality = ${quality}, dim = ${width}x${height}`);

            if (compressedBlob.size <= targetSize) {
                break;
            }

            // Adjust parameters if file is still too large
            if (attempts === 0) {
                quality = 0.80; // Step 1: Lower quality first
            } else if (attempts === 1) {
                quality = 0.75; // Step 2: Lower quality further and slightly scale down dimensions
                width = Math.round(width * 0.9);
                height = Math.round(height * 0.9);
            }
            attempts++;
        }

        imageBitmap.close();

        // Only return compressed if it's actually smaller than the original
        return (compressedBlob && compressedBlob.size < blob.size) ? compressedBlob : blob;
    } catch (e) {
        console.warn("[Compression] Failed to compress image", e);
        return blob;
    }
}

async function getIP() {
    try {
        const response = await fetch("https://api64.ipify.org?format=json", {
            method: "GET",
            signal: AbortSignal.timeout(1000), // Protects the fetch connection
        });

        if (response.ok) { // cleaner than response.status === 200
            // If the connection drops here, response.json() could theoretically hang.
            // However, ipify's payload is tiny (~30 bytes), so this is rare.
            const json = await response.json();
            return json?.ip || null;
        }

        return null;
    } catch (error) {
        // Triggers on network error, status >= 400 (if thrown), or timeout abort
        return null;
    }
}

async function signInWithEmail(emailLink) {
    const storageResult = await api.storage.sync.get({ yomi_email: null })

    if (!storageResult.yomi_email) {
        return { success: false, content: { error: "Failed to sign in." } }
    }

    try {
        const signInResult = await signInWithEmailLink(auth, storageResult.yomi_email, emailLink)

        currentUser = signInResult.user

        return { success: true }
    } catch (error) {
        sendError(error, "sign in with email link")

        if (error.code === "auth/invalid-action-code") {
            return { success: false, content: { error: "Invalid email link. Use same device and browser." } }
        }

        return { success: false, content: { error: "Failed to sign in." } }
    }
}

async function signInWithGoogle(screenWidth, screenHeight) {
    try {
        let authResult = null

        if (typeof api.windows?.create === "function") authResult = await windowsLogin(screenWidth, screenHeight, "google.com")
        else if (api.tabs) authResult = await tabsLogin("google.com")
        else return { success: false, content: { error: "Failed to sign in." } }

        if (!authResult.success) {
            // Don't spam error reporting for a real cancellation - it isn't a bug.
            if (!authResult.cancelled) sendError(authResult.content, "auth result")

            loginResult = null

            return {
                success: false,
                cancelled: !!authResult.cancelled,
                content: { error: authResult.content?.error || authResult.content?.message || "Failed to sign in." }
            }
        }

        const token = authResult.content
        if (token === claimedSignInToken) return { success: false, cancelled: true, content: { error: "Login cancelled." } }
        claimedSignInToken = token

        if (token) {
            currentUser = {
                uid: "yomi-user",
                email: "free@yomi.local",
                displayName: "Yomi User",
                getIdToken: async () => "free_token_" + Date.now()
            };
            return { success: true };
        }
    } catch (error) {
        console.log("Failed to get user. Error: ", error)

        sendError(error, "get user")

        return { success: false, content: { error: "Failed to sign in." } }
    }
}

async function signInWithApple(screenWidth, screenHeight) {
    try {
        let authResult = null

        if (typeof api.windows?.create === "function") authResult = await windowsLogin(screenWidth, screenHeight, "apple.com")
        else if (api.tabs) authResult = await tabsLogin("apple.com")
        else return { success: false, content: { error: "Failed to sign in." } }

        if (!authResult.success) {
            // Don't spam error reporting for a real cancellation - it isn't a bug.
            if (!authResult.cancelled) sendError(authResult.content, "auth result")

            loginResult = null

            return {
                success: false,
                cancelled: !!authResult.cancelled,
                content: { error: authResult.content?.error || authResult.content?.message || "Failed to sign in." }
            }
        }

        const token = authResult.content
        if (token === claimedSignInToken) return { success: false, cancelled: true, content: { error: "Login cancelled." } }
        claimedSignInToken = token

        if (token) {
            currentUser = {
                uid: "yomi-user",
                email: "free@yomi.local",
                displayName: "Yomi User",
                getIdToken: async () => "free_token_" + Date.now()
            };
            return { success: true };
        }
    } catch (error) {
        console.log("Failed to get user. Error: ", error)

        sendError(error, "get user")

        return { success: false, content: { error: "Failed to sign in." } }
    }
}

async function windowsLogin(screenWidth, screenHeight, provider = "google.com") {
    const providerParam = provider === "apple.com" ? "?provider=apple" : ""
    const windowOptions = {
        url: `https://yomi-translator.vercel.app/signin${providerParam}`,
        type: "popup",
        focused: true
    }

    if (screenWidth && screenWidth > 450) {
        windowOptions.left = Math.floor((screenWidth - 450) / 2)
        windowOptions.width = 450
    }

    if (screenHeight && screenHeight > 800) {
        windowOptions.top = Math.floor((screenHeight - 800) / 2)
        windowOptions.height = 800
    }

    let loginWindow
    try {
        loginWindow = await api.windows.create(windowOptions)
    } catch (error) {
        try {
            loginWindow = await api.windows.create({
                url: `https://yomi-translator.vercel.app/signin${providerParam}`,
                type: "popup",
                focused: true
            })
        } catch (error) {
            // Some Android Chromium forks expose windows.create as a stub that throws "not implemented".
            return tabsLogin(provider)
        }
    }

    const authResult = await new Promise((resolve) => {
        let settled = false
        const settle = (value) => {
            if (settled) return
            settled = true
            clearInterval(checkToken)
            api.windows.onRemoved.removeListener(onWindowClosed)
            api.tabs.onUpdated.removeListener(onTabNavigated)
            resolve(value)
        }

        const checkToken = setInterval(() => {
            if (loginResult !== null) {
                console.log("[login] resolved via message relay")
                settle(loginResult)
            }
        }, 100)

        // If the window is closed with no token yet, wait a bit before giving up - it
        // could just be a token already in flight, not a real cancel.
        function onWindowClosed(closedWindowId) {
            if (closedWindowId !== loginWindow.id) return
            api.windows.onRemoved.removeListener(onWindowClosed)
            setTimeout(() => {
                if (loginResult !== null) {
                    console.log("[login] resolved via message relay (after window closed)")
                    settle(loginResult)
                } else {
                    console.log("[login] cancelled - window closed with no result")
                    settle({ success: false, cancelled: true, content: { error: "Login cancelled." } })
                }
            }, 800)
        }
        api.windows.onRemoved.addListener(onWindowClosed)

        // Fallback for when the postMessage/content-script relay doesn't make it
        // through (ad blockers, etc.): on success signin.js redirects this window to a
        // URL carrying the token and fingerprint hash, so watch for that navigation
        // directly instead - a privileged API the page's own JS can't interfere with.
        function onTabNavigated(tabId, changeInfo, tab) {
            if (tab.windowId !== loginWindow.id || !changeInfo.url) return
            if (!changeInfo.url.startsWith("https://yomi-translator.vercel.app/login?")) return

            const url = new URL(changeInfo.url)
            if (url.searchParams.get("from") !== "extension_sso") return

            const token = url.searchParams.get("token")
            if (!token) return

            console.log("[login] resolved via tab-redirect fallback")
            const visitorId = url.searchParams.get("fp")
            settle({ success: true, content: token, fpData: visitorId ? { visitorId } : null })
        }
        api.tabs.onUpdated.addListener(onTabNavigated)
    })

    return authResult
}

async function tabsLogin(provider = "google.com") {
    const providerParam = provider === "apple.com" ? "?provider=apple" : ""
    const loginTab = await api.tabs.create({ url: `https://yomi-translator.vercel.app/signin${providerParam}` })

    const authResult = await new Promise((resolve) => {
        let settled = false
        const settle = (value) => {
            if (settled) return
            settled = true
            clearInterval(checkToken)
            api.tabs.onRemoved.removeListener(onTabClosed)
            api.tabs.onUpdated.removeListener(onTabNavigated)
            resolve(value)
        }

        const checkToken = setInterval(() => {
            if (loginResult !== null) {
                console.log("[login] resolved via message relay")
                settle(loginResult)
            }
        }, 100)

        // If the tab is closed with no token yet, wait a bit before giving up - it
        // could just be a token already in flight, not a real cancel.
        function onTabClosed(closedTabId) {
            if (closedTabId !== loginTab.id) return
            api.tabs.onRemoved.removeListener(onTabClosed)
            setTimeout(() => {
                if (loginResult !== null) {
                    console.log("[login] resolved via message relay (after tab closed)")
                    settle(loginResult)
                } else {
                    console.log("[login] cancelled - tab closed with no result")
                    settle({ success: false, cancelled: true, content: { error: "Login cancelled." } })
                }
            }, 800)
        }
        api.tabs.onRemoved.addListener(onTabClosed)

        // Fallback for when the postMessage/content-script relay doesn't make it
        // through (ad blockers, etc.): on success signin.js redirects this tab to a
        // URL carrying the token and fingerprint hash, so watch for that navigation
        // directly instead - a privileged API the page's own JS can't interfere with.
        function onTabNavigated(tabId, changeInfo, tab) {
            if (tabId !== loginTab.id || !changeInfo.url) return
            if (!changeInfo.url.startsWith("https://yomi-translator.vercel.app/login?")) return

            const url = new URL(changeInfo.url)
            if (url.searchParams.get("from") !== "extension_sso") return

            const token = url.searchParams.get("token")
            if (!token) return

            console.log("[login] resolved via tab-redirect fallback")
            const visitorId = url.searchParams.get("fp")
            settle({ success: true, content: token, fpData: visitorId ? { visitorId } : null })
        }
        api.tabs.onUpdated.addListener(onTabNavigated)
    })

    return authResult
}

async function getUserData() {
    try {
        if (!currentUser || currentUser.uid === "free-yomi-user" || currentUser.email === "free@yomi.local") {
            const content = {
                credits: 999999,
                plan: "free-unlimited",
                subscription: { active: true, credits: 999999 },
                photoURL: null,
                displayName: "Yomi Free User",
                email: "free@yomi.local"
            };
            await api.storage.local.set({ yomi_user_data: content });
            return { success: true, content };
        }

        const userDB = await getDoc(doc(db, "users", currentUser.uid))

        if (!userDB.exists()) {
            if (!isCreatingUser) {
                await signOut(auth)
                await api.storage.local.remove(["yomi_credits", "yomi_user_data"])
                currentUser = defaultFreeUser;
            }

            return { success: false, content: { error: "User not found." } }
        }

        const credits = userDB.get("credits")
        const plan = userDB.get("plan")
        const subscription = userDB.get("subscription")
        const content = {
            credits, plan, subscription,
            photoURL: currentUser.photoURL || null,
            displayName: currentUser.displayName || null,
            email: currentUser.email || null
        }

        // Cache the retrieved user data
        await api.storage.local.set({ yomi_user_data: content })

        return { success: true, content }
    } catch (error) {
        sendError(error, "get user data")

        return { success: false, content: { error: "Failed to get user data." } }
    }
}

async function getOrCreateUserData() {
    isCreatingUser = true;
    const safetyTimeout = setTimeout(() => {
        isCreatingUser = false;
    }, 15000);
    try {
        const user = currentUser || defaultFreeUser;
        if (!user || user.uid === "free-yomi-user" || user.email === "free@yomi.local") {
            const content = {
                credits: 999999,
                plan: "free-unlimited",
                subscription: { active: true, credits: 999999 },
                photoURL: null,
                displayName: "Yomi Free User",
                email: "free@yomi.local"
            };
            await api.storage.local.set({ yomi_user_data: content });
            return { success: true, content };
        }

        const userDB = await getDoc(doc(db, "users", user.uid))

        if (userDB.exists()) {
            const credits = userDB.get("credits")
            const plan = userDB.get("plan")
            const subscription = userDB.get("subscription")
            const content = {
                credits, plan, subscription,
                photoURL: user.photoURL || null,
                displayName: user.displayName || null,
                email: user.email || null
            }

            // Cache the retrieved user data
            await api.storage.local.set({ yomi_user_data: content })

            return { success: true, content }
        } else {
            let isDeletedEmail = false
            let initialCredits = 30;
            try {
                const deletedEmailDoc = await getDoc(doc(db, "deleted_emails", user.email));
                if (deletedEmailDoc.exists()) {
                    isDeletedEmail = true
                    initialCredits = deletedEmailDoc.get("credits");
                    if (initialCredits === undefined || initialCredits === null) initialCredits = 30;
                }
            } catch (e) {
                console.error("Failed to fetch deleted email credits:", e);
            }

            if (!isDeletedEmail) {
                try {
                    const visitorId = loginResult?.fpData?.visitorId
                    const visitorIp = loginResult?.fpData?.ip

                    if (visitorId) {
                        const fingerprintDB = await getDoc(doc(db, "fingerprints", visitorId))

                        if (fingerprintDB.exists()) {
                            await signOut(auth)

                            loginResult = null

                            sendError(new Error("Multiple accounts attempted by: " + visitorId + " on: " + visitorIp), "create fingerprint")

                            return { success: false, content: { error: "Multiple accounts not allowed. Use original account." } }
                        } else {
                            await setDoc(doc(db, "fingerprints", visitorId), {
                                created: new Date().toISOString(),
                                fingerprint: loginResult?.fpData || null
                            })
                        }
                    }
                } catch (error) {
                    sendError(error, "create fingerprint")
                }
            }

            try {
                await setDoc(doc(db, "users", user.uid), {
                    email: user.email,
                    credits: initialCredits,
                    plan: "free",
                    // Chrome's package runs the background as a service worker, Firefox's as a page.
                    from: api.runtime.getManifest().background?.service_worker ? "chromium" : "firefox",
                    is_mobile: isMobile(),
                    created: new Date().toISOString(),
                    meta: {
                        agent: navigator?.userAgent || null,
                        platform: navigator?.userAgentData?.platform || null,
                        brands: navigator?.userAgentData?.brands || null,
                        fingerprint: loginResult?.fpData || null,
                    }
                })

                return {
                    success: true, content: {
                        credits: 30, plan: "free",
                        photoURL: user.photoURL || null,
                        displayName: user.displayName || null,
                        email: user.email || null
                    }
                }
            } catch (error) {
                if (error?.message?.includes?.("permissions")) {
                    const userData = await getUserData()

                    if (userData.success) {
                        return userData
                    } else {
                        sendError({ message: error.message + " - retry after permissions fail - " + userData.content.error, stack: error.stack }, "get or create user data retry")

                        return { success: false, content: { error: "Failed to create new database user." } }
                    }
                }

                sendError(error, "create new database user: " + user?.email)

                return { success: false, content: { error: "Failed to create new database user." } }
            }
        }
    } catch (error) {
        sendError(error, "get or create user data")

        return { success: false, content: { error: "Failed to get or create user data." } }
    } finally {
        clearTimeout(safetyTimeout);
        isCreatingUser = false;
    }
}

async function updateTabCredits(credits) {
    if (credits === null || credits === undefined) return

    credits = Number(credits)

    await storeCredits(credits)

    try {
        const storedUserData = await api.storage.local.get({ yomi_user_data: null })
        if (storedUserData && storedUserData.yomi_user_data) {
            const userData = storedUserData.yomi_user_data
            userData.credits = credits
            await api.storage.local.set({ yomi_user_data: userData })
        }
    } catch (error) {
        sendError(error, "update cached user data credits")
    }

    try {
        const tabs = await api.tabs.query({})
        tabs.forEach(function (tab) {
            api.tabs.sendMessage(tab.id, { type: "credits", content: { credits } }).catch(() => { })
        })
    } catch (error) {
        sendError(error, "update tabs")

        console.log("Update tabs error: ", error)
    }
}

function showUpdateBadge() {
    showBadge("1")

    api.storage.sync.set({ yomi_new_version: true })
}

function removeUpdateBadge() {
    showBadge("")

    api.storage.sync.set({ yomi_new_version: false })
}

function showBadge(text) {
    try {
        api.action.setBadgeText({ text: text })
    } catch (error) {
        sendError(error, "show badge text")
    }

    try {
        if (text !== "") {
            api.action.setBadgeTextColor({ color: [255, 255, 255, 255] })
        }
    } catch (error) {
        sendError(error, "show badge text color")
    }

    try {
        if (text !== "") {
            api.action.setBadgeBackgroundColor({ color: [255, 0, 0, 255] })
        }
    } catch (error) {
        sendError(error, "show badge background color")
    }
}

async function sendError(error, loc) {
    try {
        console.log("Send error: ", error)
        if (error?.message?.includes?.("because the client is offline")) {
            return
        }

        const now = Date.now()
        if (now - lastErrorsResetTime > 60000) {
            sentErrors = 0
            lastErrorsResetTime = now
        }

        sentErrors += 1

        if (sentErrors > 10) {
            return
        }

        const ip = await getIP()

        let report = {
            stack_trace: error?.stack,
            message: error?.message,
            created: new Date().toISOString(),
            email: currentUser?.email,
            location: loc,
            meta: {
                version: api.runtime.getManifest().version,
                agent: navigator?.userAgent || null,
                platform: navigator?.userAgentData?.platform || null,
                brands: navigator?.userAgentData?.brands || null,
            },
            ip: ip
        }

        if (loginResult?.fpData?.visitorId) {
            report.fingerprint = loginResult.fpData
        }

        const headers = {
            Authorization: "8ZjGU1PqCulQG692g-vpjQiYgStpl29suHP9OiD56psA",
        }

        await fetch("https://direct-api.yomi-translator.vercel.app/api/reporting", {
            method: "POST",
            body: JSON.stringify(report, (k, v) => v === undefined ? null : v),
            headers: headers,
            signal: AbortSignal.timeout(3000),
        })

    } catch (error) {
        console.log("Failed to send error. Error: ", error)
    }
}

async function storeCredits(credits) {
    try {
        await api.storage.local.set({ yomi_credits: credits })
    } catch (error) {
        sendError(error, "store credits")

        console.log("Failed to store credits. Error: ", error)
    }
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function isMobile() {
    if (navigator?.userAgentData?.mobile) return true;
    const ua = navigator.userAgent;
    if (/Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(ua)) return true;
    if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return true;
    return false;
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    handleMessage(msg, sender).then(sendResponse).catch(error => {
        sendError(error, "on message")

        sendResponse({ success: false, content: { error: "Something went wrong. Contact support." } })
    })

    if (
        msg.type == "byok-encrypt" ||
        msg.type == "login" ||
        msg.type == "sign-out" ||
        msg.type == "user" ||
        msg.type == "translate" ||
        msg.type == "inpaint" ||
        msg.type == "error" ||
        msg.type == "update_seen" ||
        msg.type == "screenshot" ||
        msg.type == "google-auth-token" ||
        msg.type == "apple-auth-token" ||
        msg.type == "email" ||
        msg.type == "keep-alive" ||
        msg.type == "cleanup_cache" ||
        msg.type == "get_recent" ||
        msg.type == "delete_recent" ||
        msg.type == "font_list" ||
        msg.type == "font_read" ||
        msg.type == "font_save" ||
        msg.type == "font_delete" ||
        msg.type == "open-popup" ||
        msg.type == "prepare-cors" ||
        msg.type == "cleanup-cors" ||
        msg.type == "get-zoom"
    ) {
        return true
    }
})

api.tabs.onZoomChange?.addListener(({ tabId, newZoomFactor }) => {
    api.tabs.sendMessage(tabId, { type: "zoom", content: { zoom: newZoomFactor } }).catch(() => { })
})

async function setUninstallURL() {
    try {
        const url = `https://yomi-translator.vercel.app/feedback?reason=uninstall&email=${encodeURIComponent(currentUser?.email)}`
        await api.runtime.setUninstallURL(url)
    } catch (error) {
        sendError(error, "set uninstall url")
    }
}

api.runtime.onInstalled.addListener(async (details) => {
    try {
        const currentVersion = api.runtime.getManifest().version
        const previousVersion = details.previousVersion
        const reason = details.reason

        if (reason == "update") {
            const previousVersionDigits = previousVersion.split(".")
            const currentVersionDigits = currentVersion.split(".")
            const significantPreviousVersionDigit = previousVersionDigits[previousVersionDigits.length - 2]
            const significantCurrentVersionDigit = currentVersionDigits[currentVersionDigits.length - 2]
            const isSignificantUpdate = significantPreviousVersionDigit != significantCurrentVersionDigit
            const sameLength = previousVersionDigits.length == currentVersionDigits.length

            if (isSignificantUpdate && sameLength) {
                showUpdateBadge()
            }
        } else if (reason == "install") {
            await setUninstallURL()
            await api.tabs.create({ url: "https://yomi-translator.vercel.app/install" })
        }

    } catch (error) {
        sendError(error, "onInstalled")
    }

    try {
        api.contextMenus.create({
            id: "yomi_contextmenu",
            title: "Yomi (Alt+Shift+D)",
            contexts: ["all"]
        })

        api.contextMenus.create({
            id: "yomi_screenshot",
            title: "Screenshot Image (Alt+Shift+C)",
            contexts: ["all"],
            parentId: "yomi_contextmenu"
        })

        api.contextMenus.create({
            id: "yomi_translate",
            title: "Translate Image (Alt+Shift+Z)",
            contexts: ["all"],
            parentId: "yomi_contextmenu"
        })

        api.contextMenus.create({
            id: "yomi_screencrop",
            title: "Screen Crop Image (Alt+Shift+X)",
            contexts: ["all"],
            parentId: "yomi_contextmenu"
        })

        api.contextMenus.create({
            id: "yomi_repeatscreencrop",
            title: "Repeat Last Screen Crop",
            contexts: ["all"],
            parentId: "yomi_contextmenu"
        })

        api.contextMenus.create({
            id: "yomi_edit",
            title: "Edit Image",
            contexts: ["all"],
            parentId: "yomi_contextmenu"
        })

        api.contextMenus.create({
            id: "yomi_download",
            title: "Download Image",
            contexts: ["all"],
            parentId: "yomi_contextmenu"
        })

        api.contextMenus.create({
            id: "yomi_auto",
            title: "Toggle Auto Translate",
            contexts: ["all"],
            parentId: "yomi_contextmenu"
        })
    } catch (error) {
        console.log("Failed to create context menus. Error: ", error)
    }
})

try {
    api.commands.onCommand.addListener(async (command, tab) => {
        if (tab && command == "yomi_contextmenu") {
            api.tabs.sendMessage(tab.id, { type: "command_contextmenu" }).catch(() => { })
        }

        if (tab && command == "yomi_screencrop") {
            api.tabs.sendMessage(tab.id, { type: "command_screencrop" }).catch(() => { })
        }

        if (tab && command == "yomi_repeatscreencrop") {
            api.tabs.sendMessage(tab.id, { type: "command_repeatscreencrop" }).catch(() => { })
        }

        if (tab && command == "yomi_translate") {
            api.tabs.sendMessage(tab.id, { type: "command_translate" }).catch(() => { })
        }

        if (tab && command == "yomi_screenshot") {
            api.tabs.sendMessage(tab.id, { type: "command_screenshot" }).catch(() => { })
        }

        if (tab && command == "yomi_edit") {
            api.tabs.sendMessage(tab.id, { type: "command_edit" }).catch(() => { })
        }

        if (tab && command == "yomi_download") {
            api.tabs.sendMessage(tab.id, { type: "command_download" }).catch(() => { })
        }
    })
} catch (error) {
    console.log("Failed to create command listener. Error: ", error)
}

try {
    api.contextMenus.onClicked.addListener(async (info, tab) => {
        if (info.menuItemId == "yomi_screenshot") {
            api.tabs.sendMessage(tab.id, { type: "contextmenu_screenshot" }).catch(() => { })
        } else if (info.menuItemId == "yomi_translate") {
            api.tabs.sendMessage(tab.id, { type: "contextmenu_translate" }).catch(() => { })
        } else if (info.menuItemId == "yomi_screencrop") {
            api.tabs.sendMessage(tab.id, { type: "contextmenu_screencrop" }).catch(() => { })
        } else if (info.menuItemId == "yomi_repeatscreencrop") {
            api.tabs.sendMessage(tab.id, { type: "contextmenu_repeatscreencrop" }).catch(() => { })
        } else if (info.menuItemId == "yomi_edit") {
            api.tabs.sendMessage(tab.id, { type: "contextmenu_edit" }).catch(() => { })
        } else if (info.menuItemId == "yomi_download") {
            api.tabs.sendMessage(tab.id, { type: "contextmenu_download" }).catch(() => { })
        } else if (info.menuItemId == "yomi_auto") {
            api.tabs.sendMessage(tab.id, { type: "contextmenu_auto" }).catch(() => { })
        }
    })

    api.storage.sync.set({ yomi_contextmenu: true })
} catch (error) {
    api.storage.sync.set({ yomi_contextmenu: false })
}
