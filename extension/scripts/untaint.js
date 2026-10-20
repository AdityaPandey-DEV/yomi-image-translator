(function () {
    // Hosts that serve their own canvas images and so have nothing to untaint. Patching
    // drawImage there is pure overhead: every cross-origin draw would be swapped for a second,
    // anonymously-fetched copy of an image that was never going to taint the canvas.
    //
    // Subdomains are covered, so www and any preview host are excluded too. The leading dot
    // matters - without it a lookalike domain ending in the same letters would match.
    const EXCLUDED_HOSTS = ["yomi-translator.vercel.app"];

    const hostname = (window.location.hostname || "").toLowerCase();
    if (EXCLUDED_HOSTS.some((host) => hostname === host || hostname.endsWith("." + host))) {
        return;
    }

    console.log("[Yomi] Universal Untaint engine active (Canvas isolated)");

    const isCrossOrigin = (src) => {
        if (!src || src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('chrome-extension:')) {
            return false;
        }
        try {
            const url = new URL(src, window.location.href);
            return url.origin !== window.location.origin;
        } catch (e) {
            return false;
        }
    };

    // Keyed by element, but only valid for the src it was built from: an SPA reader that recycles
    // one <img> across pages would otherwise keep being handed the previous page's copy to draw.
    const anonCache = new WeakMap();

    // isCrossOrigin() builds a URL, which is far too much to redo on every drawImage call in an
    // animation loop. The answer only changes when src does.
    const taintCache = new WeakMap();

    const needsAnonCopy = (image) => {
        // Read rather than cached: an attribute a page can add at any time, and cheaper than the
        // parse below anyway.
        if (image.hasAttribute('crossorigin')) return false;

        const src = image.src;
        let cached = taintCache.get(image);
        if (cached === undefined || cached.src !== src) {
            cached = { src, crossOrigin: isCrossOrigin(src) };
            taintCache.set(image, cached);
        }
        return cached.crossOrigin;
    };

    const origDrawImage = CanvasRenderingContext2D.prototype.drawImage;

    // drawImage is synchronous and the anonymous copy is not, so a call that arrives before the
    // copy has loaded is replayed on arrival. The context is mutable and will have moved on by
    // then, which is what the snapshot is for.
    const deferDraw = (ctx, args) => {
        const alpha = ctx.globalAlpha;
        const composite = ctx.globalCompositeOperation;
        const filter = ctx.filter;
        const smoothEnabled = ctx.imageSmoothingEnabled;
        const smoothQuality = ctx.imageSmoothingQuality;
        const shadowColor = ctx.shadowColor;
        const shadowBlur = ctx.shadowBlur;
        const shadowOffsetX = ctx.shadowOffsetX;
        const shadowOffsetY = ctx.shadowOffsetY;
        const transform = ctx.getTransform ? ctx.getTransform() : null;

        return (imgToDraw) => {
            ctx.save();

            if (alpha !== undefined) ctx.globalAlpha = alpha;
            if (composite !== undefined) ctx.globalCompositeOperation = composite;
            if (filter !== undefined) ctx.filter = filter;
            if (smoothEnabled !== undefined) ctx.imageSmoothingEnabled = smoothEnabled;
            if (smoothQuality !== undefined) ctx.imageSmoothingQuality = smoothQuality;
            if (shadowColor !== undefined) ctx.shadowColor = shadowColor;
            if (shadowBlur !== undefined) ctx.shadowBlur = shadowBlur;
            if (shadowOffsetX !== undefined) ctx.shadowOffsetX = shadowOffsetX;
            if (shadowOffsetY !== undefined) ctx.shadowOffsetY = shadowOffsetY;
            if (transform) ctx.setTransform(transform);

            origDrawImage.apply(ctx, [imgToDraw, ...args]);
            ctx.restore();
        };
    };

    const flushPending = (entry, imgToDraw) => {
        const pending = entry.pending;
        entry.pending = [];
        // The element can have turned the page while this was in flight, and drawing these now
        // would paint the one it left.
        if (entry.element.src !== entry.src) return;
        for (const draw of pending) draw(imgToDraw);
    };

    // The rest parameter is load-bearing despite the apply(this, arguments) below: without it this
    // sloppy-mode function gets a *mapped* arguments object, which measured 11x slower per call in
    // V8 than the unmapped one a rest parameter forces.
    CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
        // Canvases, videos, ImageBitmaps and same-origin images cannot taint anything, and this
        // runs on every drawImage on every site.
        if (!(image instanceof HTMLImageElement) || !needsAnonCopy(image)) {
            return origDrawImage.apply(this, arguments);
        }

        const src = image.src;
        let entry = anonCache.get(image);

        if (!entry || entry.src !== src) {
            entry = { src, element: image, img: new Image(), pending: [] };
            anonCache.set(image, entry);
            entry.img.crossOrigin = "anonymous";
            // One pair per entry, not one per call: an animation loop drawing an image that had
            // not loaded yet used to register a listener - and retain a context - per frame.
            entry.img.addEventListener('load', () => flushPending(entry, entry.img), { once: true });
            entry.img.addEventListener('error', () => flushPending(entry, entry.element), { once: true });
            entry.img.src = src;
        }

        const anonImg = entry.img;

        if (anonImg.complete) {
            // naturalWidth 0 means it completed as a failure, so the tainted original is all there is.
            origDrawImage.apply(this, [anonImg.naturalWidth > 0 ? anonImg : image, ...args]);
            return;
        }

        entry.pending.push(deferDraw(this, args));
    };
})();
