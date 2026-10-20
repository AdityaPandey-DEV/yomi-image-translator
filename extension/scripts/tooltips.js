function setupTooltips(root = document) {
    try {
        const container = root.body || root;
        let tooltip = root.getElementById("global-tooltip")
        if (!tooltip) {
            const doc = root.ownerDocument || document
            tooltip = doc.createElement("div")
            tooltip.id = "global-tooltip"
            tooltip.className = "fixed hidden z-[2147483647] max-w-72 p-2 bg-neutral-800 dark:bg-white text-white dark:text-neutral-900 text-xs rounded shadow-lg pointer-events-none text-left transition-opacity duration-150 opacity-0"

            tooltip.innerHTML = `
            <div id="tooltip-title" class="font-bold mb-1" style="overflow-wrap: anywhere;"></div>
            <div id="tooltip-desc" class="text-neutral-300 dark:text-neutral-500 leading-tight" style="overflow-wrap: anywhere;"></div>
            <div id="tooltip-arrow" class="absolute border-[6px] border-transparent"></div>
        `
            container.appendChild(tooltip)
        }

        const titleEl = tooltip.querySelector("#tooltip-title")
        const descEl = tooltip.querySelector("#tooltip-desc")
        const arrowEl = tooltip.querySelector("#tooltip-arrow")

        let hideTimeout = null

        // How long the pointer has to rest on a control before its tooltip appears. Tooltips used
        // to fire the moment the pointer crossed anything, so simply moving across a settings
        // panel strobed a tooltip at every control on the way past. Roughly what the platform
        // itself waits for a native title attribute.
        const TOOLTIP_HOVER_DELAY_MS = 200
        // Once one tooltip is up, moving to another shows it straight away. The delay exists to
        // establish intent, and by this point intent is established - without this, reading along
        // a row of controls means waiting the full delay at every stop, which feels sluggish
        // rather than calm. The warm window starts when a tooltip is dismissed; set it to 0 to
        // make every tooltip wait.
        const TOOLTIP_WARM_MS = 400

        let showTimeout = null
        // The element a pending show is armed for, so repeated mouseover events on the same
        // control (they fire for every descendant crossed) do not keep restarting the timer.
        let pendingTarget = null
        let warmUntil = 0
        let currentTarget = null
        // Which element's tooltip the current gesture's touchstart took down. The tap-to-pin
        // click handler reads it to tell a first tap (show) from a second one (use the control),
        // since by the time click runs currentTarget has already been cleared.
        let touchDismissedTarget = null
        // The click that opened the current tooltip by tap, so the re-check below can
        // tell it apart from a later one.
        let tapShowEvent = null
        // The control a press just dismissed. It stays quiet until the pointer leaves: a click that
        // swaps the icon under a still cursor fires mouseover again and would re-show it.
        let pressDismissedTarget = null

        // Helper to check if user device supports hover (mouse/pointer) and is not touch-only
        const supportsHover = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches

        // Inject rule to hide .shortcut-hint elements on touch devices. For the shadow-DOM root
        // (no .head of its own) the rule is scoped to that tree by appending directly to root;
        // for a plain document root it goes in <head> like any other global stylesheet.
        if (!supportsHover()) {
            try {
                const doc = root.ownerDocument || document
                const style = doc.createElement("style")
                style.textContent = ".shortcut-hint { display: none !important; }"
                if (root.head) {
                    root.head.appendChild(style)
                } else {
                    root.appendChild(style)
                }
            } catch (err) { }
        }

        // Monitor attribute changes to update tooltip instantly when target changes its tooltip text
        const observer = new MutationObserver((mutations) => {
            // 1. Check if currentTarget was removed from the DOM
            let targetRemoved = false
            for (const mutation of mutations) {
                if (mutation.type === "childList" && mutation.removedNodes.length > 0) {
                    if (currentTarget && !root.contains(currentTarget)) {
                        targetRemoved = true
                        break
                    }
                }
            }

            if (targetRemoved) {
                currentTarget = null
                tooltip.classList.add("opacity-0")
                if (hideTimeout) clearTimeout(hideTimeout)
                hideTimeout = setTimeout(() => {
                    tooltip.classList.add("hidden")
                }, 150)
                return
            }

            // 2. Check if currentTarget's attributes changed
            let attribChanged = false
            for (const mutation of mutations) {
                if (mutation.type === "attributes" && mutation.target === currentTarget) {
                    attribChanged = true
                    break
                }
            }

            if (attribChanged && currentTarget) {
                const direction = renderTooltipContent(currentTarget)
                updateTooltipPosition(currentTarget, tooltip, arrowEl, direction)
            }
        })
        observer.observe(root, {
            attributes: true,
            attributeFilter: ["data-tooltip-title", "data-tooltip-desc", "data-tooltip-direction"],
            childList: true,
            subtree: true
        })

        function cancelPendingTooltip() {
            if (showTimeout) {
                clearTimeout(showTimeout)
                showTimeout = null
            }
            pendingTarget = null
        }

        // Called wherever a visible tooltip is taken down, so the next control the pointer reaches
        // can show immediately rather than waiting again.
        function startTooltipWarmWindow() {
            warmUntil = Date.now() + TOOLTIP_WARM_MS
        }

        // The hover path's entry point: show after the delay, or at once while still warm.
        function scheduleTooltip(target) {
            if (pendingTarget === target) return
            cancelPendingTooltip()

            // The delay exists to tell a deliberate hover from the pointer merely crossing a
            // control on its way elsewhere. A help icon is already the deliberate version - it is a
            // small target you have to aim at, and it does nothing except explain - so it opts out
            // and answers immediately. Controls that carry their own tooltip keep the delay.
            if (target.dataset && target.dataset.tooltipInstant === "true") {
                showTooltip(target)
                return
            }

            if (Date.now() < warmUntil) {
                showTooltip(target)
                return
            }

            pendingTarget = target
            showTimeout = setTimeout(() => {
                showTimeout = null
                pendingTarget = null
                // The control may have been removed or hidden during the wait - edit mode rebuilds
                // panels wholesale - and anchoring a tooltip to a detached element leaves it
                // floating at stale coordinates with nothing under it.
                if (!target.isConnected) return
                showTooltip(target)
            }, TOOLTIP_HOVER_DELAY_MS)
        }

        // Fills the tooltip from the target's data-tooltip-* attributes and returns its direction.
        function renderTooltipContent(target) {
            let title = target.getAttribute("data-tooltip-title")
            let desc = target.getAttribute("data-tooltip-desc") || ""
            let direction = target.getAttribute("data-tooltip-direction") || "up"
            if (direction === "top") direction = "up"
            if (direction === "bottom") direction = "down"

            if (!supportsHover()) {
                if (title) title = title.replace(/\s*\((?:Ctrl|Cmd|Alt|Shift)\+[^\)]+\)/gi, "")
                if (desc) desc = desc.replace(/\s*\((?:Ctrl|Cmd|Alt|Shift)\+[^\)]+\)/gi, "")
            }

            titleEl.textContent = title || ""
            titleEl.style.display = title ? "block" : "none"
            titleEl.classList.toggle("mb-1", !!desc)
            descEl.innerHTML = desc
            return direction
        }

        // Renders, positions, and reveals the tooltip for a given target. Shared by the
        // hover path (desktop) and the tap-to-pin path (data-tooltip-mobile, touch devices).
        function showTooltip(target) {
            currentTarget = target

            if (hideTimeout) {
                clearTimeout(hideTimeout)
                hideTimeout = null
            }

            // Move tooltip to the end of its parent to ensure it draws on top of later-added siblings (like editScreen)
            if (tooltip.parentNode) {
                tooltip.parentNode.appendChild(tooltip)
            }

            const direction = renderTooltipContent(target)

            tooltip.classList.remove("hidden")

            updateTooltipPosition(target, tooltip, arrowEl, direction)

            requestAnimationFrame(() => {
                tooltip.classList.remove("opacity-0")
            })
        }

        // Event Delegation
        root.addEventListener("mouseover", (e) => {
            try {
                // A button held down means a drag is under way, as on a slider.
                if (!supportsHover() || e.buttons) return
                // Support triggering via desc OR title
                const target = e.target.closest("[data-tooltip-desc], [data-tooltip-title]")
                if (!target || target === pressDismissedTarget) return

                if (target !== currentTarget) {
                    scheduleTooltip(target)
                }
            } catch (error) {
                console.error("Tooltip mouseover error:", error)
            }
        })

        // Elements marked data-tooltip-mobile="true" have no hover to reveal their tooltip on
        // touch devices, so a tap shows it instead - pinned open until the next tap anywhere,
        // which the touchstart listener below already dismisses as that next gesture begins.
        //
        // CAPTURE phase, deliberately. This listener sits on the root, so in the bubble phase any
        // button whose own click handler calls stopPropagation() - a normal thing to do, and
        // something several already do here - would never reach it, and its mobile tooltip would
        // silently never appear while its neighbours' worked fine. Capture runs on the way down,
        // before those handlers, so marking an element is enough on its own.
        root.addEventListener("click", (e) => {
            try {
                if (supportsHover()) return
                const target = e.target.closest('[data-tooltip-mobile="true"]')
                if (!target) return
                // Second tap on a control whose tooltip was already up: that tap is for the
                // control, so flashing the same tooltip straight back is just noise.
                const wasAlreadyShowing = touchDismissedTarget === target
                touchDismissedTarget = null
                if (wasAlreadyShowing) return
                showTooltip(target)
                tapShowEvent = e
            } catch (error) {
                console.error("Tooltip mobile click error:", error)
            }
        }, true)

        root.addEventListener("mouseout", (e) => {
            try {
                if (!supportsHover()) return
                const target = e.target.closest("[data-tooltip-desc], [data-tooltip-title]")
                if (!target) return

                if (!target.contains(e.relatedTarget)) {
                    if (target === pressDismissedTarget) pressDismissedTarget = null
                    // Leaving before the delay elapsed means the hover was a pass-through, not a
                    // request - drop it rather than letting it fire over whatever is there by then.
                    cancelPendingTooltip()
                    // Only warm the window if something was actually on screen to move on FROM.
                    if (currentTarget) startTooltipWarmWindow()
                    currentTarget = null
                    tooltip.classList.add("opacity-0")
                    hideTimeout = setTimeout(() => {
                        tooltip.classList.add("hidden")
                    }, 150)
                }
            } catch (error) {
                console.error("Tooltip mouseout error:", error)
            }
        })

        // Pressing or dragging a control means the tooltip was read; help icons (instant) stay up, as a
        // click on them does nothing else.
        const dismissForInteraction = (e) => {
            try {
                if (!supportsHover()) return
                const target = e.target.closest("[data-tooltip-desc], [data-tooltip-title]")
                if (!target || target.dataset.tooltipInstant === "true") return
                if (e.type === "pointerdown") pressDismissedTarget = target
                if (target === pendingTarget) cancelPendingTooltip()
                if (target !== currentTarget) return
                currentTarget = null
                tooltip.classList.add("opacity-0", "hidden")
            } catch (error) {
                console.error("Tooltip interaction dismiss error:", error)
            }
        }
        root.addEventListener("pointerdown", dismissForInteraction, true)
        root.addEventListener("input", dismissForInteraction, true)

        // Some custom dropdowns (e.g. #model-select-box) nest their option list INSIDE
        // the tooltip-bearing element itself, rather than appending it elsewhere. The
        // mouseout handler above intentionally ignores moves into a descendant (target.
        // contains(relatedTarget)), so hovering into that nested list never counts as
        // leaving - the tooltip just stays anchored the whole time you're browsing
        // options. Clicking one then collapses the list without the cursor moving, so no
        // mouse event fires at all to re-evaluate anything, leaving the tooltip stuck.
        // Re-check what's actually under the click position afterward (once the click's
        // own handler, e.g. closing the dropdown, has run) and hide it if that's no
        // longer inside currentTarget.
        root.addEventListener("click", (e) => {
            if (!currentTarget) return
            // Not the tap that just opened it. This re-check is for the hover case, where
            // currentTarget predates the click; on touch the same tap both creates the tooltip
            // and lands here, and the hit test below disagrees with the tap point - measured on
            // Firefox Android, elementFromPoint at the tap resolved to the panel behind the open
            // dropdown - so the tooltip was destroyed by the very gesture that asked for it.
            if (e === tapShowEvent) {
                tapShowEvent = null
                return
            }
            const x = e.clientX
            const y = e.clientY
            setTimeout(() => {
                if (!currentTarget) return
                const elAtPoint = root.elementFromPoint(x, y)
                const stillHovering = elAtPoint && (elAtPoint === currentTarget || currentTarget.contains(elAtPoint))
                if (!stillHovering) {
                    startTooltipWarmWindow()
                    currentTarget = null
                    tooltip.classList.add("opacity-0")
                    if (hideTimeout) clearTimeout(hideTimeout)
                    hideTimeout = setTimeout(() => {
                        tooltip.classList.add("hidden")
                    }, 150)
                }
            }, 0)
        })

        // Immediately dismiss tooltips when touch events fire
        root.addEventListener("touchstart", () => {
            // A synthetic mouseover often precedes a tap; without this its timer would fire half a
            // second into whatever the tap did next.
            cancelPendingTooltip()
            touchDismissedTarget = currentTarget
            if (currentTarget) {
                currentTarget = null
                tooltip.classList.add("opacity-0", "hidden")
            }
        }, { passive: true })

        // WebKit reports getBoundingClientRect() in LAYOUT pixels for anything inside a CSS `zoom`,
        // while clientX/clientY and body-parented elements live in RENDERED viewport pixels. The side
        // panel carries zoom:0.9, so measuring a control in there and positioning against it landed
        // about 11% out - measured on iPadOS 18.7, a 32px icon reporting as 35.6px. Blink reports the
        // rendered box, so there the factor is 1 and this is a no-op.
        //
        // Detected by measuring rather than by sniffing, and lazily: a content script's top level can
        // run before document.body exists.
        let yomiRectIgnoresZoom = null

        function rectIgnoresZoom(doc) {
            if (yomiRectIgnoresZoom !== null) return yomiRectIgnoresZoom

            try {
                const outer = doc.createElement("div")
                outer.style.cssText = "position:fixed;left:0;top:0;zoom:0.5;opacity:0;pointer-events:none"
                const inner = doc.createElement("div")
                inner.style.cssText = "width:100px;height:100px"
                outer.appendChild(inner)
                doc.body.appendChild(outer)
                yomiRectIgnoresZoom = inner.getBoundingClientRect().width > 75
                outer.remove()
            } catch (error) {
                yomiRectIgnoresZoom = false
            }

            return yomiRectIgnoresZoom
        }

        function viewportRect(element) {
            const rect = element.getBoundingClientRect()
            if (!rectIgnoresZoom(element.ownerDocument)) return rect

            let zoom = 1
            for (let node = element; node && node !== element.ownerDocument.documentElement; node = node.parentElement) {
                const value = parseFloat(getComputedStyle(node).zoom)
                if (value && value !== 1) zoom *= value
            }
            if (zoom === 1) return rect

            return new DOMRect(rect.left * zoom, rect.top * zoom, rect.width * zoom, rect.height * zoom)
        }

        function updateTooltipPosition(target, tooltip, arrow, preferredDir) {
            try {
                // Reset left/top/transform BEFORE measuring - the tooltip is `width: auto` (only
                // max-w-72 caps it) with just a `left` offset (never `right`), so per the
                // shrink-to-fit algorithm its available width is `viewport width - left`.
                // Measuring while it still holds the PREVIOUS target's left (e.g. near the
                // right edge) artificially narrows/wraps it, corrupting tooltipRect for this
                // target's first render - a second hover "fixes" it by chance, since by then
                // left is closer to this target's own value instead of the prior target's.
                tooltip.style.left = '0px'
                tooltip.style.top = '0px'
                tooltip.style.transform = ''
                tooltip.style.transformOrigin = ''

                const targetRect = viewportRect(target)
                const normalRect = tooltip.getBoundingClientRect()

                // Measure 33% shrunken dimensions (scale = 0.67)
                tooltip.style.transform = 'scale(0.67)'
                tooltip.style.transformOrigin = '0 0'
                const shrunkenRect = tooltip.getBoundingClientRect()

                const padding = 10
                const viewportWidth = window.innerWidth
                const viewportHeight = window.innerHeight

                const oppositeMap = {
                    'up': 'down', 'down': 'up',
                    'left': 'right', 'right': 'left'
                }
                const oppositeDir = oppositeMap[preferredDir] || 'down'

                // Helper to check if tooltip fits in a given direction with given rect
                const checkFit = (d, rect) => {
                    if (d === 'up') return targetRect.top - rect.height - 8 >= padding
                    if (d === 'down') return targetRect.bottom + rect.height + 8 <= viewportHeight - padding
                    if (d === 'left') return targetRect.left - rect.width - 8 >= padding
                    if (d === 'right') return targetRect.right + rect.width + 8 <= viewportWidth - padding
                    return true
                }

                let dir = preferredDir
                let scale = 1.0
                let tooltipRect = normalRect

                // Step 1: Try preferred direction at normal size
                if (checkFit(preferredDir, normalRect)) {
                    dir = preferredDir
                    scale = 1.0
                    tooltipRect = normalRect
                }
                // Step 2: Try preferred direction with shrunken styling (shrunk by 33% / scale 0.67)
                else if (checkFit(preferredDir, shrunkenRect)) {
                    dir = preferredDir
                    scale = 0.67
                    tooltipRect = shrunkenRect
                }
                // Step 3: Try opposite direction at normal size
                else if (checkFit(oppositeDir, normalRect)) {
                    dir = oppositeDir
                    scale = 1.0
                    tooltipRect = normalRect
                }
                // Step 4: Try opposite direction with shrunken styling
                else if (checkFit(oppositeDir, shrunkenRect)) {
                    dir = oppositeDir
                    scale = 0.67
                    tooltipRect = shrunkenRect
                }
                // Fallback: stay with preferred direction, shrunken to take least space
                else {
                    dir = preferredDir
                    scale = 0.67
                    tooltipRect = shrunkenRect
                }

                // Apply the determined transform
                if (scale < 1.0) {
                    tooltip.style.transform = `scale(${scale})`
                    tooltip.style.transformOrigin = '0 0'
                } else {
                    tooltip.style.transform = ''
                    tooltip.style.transformOrigin = ''
                }

                let top, left

                // Reset arrow classes and inline styles
                arrow.className = "absolute border-[6px] border-transparent"
                arrow.style.top = ''
                arrow.style.left = ''
                arrow.style.right = ''
                arrow.style.bottom = ''
                arrow.style.borderTopColor = ''
                arrow.style.borderBottomColor = ''
                arrow.style.borderLeftColor = ''
                arrow.style.borderRightColor = ''
                tooltip.style.backgroundColor = ''
                tooltip.style.color = ''
                descEl.style.color = ''

                if (dir === 'up') {
                    top = targetRect.top - tooltipRect.height - 8
                    left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2)

                    // Arrow points down (placed at bottom)
                    arrow.classList.add("top-full", "border-t-neutral-800", "dark:border-t-white", "-mt-[1px]")
                } else if (dir === 'down') {
                    top = targetRect.bottom + 8
                    left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2)

                    // Arrow points up (placed at top)
                    arrow.classList.add("bottom-full", "border-b-neutral-800", "dark:border-b-white", "-mb-[1px]")
                } else if (dir === 'left') {
                    top = targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2)
                    left = targetRect.left - tooltipRect.width - 8

                    // Arrow points right (placed at right)
                    arrow.classList.add("left-full", "border-l-neutral-800", "dark:border-l-white", "-ml-[1px]")
                } else if (dir === 'right') {
                    top = targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2)
                    left = targetRect.right + 8

                    // Arrow points left (placed at left)
                    arrow.classList.add("right-full", "border-r-neutral-800", "dark:border-r-white", "-mr-[1px]")
                }

                // Clamp to Viewport on BOTH axes - if neither the preferred direction nor its
                // flip fit (checked above), dir keeps whichever one it started with, so the
                // primary axis needs clamping here too, not just the cross axis, or the box can
                // end up entirely outside the viewport with no correction applied.
                if (left < padding) left = padding
                else if (left + tooltipRect.width > viewportWidth - padding) {
                    left = viewportWidth - tooltipRect.width - padding
                }
                if (top < padding) top = padding
                else if (top + tooltipRect.height > viewportHeight - padding) {
                    top = viewportHeight - tooltipRect.height - padding
                }

                // Position Arrow (coordinates inside tooltip scaled container)
                const unscaledWidth = tooltipRect.width / scale
                const unscaledHeight = tooltipRect.height / scale

                if (dir === 'up' || dir === 'down') {
                    let arrowLeft = ((targetRect.left + targetRect.width / 2) - left) / scale - 6
                    if (arrowLeft < 6) arrowLeft = 6
                    if (arrowLeft > unscaledWidth - 18) arrowLeft = unscaledWidth - 18
                    arrow.style.left = `${arrowLeft}px`
                } else {
                    let arrowTop = ((targetRect.top + targetRect.height / 2) - top) / scale - 6
                    if (arrowTop < 6) arrowTop = 6
                    if (arrowTop > unscaledHeight - 18) arrowTop = unscaledHeight - 18
                    arrow.style.top = `${arrowTop}px`
                }

                tooltip.style.left = `${left}px`
                tooltip.style.top = `${top}px`

                const status = target.getAttribute("data-tooltip-status")
                if (status === 'warning' || status === 'error') {
                    const bgColor = status === 'warning' ? '#d97706' : '#e11d48'
                    tooltip.style.backgroundColor = bgColor
                    tooltip.style.color = '#ffffff'
                    descEl.style.color = 'rgba(255, 255, 255, 0.9)'
                    if (dir === 'up') {
                        arrow.style.borderTopColor = bgColor
                    } else if (dir === 'down') {
                        arrow.style.borderBottomColor = bgColor
                    } else if (dir === 'left') {
                        arrow.style.borderLeftColor = bgColor
                    } else if (dir === 'right') {
                        arrow.style.borderRightColor = bgColor
                    }
                }
            } catch (error) {
                console.error("Failed to update tooltip position:", error)
            }
        }
    } catch (error) {
        console.error("Failed to setup tooltips:", error)
        sendError(error, "setupTooltips")
    }
}

window.setupTooltips = setupTooltips
