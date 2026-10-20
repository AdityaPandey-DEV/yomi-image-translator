/**
 * vaultCrypto.js
 * Client-side cryptographic vault for Chrome Extension Service Worker & Popup
 * AES-GCM-256 + PBKDF2 Web Crypto API implementation.
 */

const SALT_BYTES = 16;
const IV_BYTES = 12;
const ITERATIONS = 100000;

function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

async function deriveKey(secret, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(secret),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );

    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt,
            iterations: ITERATIONS,
            hash: 'SHA-256',
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

export async function encryptApiKey(apiKey, secretKey) {
    if (!apiKey) return '';
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const key = await deriveKey(secretKey, salt);

    const enc = new TextEncoder();
    const cipherBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        enc.encode(apiKey)
    );

    return `${bufferToBase64(salt.buffer)}:${bufferToBase64(iv.buffer)}:${bufferToBase64(cipherBuffer)}`;
}

export async function decryptApiKey(payload, secretKey) {
    if (!payload || !payload.includes(':')) return '';
    try {
        const [saltB64, ivB64, cipherB64] = payload.split(':');
        if (!saltB64 || !ivB64 || !cipherB64) return '';

        const salt = new Uint8Array(base64ToBuffer(saltB64));
        const iv = new Uint8Array(base64ToBuffer(ivB64));
        const cipherBuffer = base64ToBuffer(cipherB64);

        const key = await deriveKey(secretKey, salt);
        const decryptedBuffer = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            cipherBuffer
        );

        const dec = new TextDecoder();
        return dec.decode(decryptedBuffer);
    } catch (err) {
        console.error('[Yomi Vault] Decrypt failed:', err);
        return '';
    }
}
