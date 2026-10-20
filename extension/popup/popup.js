import { TranslationCache } from "../scripts/translationCache.js"
import "../scripts/tooltips.js"

// One namespace for all three packages, so the builds stay true copies of each other. Firefox
// must have browser.* - its chrome.* is callback-only while these calls are promise-returning -
// and Chrome has no browser at all. Safari provides both and works either way.
const api = typeof browser !== "undefined" ? browser : chrome

const translationCache = new TranslationCache();
setupTooltips()

function hide(...elements) {
    for (const element of elements) {
        if (element) element.classList.add("hidden", "!hidden")
    }
}

function unhide(...elements) {
    for (const element of elements) {
        if (element) element.classList.remove("hidden", "!hidden")
    }
}

// --- Site access ---
// Firefox and Chrome let users limit an extension to some sites, which leaves Yomi unable to read
// images served from another host than the page. Safari never grants every site at once (asking only
// enables its per-site prompts), so there the button could not fix anything and the check is skipped.
const ALL_SITES = { origins: ["<all_urls>"] }
const SITE_ACCESS_TONES = {
    warning: {
        box: ["border-amber-500/30", "bg-amber-500/10", "text-amber-800", "dark:text-amber-200"],
        icon: "text-amber-500",
        path: "M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z",
    },
    success: {
        box: ["border-green-500/30", "bg-green-500/10", "text-green-800", "dark:text-green-200"],
        icon: "text-green-500",
        path: "M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    },
}
const siteAccess = document.getElementById("site-access")
const siteAccessIcon = document.getElementById("site-access-icon")
const siteAccessText = document.getElementById("site-access-text")
const siteAccessAllow = document.getElementById("site-access-allow")

function showSiteAccess(tone, text, buttonText = null) {
    for (const { box, icon } of Object.values(SITE_ACCESS_TONES)) {
        siteAccess.classList.remove(...box)
        siteAccessIcon.classList.remove(icon)
    }
    const { box, icon, path } = SITE_ACCESS_TONES[tone]
    siteAccess.classList.add(...box)
    siteAccess.classList.remove("opacity-0")
    siteAccess.setAttribute("role", tone === "success" ? "status" : "note")
    siteAccessIcon.classList.add(icon)
    siteAccessIcon.querySelector("path").setAttribute("d", path)
    siteAccessText.textContent = text
    if (buttonText) {
        siteAccessAllow.textContent = buttonText
        siteAccessAllow.disabled = false
        unhide(siteAccessAllow)
    } else {
        hide(siteAccessAllow)
    }
    unhide(siteAccess)
}

async function checkSiteAccess() {
    if (location.protocol === "safari-web-extension:") return
    try {
        if (!(await api.permissions.contains(ALL_SITES))) {
            showSiteAccess("warning", "Yomi has limited permissions and might not work well.", "Allow all sites")
        }
    } catch (e) {
        sendError(e, "site access check")
    }
}

siteAccessAllow.addEventListener("click", () => {
    // Firefox only prompts for a request made straight from the click, before any await.
    let request
    try {
        request = api.permissions.request(ALL_SITES)
    } catch (e) {
        request = Promise.reject(e)
    }
    siteAccessAllow.disabled = true
    siteAccessAllow.textContent = "Asking…"
    request.catch(() => false).then((granted) => {
        if (!granted) {
            showSiteAccess("warning", "Access wasn't allowed. Yomi still has limited permissions and might not work well.", "Try again")
            return
        }
        showSiteAccess("success", "Yomi can now read images on every site.")
        setTimeout(() => {
            siteAccess.classList.add("opacity-0")
            setTimeout(() => hide(siteAccess), 300)
        }, 5000)
    })
})

checkSiteAccess()

// --- Theme (dark mode) ---
// Synced via api.storage.sync (not localStorage - popup.html and each page's content
// script are separate origins/contexts and don't share localStorage) so the choice made here
// is picked up live by any open content script through api.storage.onChanged, and persists
// across devices the same way every other Yomi setting already does.
const YOMI_THEME_KEY = "yomi_theme"
const YOMI_THEME_FORCED_DARK_ONCE_KEY = "yomi_theme_forced_dark_once"

function applyPopupTheme(theme) {
    const isDark = theme !== "light"
    document.documentElement.classList.toggle("dark", isDark)
    document.querySelectorAll(".theme-sun").forEach(el => el.classList.toggle("hidden", !isDark))
    document.querySelectorAll(".theme-moon").forEach(el => el.classList.toggle("hidden", isDark))
}

api.storage.sync.get({ [YOMI_THEME_KEY]: null, [YOMI_THEME_FORCED_DARK_ONCE_KEY]: false }, (result) => {
    // One-time migration to dark-by-default, mirroring the website: anyone who never picked a
    // theme lands on dark once, then whatever's chosen (here or on the website, since both
    // read/write the same synced setting) is respected from then on.
    if (!result[YOMI_THEME_FORCED_DARK_ONCE_KEY]) {
        api.storage.sync.set({ [YOMI_THEME_KEY]: "dark", [YOMI_THEME_FORCED_DARK_ONCE_KEY]: true })
        applyPopupTheme("dark")
    } else {
        applyPopupTheme(result[YOMI_THEME_KEY])
    }
})

document.getElementById("toggle-theme").addEventListener("click", () => {
    const newTheme = document.documentElement.classList.contains("dark") ? "light" : "dark"
    api.storage.sync.set({ [YOMI_THEME_KEY]: newTheme })
    applyPopupTheme(newTheme)
})

api.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes[YOMI_THEME_KEY]) {
        applyPopupTheme(changes[YOMI_THEME_KEY].newValue)
    }
})

// --- Shared floating-dropdown infrastructure (ported from translate.js/content.js) ---
// Used by the Model/Font/Language custom dropdowns and the Saved Prompts dropdown in the
// redesigned Home tab. Keeps the list fully within the popup's small viewport: clamped
// horizontally, and flipped above the trigger (with a capped, scrollable max-height) when
// there isn't enough room below.
// ─── Custom dropdown selection ───────────────────────────────────────────────
//
// Every custom dropdown highlights its current row with Tailwind colour classes,
// but those are theme-split - "bg-cyan-300/60" in light, "dark:bg-cyan-600/60" in
// dark - so a selector built from one of them matches nothing in the other theme
// (and ".bg-cyan-600\/60" matched nothing in EITHER, since the dark class carries
// its "dark:" prefix in the DOM). This plain marker class is a stable hook that
// doesn't move when the palette does. It is styled by nothing; it only marks.
const DROPDOWN_SELECTED_CLASS = "dropdown-selected-option"

// The one place a row is painted as "current", so the marker can never drift away
// from the highlight it stands for.
// keepFontWeight is for rows previewing a font: a single-weight face asked for semibold gets
// synthetic bold, so the row would no longer show what actually renders.
function markDropdownItemSelected(item, { preserveTextColor = false, keepFontWeight = false } = {}) {
    item.classList.add(DROPDOWN_SELECTED_CLASS, "bg-cyan-300/60", "dark:bg-cyan-600/60")
    if (!keepFontWeight) item.classList.add("font-semibold")
    if (!preserveTextColor) {
        item.classList.add("text-neutral-900", "dark:text-white")
    }
    item.classList.remove(
        "hover:bg-neutral-200", "dark:hover:bg-neutral-700",
        "hover:bg-neutral-200/50", "dark:hover:bg-neutral-700/50",
        "hover:text-neutral-900", "dark:hover:text-white"
    )
}

// Brings the current row into view inside an open dropdown, the way a native
// <select> does: on open, and again after a typeahead match.
//
// Deliberately not scrollIntoView(). These lists are detached and positioned
// absolutely, so scrollIntoView walks up and scrolls the container too - and every
// dropdown here closes itself on a scroll, so the list would slam shut the moment
// it tried to scroll. Setting scrollTop touches only the list.
function scrollDropdownToSelected(listEl, { center = false } = {}) {
    if (!listEl) return
    scrollDropdownRowIntoView(listEl, listEl.querySelector("." + DROPDOWN_SELECTED_CLASS), { center })
}

// Same scrolling, for any row rather than specifically the selected one - the keyboard
// cursor (see DROPDOWN_ACTIVE_CLASS) moves independently of the selection.
// A list with a pinned header or footer scrolls an inner element instead of itself, so the
// helpers here have to ask which element actually scrolls rather than assume it is the list.
function getDropdownScroller(listEl) {
    if (!listEl) return null
    return listEl.querySelector(":scope > [data-dropdown-scroll]") || listEl
}

// Keeps the scrollbar between the header and footer instead of running the list's full height
// behind them. Positioned so it is the rows' offsetParent, which is what lets the offsetTop
// below stay in the scroller's own coordinates.
function createDropdownScrollArea() {
    const area = document.createElement("div")
    area.setAttribute("data-dropdown-scroll", "")
    area.className = "relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
    return area
}

function scrollDropdownRowIntoView(listEl, active, { center = false } = {}) {
    if (!listEl || listEl.classList.contains("hidden")) return
    if (!active) return

    const scroller = getDropdownScroller(listEl)
    if (!scroller) return

    const itemTop = active.offsetTop
    const itemHeight = active.offsetHeight
    const viewHeight = scroller.clientHeight
    const viewTop = scroller.scrollTop
    // A list with sticky headers sets their height as scroll-padding-top, so a row brought
    // into view at the top edge doesn't end up underneath one.
    const topInset = parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0

    if (itemTop >= viewTop + topInset && itemTop + itemHeight <= viewTop + viewHeight) return

    let target
    if (center) {
        // Opening: put it in the middle, so the options around it are visible too.
        target = itemTop - (viewHeight - itemHeight) / 2
    } else if (itemTop < viewTop + topInset) {
        // Typing: shortest scroll that reveals it, so repeated presses of the same
        // letter walk the list instead of making it jump around.
        target = itemTop - topInset
    } else {
        target = itemTop - viewHeight + itemHeight
    }

    const maxScroll = Math.max(0, scroller.scrollHeight - viewHeight)
    scroller.scrollTop = Math.min(maxScroll, Math.max(0, target))
}

// Rebuilds an open dropdown's rows and brings the new current row into view.
// Restoring scrollTop around the rebuild is what makes the "shortest scroll" above
// mean anything: a rebuild empties the list, which resets scrollTop to 0, so without
// this every keystroke would re-anchor at the top and land the match on the bottom
// edge no matter where it actually sits.
function refreshOpenDropdown(listEl, rebuild) {
    if (!listEl || listEl.classList.contains("hidden")) return
    const previous = getDropdownScroller(listEl)
    const previousScroll = previous ? previous.scrollTop : 0
    rebuild()
    // Re-resolved: a rebuild replaces the scroll area along with the rows inside it.
    const scroller = getDropdownScroller(listEl)
    if (scroller) scroller.scrollTop = previousScroll
    scrollDropdownToSelected(listEl)
}

// ─── Custom dropdown keyboard navigation ─────────────────────────────────────
//
// Up/Down walk the rows of an open dropdown, Enter commits the row under the keyboard
// cursor, Escape closes it. Up/Down on a closed dropdown opens it, the way a native
// <select> does. Keys reach them through listenForDropdownKeys, same as the typeahead.
//
// The cursor is deliberately a SEPARATE marker from DROPDOWN_SELECTED_CLASS: "selected"
// is the value the control currently holds, "active" is only where the keyboard cursor
// is sitting. Keeping them apart means walking the list never repaints the selected row
// (whose styling isn't uniform - the model dropdown's BYOK badge inverts its colours on
// the selected row, disabled rows have their hover classes stripped), and - the real
// reason - it means arrowing does not COMMIT. That matters most for the source-language
// dropdown, where committing adds a language to the whitelist: browsing it from the
// keyboard must not quietly whitelist every language passed over on the way down.
const DROPDOWN_ACTIVE_CLASS = "dropdown-active-option"

// Safari and Firefox on macOS never focus a clicked <button>, and a click beside the trigger focuses
// nothing, so an open list also takes the keys that land on no control of their own.
function listenForDropdownKeys(triggerEl, listEl, onKeydown) {
    triggerEl.addEventListener("keydown", onKeydown)
    document.addEventListener("keydown", (e) => {
        const focused = document.activeElement
        if (e.defaultPrevented || listEl.classList.contains("hidden") || focused === triggerEl) return
        if (focused && (focused.isContentEditable || focused.matches("input, textarea, select, button, a[href]"))) return
        onKeydown(e)
        if (e.defaultPrevented) e.stopPropagation()
    }, true)
}

// Only rows a click would actually act on. Every list here paints its interactive rows
// with cursor-pointer and leaves it off the ones that aren't (headers, dividers, status
// notes) or strips it in favour of cursor-not-allowed (unsupported font, already-
// whitelisted language), so that class is the one signal consistent across all of them.
// Enter on a row with no click handler is a harmless no-op regardless.
function getSelectableDropdownRows(listEl) {
    const scroller = getDropdownScroller(listEl)
    if (!scroller) return []
    return Array.from(scroller.children).filter(row =>
        row.classList.contains("cursor-pointer") && !row.classList.contains("cursor-not-allowed")
    )
}

function setActiveDropdownRow(listEl, row) {
    if (!listEl) return
    listEl.querySelectorAll("." + DROPDOWN_ACTIVE_CLASS)
        .forEach(el => el.classList.remove(DROPDOWN_ACTIVE_CLASS))
    if (!row) return
    row.classList.add(DROPDOWN_ACTIVE_CLASS)
    scrollDropdownRowIntoView(listEl, row)
}

// Safari reports the Enter that confirms a composition with isComposing false; keyCode 229 catches it.
function isImeComposing(e) {
    return e.isComposing || e.keyCode === 229
}

// onActiveRowChange(row) fires every time the cursor lands somewhere new (row is null
// when it's cleared), so a list can mirror whatever its hover does - the font dropdown
// uses it to drive the same live canvas preview a pointer gets.
// spaceCommits=false is for a text field driving the list, where Space has to type a space.
function setupDropdownArrowKeys(triggerEl, listEl, toggleDropdown, { onActiveRowChange, spaceCommits = true } = {}) {
    if (!triggerEl || !listEl) return

    const setActive = (row) => {
        setActiveDropdownRow(listEl, row)
        if (typeof onActiveRowChange === "function") onActiveRowChange(row || null)
    }

    listenForDropdownKeys(triggerEl, listEl, (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey || isImeComposing(e)) return

        const isOpen = !listEl.classList.contains("hidden")

        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault()

            if (!isOpen) {
                toggleDropdown(true)
                // First press only reveals the list, with the cursor parked on the
                // current value - it doesn't also move off it.
                const rows = getSelectableDropdownRows(listEl)
                const selected = listEl.querySelector("." + DROPDOWN_SELECTED_CLASS)
                setActive((selected && rows.includes(selected)) ? selected : rows[0])
                return
            }

            const rows = getSelectableDropdownRows(listEl)
            if (rows.length === 0) return

            let current = listEl.querySelector("." + DROPDOWN_ACTIVE_CLASS)
            if (!current) {
                // Opened with the mouse, or rebuilt by a typeahead match, so no cursor has
                // been placed yet - start from the selected row rather than the top.
                const selected = listEl.querySelector("." + DROPDOWN_SELECTED_CLASS)
                if (selected && rows.includes(selected)) current = selected
            }

            const currentIndex = current ? rows.indexOf(current) : -1
            const step = e.key === "ArrowDown" ? 1 : -1
            // Clamped rather than wrapped, matching a native select - wrapping makes it
            // easy to shoot off the end of a long font list without noticing.
            const next = currentIndex === -1
                ? (step === 1 ? 0 : rows.length - 1)
                : Math.min(rows.length - 1, Math.max(0, currentIndex + step))

            setActive(rows[next])
            return
        }

        if (!isOpen) return

        if (e.key === "Enter" || (e.key === " " && spaceCommits)) {
            const active = listEl.querySelector("." + DROPDOWN_ACTIVE_CLASS)
            if (!active) return
            // Without preventDefault the browser also turns this key into a click on the
            // trigger button, which would toggle the list shut underneath the commit.
            e.preventDefault()
            // Clicking the row reuses whatever that particular list already does on click
            // - set the value, dispatch change, add to the whitelist, close itself - so
            // none of that logic is duplicated (or able to drift) here.
            active.click()
            return
        }

        if (e.key === "Escape") {
            e.preventDefault()
            // This Escape belongs to the dropdown. Without stopping it, it also reaches
            // the document-level handler and closes the entire workspace.
            e.stopPropagation()
            toggleDropdown(false)
        }
    })
}

function positionFloatingDropdown(anchorEl, listEl, gap = 6) {
    const padding = 8
    const maxListHeight = 384 // matches max-h-96

    listEl.style.position = "fixed"
    listEl.style.visibility = "hidden"
    listEl.style.maxHeight = ""
    listEl.style.maxWidth = `${window.innerWidth - padding * 2}px`
    listEl.style.top = "0px"
    listEl.style.left = "0px"
    listEl.classList.remove("hidden")

    const anchorRect = anchorEl.getBoundingClientRect()
    listEl.style.minWidth = `${anchorRect.width}px`

    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const listRect = listEl.getBoundingClientRect()

    let left = anchorRect.left
    if (left + listRect.width > viewportWidth - padding) {
        left = viewportWidth - listRect.width - padding
    }
    if (left < padding) left = padding

    const spaceBelow = viewportHeight - anchorRect.bottom - gap - padding
    const spaceAbove = anchorRect.top - gap - padding

    let top, maxHeight
    if (listRect.height <= spaceBelow || spaceBelow >= spaceAbove) {
        top = anchorRect.bottom + gap
        maxHeight = Math.max(Math.min(spaceBelow, maxListHeight), 80)
    } else {
        maxHeight = Math.max(Math.min(spaceAbove, maxListHeight), 80)
        top = anchorRect.top - gap - Math.min(listRect.height, maxHeight)
    }

    listEl.style.maxHeight = `${maxHeight}px`
    listEl.style.top = `${top}px`
    listEl.style.left = `${left}px`
    listEl.style.visibility = "visible"
}

// A rebuild can change a floating list's height - deleting a row most obviously - and a list that
// was flipped ABOVE its trigger is anchored by its bottom edge, so a shorter one has to be moved
// back down or it hangs in mid-air. No-op while closed, because positioning also unhides.
function repositionOpenDropdown(anchorEl, listEl, gap = 6) {
    if (!listEl || listEl.classList.contains("hidden")) return
    positionFloatingDropdown(anchorEl, listEl, gap)
}

// Typeahead ("type to search") for the custom dropdowns, mirroring native <select> behavior:
// typing while the trigger is focused or the list is open jumps to the first matching option, and
// repeating the same letter cycles through every option starting with it.
function setupDropdownTypeahead(triggerEl, listEl, selectEl, { isSelectable = (opt) => !opt.disabled, onMatch } = {}) {
    if (!triggerEl || !listEl || !selectEl) return

    let buffer = ""
    let lastKeyTime = 0

    listenForDropdownKeys(triggerEl, listEl, (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || !/[a-z0-9]/i.test(e.key)) return

        e.preventDefault()

        const now = Date.now()
        buffer = (now - lastKeyTime > 700) ? e.key.toLowerCase() : buffer + e.key.toLowerCase()
        lastKeyTime = now

        const opts = Array.from(selectEl.options)
        if (opts.length === 0) return

        const isSingleCharRepeat = buffer.length > 1 && buffer.split("").every(c => c === buffer[0])
        const searchTerm = isSingleCharRepeat ? buffer[0] : buffer

        const currentIndex = selectEl.selectedIndex >= 0 ? selectEl.selectedIndex : -1

        for (let i = 1; i <= opts.length; i++) {
            const idx = (currentIndex + i) % opts.length
            const opt = opts[idx]
            if (!isSelectable(opt)) continue
            if (opt.text.trim().toLowerCase().startsWith(searchTerm)) {
                selectEl.value = opt.value
                selectEl.dispatchEvent(new Event("change"))
                if (typeof onMatch === "function") onMatch(opt)
                break
            }
        }
    })
}

const loader = document.getElementById("loader")
const login = document.getElementById("login")
const content = document.getElementById("content")
const footer = document.getElementById("footer")
const header = document.getElementById("header")
const credits = document.getElementById("credits")

if (isMobile()) {
    document.documentElement.classList.add("is-mobile")
    document.addEventListener("focusin", (e) => {
        if (!e.target?.matches?.("input[type=text], textarea")) return
        requestAnimationFrame(() => scrollFocusedFieldIntoView(e.target))
    })
}

// Same controls as edit mode, so this is content.js's registerSliderTouchGesture verbatim -
// the popup cannot import from a content script, and the two behaving differently would be
// worse than the duplication. A slider sits inside a scrolling panel, so a touch landing on one is ambiguous until it moves:
// sideways means the user wants the slider, downwards means they want to scroll past it. Nothing
// is committed until the finger clears SLIDER_GESTURE_THRESHOLD, and once committed the gesture
// stays that way until release. touchstart is cancelled outright so the native range drag and
// native scrolling cannot both run alongside whichever one we picked - which is what made this
// feel random before, since it depended on where in the 6px track the finger landed.
const SLIDER_GESTURE_THRESHOLD = 8

function findScrollParent(el) {
    const view = el.ownerDocument.defaultView
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        const overflowY = view.getComputedStyle(parent).overflowY
        if (overflowY === "auto" || overflowY === "scroll") return parent
    }
    return null
}


// A scroll driven from finger position has no inertia of its own, so a flick stops dead the
// moment the finger lifts - which reads as a stutter next to every other scrollable surface.
// Carries the last measured velocity on for a few frames instead, and any new touch kills it.
let activeGlide = null

function stopGlide() {
    if (activeGlide) activeGlide.cancelled = true
    activeGlide = null
}

function glideScroll(scroller, velocity) {
    stopGlide()
    if (!scroller || Math.abs(velocity) < 0.05) return

    const view = scroller.ownerDocument.defaultView
    const glide = { cancelled: false }
    activeGlide = glide
    let last = Date.now()

    const step = () => {
        if (glide.cancelled) return
        const now = Date.now()
        const elapsed = Math.min(32, now - last)
        last = now

        const before = scroller.scrollTop
        scroller.scrollTop -= velocity * elapsed
        velocity *= Math.pow(0.95, elapsed / 16)

        if (Math.abs(velocity) > 0.02 && scroller.scrollTop !== before) {
            view.requestAnimationFrame(step)
        } else if (activeGlide === glide) {
            activeGlide = null
        }
    }

    view.requestAnimationFrame(step)
}

function registerSliderTouchGesture(sliderEl) {
    let startX = null
    let startY = null
    let startScrollTop = 0
    let mode = null
    let scroller = null
    let lastY = 0
    let lastTime = 0
    let velocity = 0
    let lockedOverflowY = null

    // preventDefault() cannot stop a scroll Gecko's compositor has already committed to, and
    // writing scrollTop back every frame just fights it visibly. Taking scrollability away for
    // the duration of a sideways gesture stops it outright; scrollTop survives overflow:hidden.
    const lockScroller = () => {
        if (!scroller || lockedOverflowY !== null) return
        lockedOverflowY = scroller.style.overflowY
        scroller.style.overflowY = "hidden"
    }

    const unlockScroller = () => {
        if (!scroller || lockedOverflowY === null) return
        scroller.style.overflowY = lockedOverflowY
        lockedOverflowY = null
    }

    const setValueFromX = (clientX) => {
        const rect = sliderEl.getBoundingClientRect()
        if (!rect.width) return
        const min = Number(sliderEl.min === "" ? 0 : sliderEl.min)
        const max = Number(sliderEl.max === "" ? 100 : sliderEl.max)
        const step = Number(sliderEl.step) || 1
        const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
        const next = Math.min(max, Math.max(min, Math.round((min + ratio * (max - min)) / step) * step))
        if (Number(sliderEl.value) === next) return
        sliderEl.value = next
        sliderEl.dispatchEvent(new Event("input", { bubbles: true }))
    }

    sliderEl.addEventListener("touchstart", (e) => {
        if (e.touches.length !== 1) return
        e.preventDefault()
        startX = e.touches[0].clientX
        startY = e.touches[0].clientY
        mode = null
        scroller = findScrollParent(sliderEl)
        startScrollTop = scroller ? scroller.scrollTop : 0
        lastY = startY
        lastTime = Date.now()
        velocity = 0
        stopGlide()
    }, { passive: false })

    sliderEl.addEventListener("touchmove", (e) => {
        if (startX === null || e.touches.length !== 1) return
        e.preventDefault()

        const deltaX = e.touches[0].clientX - startX
        const deltaY = e.touches[0].clientY - startY

        if (mode === null) {
            if (Math.abs(deltaX) < SLIDER_GESTURE_THRESHOLD && Math.abs(deltaY) < SLIDER_GESTURE_THRESHOLD) return
            mode = Math.abs(deltaX) > Math.abs(deltaY) ? "slide" : "scroll"
        }

        if (mode === "slide") {
            lockScroller()
            setValueFromX(e.touches[0].clientX)
        } else if (scroller) {
            const now = Date.now()
            const elapsed = now - lastTime
            if (elapsed > 0) velocity = (e.touches[0].clientY - lastY) / elapsed
            lastY = e.touches[0].clientY
            lastTime = now
            scroller.scrollTop = startScrollTop - deltaY
        }
    }, { passive: false })

    const endGesture = () => {
        // A tap never picks a direction and still has to land the value where it was tapped.
        if (mode === null && startX !== null) setValueFromX(startX)
        unlockScroller()
        if (mode === "slide") sliderEl.dispatchEvent(new Event("change", { bubbles: true }))
        if (mode === "scroll" && Date.now() - lastTime < 100) glideScroll(scroller, velocity)
        startX = null
        startY = null
        mode = null
    }

    sliderEl.addEventListener("touchend", endGesture, { passive: true })
    sliderEl.addEventListener("touchcancel", endGesture, { passive: true })
}

document.querySelectorAll("input[type='range']")
    .forEach(sliderEl => registerSliderTouchGesture(sliderEl))

const recentGridView = document.getElementById("recent-grid-view")
const recentGrid = document.getElementById("recent-grid")
const recentEmpty = document.getElementById("recent-empty")
const autoSaveContainer = document.getElementById("auto-save-container")
const recentDetailView = document.getElementById("recent-detail-view")
const recentImage = document.getElementById("recent-image")
const recentBackBtn = document.getElementById("recent-back")
const recentBadge = document.getElementById("recent-badge")
const recentDate = document.getElementById("recent-date")
const recentFlipBtn = document.getElementById("recent-flip")
const recentDownloadBtn = document.getElementById("recent-download")
const recentOpenBtn = document.getElementById("recent-open")
const recentInfoBtn = document.getElementById("recent-info")
const recentDeleteBtn = document.getElementById("recent-delete")
const paginationControls = document.getElementById("pagination-controls")
const prevPageBtn = document.getElementById("prev-page-btn")
const nextPageBtn = document.getElementById("next-page-btn")
const pageIndicator = document.getElementById("page-indicator")
const prevRecentBtn = document.getElementById("prev-recent-btn")
const nextRecentBtn = document.getElementById("next-recent-btn")
const recentInfoPopover = document.getElementById("recent-info-popover")
const recentInfoContent = document.getElementById("recent-info-content")
const retentionSelect = document.getElementById("retention-select")
const autoSaveToggle = document.getElementById("auto-save-toggle")
const autoSaveFolderInput = document.getElementById("auto-save-folder")

let currentRecentItems = []
let currentViewingItem = null
let currentViewMode = 'translated'
let currentPage = 1
let hasNextPage = false
const RECENT_LIMIT = 6 // 3 cols x 2 rows

const home = document.getElementById("home")
const homeButton = document.getElementById("home-button")
const settings = document.getElementById("settings")
const settingsButton = document.getElementById("settings-button")
const recent = document.getElementById("recent")
const recentButton = document.getElementById("recent-button")

const languageSelect = document.getElementById("language-select")
const modelSelect = document.getElementById("model-select")

// The credit cost moved out of the label and into the `cost` tier, drawn as dots beside each
// row - see createCostDots(). gpt-5.4 and claude-sonnet-4.6 are gone from the list and
// "deepseek" is now "deepseek-v4-flash"; all three remain back-compat aliases in api.py, so a
// user still holding one of the old values keeps translating with it until they pick another.
//
// MAINTENANCE: the tiers and the USD-per-1M prices are both hand-copied from
// calculate_total_cost_in_usd() in api.py, which is the only source of truth. If a price
// changes there, or a model is added, update both here by hand. Nothing will warn you.
const defaultModels = [
    { value: "gemini-3.8-flash", text: "Gemini 3.8 Flash (Latest Model - High Quality & Multimodal)", provider: "google", cost: 1, inputPerM: 0.75, outputPerM: 3.75 },
    { value: "gemini-3.5-flash-lite", text: "Gemini 3.5 Flash Lite (500 RPD, 15 RPM - High Quota & Fast)", provider: "google", cost: 1, inputPerM: 0.20, outputPerM: 1.00 },
    { value: "gemini-3.1-flash-lite", text: "Gemini 3.1 Flash Lite (500 RPD, 15 RPM - Ultra Fast)", provider: "google", cost: 1, inputPerM: 0.25, outputPerM: 1.50 },
    { value: "gemini-2.5-flash", text: "Gemini 2.5 Flash (20 RPD - Low Free Limit)", provider: "google", cost: 1, inputPerM: 0.15, outputPerM: 0.60 },
    { value: "gemini-2.5-flash-lite", text: "Gemini 2.5 Flash Lite (20 RPD - Low Free Limit)", provider: "google", cost: 1, inputPerM: 0.10, outputPerM: 0.40 },
    { value: "gemini-2.0-flash", text: "Gemini 2.0 Flash", provider: "google", cost: 1, inputPerM: 0.10, outputPerM: 0.40 },
    { value: "gpt-4o", text: "GPT-4o", provider: "openai", cost: 2, inputPerM: 2.50, outputPerM: 10.00 },
    { value: "deepseek-chat", text: "DeepSeek V3", provider: "deepseek", cost: 1, inputPerM: 0.14, outputPerM: 0.28 },
    { value: "claude-3-5-sonnet", text: "Claude 3.5 Sonnet", provider: "anthropic", cost: 3, inputPerM: 3.00, outputPerM: 15.00 },
];

const COST_DOT_LEVELS = 5

// Null rather than a guess for anything with no tier set - a self-hosted model has no price
// we know, and inventing dots for it would be worse than showing none.
function getModelCostTier(model) {
    if (!model || !Number.isInteger(model.cost)) return null
    if (model.cost < 1 || model.cost > COST_DOT_LEVELS) return null
    return model.cost
}

// Builds the dot row as its own element so the label beside it can still truncate freely.
function createCostDots(tier) {
    const wrap = document.createElement("span")
    wrap.className = "shrink-0 flex items-center gap-0.5"
    wrap.setAttribute("aria-label", `Relative cost ${tier} of ${COST_DOT_LEVELS}`)
    wrap.setAttribute("role", "img")

    const activeColorClass = tier >= 5
        ? "text-red-500 dark:text-red-400"
        : tier === 4
            ? "text-amber-500 dark:text-amber-400"
            : "text-neutral-600 dark:text-neutral-300"

    for (let i = 1; i <= COST_DOT_LEVELS; i++) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
        svg.setAttribute("viewBox", "0 0 24 24")
        svg.setAttribute("aria-hidden", "true")
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle")
        circle.setAttribute("cx", "12")
        circle.setAttribute("cy", "12")
        if (i <= tier) {
            svg.setAttribute("class", `w-2 h-2 shrink-0 ${activeColorClass}`)
            circle.setAttribute("r", "10")
            circle.setAttribute("fill", "currentColor")
        } else {
            svg.setAttribute("class", "w-2 h-2 shrink-0 text-neutral-600 dark:text-neutral-300 opacity-70")
            circle.setAttribute("r", "8.5")
            circle.setAttribute("fill", "none")
            circle.setAttribute("stroke", "currentColor")
            circle.setAttribute("stroke-width", "3")
        }
        svg.appendChild(circle)
        wrap.appendChild(svg)
    }
    return wrap
}

// Fixed width and tabular figures so the dots that follow land in the same column on every
// row - the prices themselves are ragged, from $0.14 to $25.00.
function createCostPrice(model) {
    if (!model || typeof model.inputPerM !== "number" || typeof model.outputPerM !== "number") return null

    const price = document.createElement("span")
    price.className = "shrink-0 w-[4.75rem] text-right tabular-nums text-[0.6rem] leading-none text-neutral-500 dark:text-neutral-400"
    price.innerText = `$${model.inputPerM.toFixed(2)} / $${model.outputPerM.toFixed(2)}`
    price.dataset.tooltipTitle = `$${model.inputPerM.toFixed(2)} per 1M input tokens, $${model.outputPerM.toFixed(2)} per 1M output tokens`
    return price
}

// The prices read as a bill unless something says otherwise. Outside the scroll area, so it
// stays put and the scrollbar stops short of it.
function createModelListFooter() {
    const footer = document.createElement("div")
    footer.className = "shrink-0 flex items-center gap-1.5 px-3 py-1 select-none cursor-default bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-700 text-[0.65rem] leading-snug text-neutral-400 dark:text-neutral-500"

    const note = document.createElement("span")
    note.className = "whitespace-nowrap"
    note.textContent = "Provider list price per 1M tokens. Yomi bills in credits."
    footer.appendChild(note)

    const help = document.createElement("button")
    help.type = "button"
    help.className = "shrink-0 flex items-center cursor-pointer focus:outline-none text-neutral-400 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-300 transition-colors"
    help.setAttribute("aria-label", "How model pricing works")
    help.setAttribute("data-tooltip-title", "How model pricing works")
    help.setAttribute("data-tooltip-direction", "up")
    help.setAttribute("data-tooltip-mobile", "true")
    help.setAttribute("data-tooltip-desc", "Models bill per token - roughly three quarters of a word - and charge more for text they write than text they read, so a page with more text on it costs more.<br><br>The figures shown are the provider's own list price in USD per million tokens, for comparing models. Yomi bills you in credits, never in dollars, and the model you pick is what decides how many.<br><br>With your own API key it is a flat 1 credit per image and your provider bills those rates directly.")
    // Sized by attribute as well as class: the icon has no intrinsic size, so if w-3.5/h-3.5
    // are missing from the compiled CSS it renders at the SVG default instead of 14px.
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    icon.setAttribute("viewBox", "0 0 24 24")
    icon.setAttribute("width", "14")
    icon.setAttribute("height", "14")
    icon.setAttribute("fill", "currentColor")
    icon.setAttribute("aria-hidden", "true")
    icon.setAttribute("class", "w-3.5 h-3.5 shrink-0")
    const iconPath = document.createElementNS("http://www.w3.org/2000/svg", "path")
    iconPath.setAttribute("d", "M12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22ZM12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20ZM11 15H13V17H11V15ZM13 13.3551V14H11V12.5C11 11.9477 11.4477 11.5 12 11.5C12.8284 11.5 13.5 10.8284 13.5 10C13.5 9.17157 12.8284 8.5 12 8.5C11.2723 8.5 10.6656 9.01823 10.5288 9.70577L8.56731 9.31346C8.88637 7.70919 10.302 6.5 12 6.5C13.933 6.5 15.5 8.067 15.5 10C15.5 11.5855 14.4457 12.9248 13 13.3551Z")
    icon.appendChild(iconPath)
    help.appendChild(icon)
    footer.appendChild(help)

    return footer
}

function createModelListHeader() {
    const header = document.createElement("div")
    header.className = "shrink-0 flex items-center gap-1.5 px-3 py-1 select-none bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-700 text-xs uppercase font-bold tracking-wider text-neutral-400 dark:text-neutral-500"

    const left = document.createElement("span")
    left.className = "flex-grow pr-4"
    left.textContent = "Model"
    header.appendChild(left)

    const price = document.createElement("span")
    price.className = "shrink-0 w-[4.75rem] text-right text-[0.5rem] tracking-normal"
    price.textContent = "$/1M in / out"
    header.appendChild(price)

    const right = document.createElement("span")
    right.className = "shrink-0 w-12 text-center"
    right.textContent = "Cost"
    header.appendChild(right)

    return header
}

function updateModelSelectDropdown() {
    return new Promise((resolve) => {
        api.storage.sync.get({
            translation_model: "gemini-3.1-flash-lite",
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
            yomi_byok_local_url: "",
            yomi_byok_local_model: "",
            yomi_byok_local_enabled: true
        }, (result) => {
            // Pure renames of a model that still exists, so the stored value is migrated rather
            // than allowed to fall through the not-found branch below - which would silently move
            // the user onto a different model entirely. Retired models (gpt-5.4, claude-sonnet-4.6)
            // are deliberately NOT listed here: for those, falling back is the right outcome.
            const RENAMED_MODELS = { "deepseek": "deepseek-v4-flash" };

            const storedValue = modelSelect.value || result["translation_model"] || "gemini-3.1-flash-lite";
            const currentSelectedValue = RENAMED_MODELS[storedValue] || storedValue;
            if (currentSelectedValue !== storedValue) {
                api.storage.sync.set({ translation_model: currentSelectedValue });
            }

            modelSelect.innerHTML = "";

            const optionsToRender = [];

            const isBYOKAvailable = (provider) => {
                const openRouterEnabled = result["yomi_byok_openrouter_enabled"] !== false;
                const hasOpenRouter = openRouterEnabled && !!result["yomi_byok_openrouter"];
                if (hasOpenRouter) return true;
                if (!provider) return false;
                const providerEnabled = result[`yomi_byok_${provider}_enabled`] !== false;
                return providerEnabled && !!result[`yomi_byok_${provider}`];
            };

            const localEnabled = result["yomi_byok_local_enabled"] !== false;
            const localUrlVal = result["yomi_byok_local_url"];
            const localModelName = result["yomi_byok_local_model"];
            const localUrlClean = localUrlVal ? localUrlVal.trim() : "";
            const localModelClean = localModelName ? localModelName.trim() : "";
            const localIsValid = localEnabled && localUrlClean !== "" && localModelClean !== "";

            // Add standard models
            defaultModels.forEach(m => {
                if (localIsValid && m.value === localModelClean) {
                    return; // Skip standard model to let the local/BYOK variant dominate and avoid duplicate option
                }
                const available = isBYOKAvailable(m.provider);
                optionsToRender.push({
                    value: m.value,
                    originalText: m.text,
                    isBYOK: available,
                    byokAvailable: available
                });
            });

            // Add self-hosted model if configured (both URL and Model Name must be filled and non-empty)
            if (localIsValid) {
                optionsToRender.push({
                    value: localModelClean,
                    originalText: localModelClean,
                    isBYOK: true,
                    byokAvailable: true
                });
            }

            // Sort options: BYOK-available models at the top
            optionsToRender.sort((a, b) => {
                const aAvailable = a.byokAvailable ? 1 : 0;
                const bAvailable = b.byokAvailable ? 1 : 0;
                return bAvailable - aAvailable;
            });

            // Render options
            optionsToRender.forEach(opt => {
                const optionEl = document.createElement("option");
                optionEl.value = opt.value;
                optionEl.text = opt.originalText;
                if (opt.isBYOK) {
                    optionEl.dataset.byok = "true";
                }
                modelSelect.appendChild(optionEl);
            });

            // Restore selected value if valid, otherwise select first option
            const optionExists = Array.from(modelSelect.options).some(opt => opt.value === currentSelectedValue);
            if (optionExists) {
                modelSelect.value = currentSelectedValue;
            } else {
                if (modelSelect.options.length > 0) {
                    modelSelect.selectedIndex = 0;
                    api.storage.sync.set({ translation_model: modelSelect.value });
                }
            }
            syncModelDropdownToSelect();
            resolve();
        });
    });
}

// --- Custom Model Dropdown ---
const modelSelectBox = document.getElementById("model-select-box")
const modelDropdownTrigger = document.getElementById("model-dropdown-trigger")
const modelDropdownList = document.getElementById("model-dropdown-list")
const modelDropdownArrow = document.getElementById("model-dropdown-arrow")
const modelDropdownSelectedText = document.getElementById("model-dropdown-selected-text")

function createByokBadge(selected = false) {
    const badge = document.createElement("span")
    badge.className = selected
        ? "shrink-0 inline-block align-middle text-[0.6rem] leading-none px-1.5 py-0.5 rounded bg-white/25 text-white font-semibold"
        : "shrink-0 inline-block align-middle text-[0.6rem] leading-none px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold"
    badge.innerText = "BYOK"
    return badge
}

function syncModelDropdownToSelect() {
    if (!modelDropdownSelectedText) return
    const selectedOpt = modelSelect.options[modelSelect.selectedIndex]
    modelDropdownSelectedText.innerHTML = ""
    if (!selectedOpt) {
        modelDropdownSelectedText.innerText = modelSelect.value
        return
    }
    if (selectedOpt.dataset.byok === "true") {
        modelDropdownSelectedText.appendChild(createByokBadge())
        modelDropdownSelectedText.appendChild(document.createTextNode(" "))
    }
    modelDropdownSelectedText.appendChild(document.createTextNode(selectedOpt.text))
}

function toggleModelDropdown(show) {
    if (!modelDropdownList || !modelDropdownTrigger) return
    const isHidden = modelDropdownList.classList.contains("hidden")
    const shouldShow = show !== undefined ? show : isHidden

    if (shouldShow) {
        updateModelDropdownList()
        positionFloatingDropdown(modelSelectBox || modelDropdownTrigger, modelDropdownList, 6)
        // After positioning, so the list's final max-height is what we scroll within.
        scrollDropdownToSelected(modelDropdownList, { center: true })
        if (modelDropdownArrow) modelDropdownArrow.classList.add("rotate-180")
    } else {
        modelDropdownList.classList.add("hidden")
        if (modelDropdownArrow) modelDropdownArrow.classList.remove("rotate-180")
    }
}

if (modelSelectBox) {
    modelSelectBox.addEventListener("click", (e) => {
        // Unlike the website, the popup leaves the list inside #model-select-box rather than
        // reparenting it to <body>, so every click within the open list bubbles back to here.
        // Without this the box reads them as taps on its own trigger: the footer's help button
        // closed the list, and picking a row closed then immediately reopened it.
        if (modelDropdownList && modelDropdownList.contains(e.target)) return
        toggleModelDropdown()
    })
}

document.addEventListener("click", (e) => {
    if (modelDropdownList && !modelDropdownList.classList.contains("hidden")) {
        if (modelSelectBox && !modelSelectBox.contains(e.target) && !modelDropdownList.contains(e.target)) {
            toggleModelDropdown(false)
        }
    }
})

window.addEventListener("scroll", (e) => {
    if (modelDropdownList && modelDropdownList.contains(e.target)) {
        return
    }
    toggleModelDropdown(false)
}, true)

function updateModelDropdownList() {
    if (!modelDropdownList) return
    const currentValue = modelSelect.value
    modelDropdownList.innerHTML = ""
    modelDropdownList.appendChild(createModelListHeader())

    const rows = createDropdownScrollArea()
    modelDropdownList.appendChild(rows)

    Array.from(modelSelect.options).forEach(opt => {
        const item = document.createElement("div")
        item.className = "flex items-center gap-1.5 px-3 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 cursor-pointer text-neutral-800 dark:text-neutral-100 transition-colors min-w-0"

        const isSelected = opt.value === currentValue
        if (isSelected) {
            markDropdownItemSelected(item)
        }

        if (opt.dataset.byok === "true") {
            item.appendChild(createByokBadge(isSelected))
        }

        const textSpan = document.createElement("span")
        textSpan.className = "flex-grow select-none pr-4 text-base truncate max-w-48 sm:max-w-64"
        textSpan.innerText = opt.text
        textSpan.title = opt.text
        item.appendChild(textSpan)

        // Inverted for BYOK: the dots rank what Yomi charges, which goes flat at 1 credit on the
        // user's own key, while the provider's per-token price is exactly what that key gets billed.
        const model = defaultModels.find(m => m.value === opt.value)
        const price = createCostPrice(model)
        if (price) item.appendChild(price)

        if (opt.dataset.byok !== "true") {
            const tier = getModelCostTier(model)
            if (tier !== null) item.appendChild(createCostDots(tier))
        }

        item.addEventListener("click", () => {
            modelSelect.value = opt.value
            syncModelDropdownToSelect()
            modelSelect.dispatchEvent(new Event("change"))
            toggleModelDropdown(false)
        })

        rows.appendChild(item)
    })

    modelDropdownList.appendChild(createModelListFooter())
}

setupDropdownTypeahead(modelDropdownTrigger, modelDropdownList, modelSelect, {
    onMatch: () => {
        syncModelDropdownToSelect()
        refreshOpenDropdown(modelDropdownList, updateModelDropdownList)
    }
})

setupDropdownArrowKeys(modelDropdownTrigger, modelDropdownList, toggleModelDropdown)

function validateLocalModelInput() {
    const localUrlInputVal = document.getElementById("byok-local-url-input");
    const localModelInputVal = document.getElementById("byok-local-model-input");
    if (!localModelInputVal) return;

    const localUrlVal = localUrlInputVal ? localUrlInputVal.value.trim() : "";
    const localModelVal = localModelInputVal ? localModelInputVal.value.trim() : "";

    if (localUrlVal !== "" && localModelVal === "") {
        localModelInputVal.classList.add("!border-red-500", "!ring-red-500", "ring-1");
    } else {
        localModelInputVal.classList.remove("!border-red-500", "!ring-red-500", "ring-1");
    }
}

function autoSelectModelForProvider(provider) {
    const currentModel = modelSelect.value;
    const currentModelData = defaultModels.find(m => m.value === currentModel);
    if (currentModelData && currentModelData.provider === provider) {
        return;
    }
    const topmostModel = defaultModels.find(m => m.provider === provider);
    if (topmostModel) {
        modelSelect.value = topmostModel.value;
        api.storage.sync.set({ translation_model: topmostModel.value });
    }
}

function autoSelectLocalModel() {
    const localUrlInputVal = document.getElementById("byok-local-url-input");
    const localModelInputVal = document.getElementById("byok-local-model-input");
    const url = localUrlInputVal ? localUrlInputVal.value.trim() : "";
    const modelName = localModelInputVal ? localModelInputVal.value.trim() : "";
    if (url !== "" && modelName !== "") {
        if (modelSelect.value !== modelName) {
            modelSelect.value = modelName;
            api.storage.sync.set({ translation_model: modelName });
        }
    }
}
const fontSelect = document.getElementById("font-select")
const minFontSizeInput = document.getElementById("min-font-size")
const textAlignmentButtons = {
    auto: document.getElementById("text-alignment-auto"),
    left: document.getElementById("text-alignment-left"),
    center: document.getElementById("text-alignment-center"),
    right: document.getElementById("text-alignment-right")
}

const loginError = document.getElementById("login-error")
const loginInfo = document.getElementById("login-info")

const enabled = document.getElementById("enabled")
const defaultEnabled = document.getElementById("default-enabled")
const textStroke = document.getElementById("stroke-disabled-btn")
const bubblesOnly = document.getElementById("bubbles-only-btn")
const contextSharing = document.getElementById("share-context-btn")
const autocache = document.getElementById("autocache")
const minImageSizeInput = document.getElementById("min-image-size")
const minImageSizeValue = document.getElementById("min-image-size-value")

const yomiTL = document.getElementById("yomi-tl")
const yomiTR = document.getElementById("yomi-tr")

const toggleCustomPromptBtn = document.getElementById("toggle-custom-prompt")
const customPromptBody = document.getElementById("custom-prompt-body")
const customPromptStatus = document.getElementById("custom-prompt-status")
const customPromptInput = document.getElementById("custom-prompt-input")
const customPromptCounter = document.getElementById("custom-prompt-counter")
const savePromptBtn = document.getElementById("save-prompt-btn")
const savedPromptsContainer = document.getElementById("saved-prompts-container")
const saveLocalPresetBtn = document.getElementById("save-local-preset-btn")
const savedLocalPresetsContainer = document.getElementById("saved-local-presets-container")

const toggleByokBtn = document.getElementById("toggle-byok")
const byokBody = document.getElementById("byok-body")
const byokStatus = document.getElementById("byok-status")
const byokProviders = ["openrouter", "google", "openai", "anthropic", "deepseek", "xai", "local"]
const byokToggles = {
    openrouter: document.getElementById("byok-openrouter-toggle"),
    google: document.getElementById("byok-google-toggle"),
    openai: document.getElementById("byok-openai-toggle"),
    anthropic: document.getElementById("byok-anthropic-toggle"),
    deepseek: document.getElementById("byok-deepseek-toggle"),
    xai: document.getElementById("byok-xai-toggle"),
    local: document.getElementById("byok-local-toggle")
}

const languages = {
    af: "Afrikaans",
    sq: "Albanian",
    am: "Amharic",
    ar: "Arabic",
    hy: "Armenian",
    as: "Assamese",
    ay: "Aymara",
    az: "Azerbaijani",
    azb: "Azerbaijani (Arabic)",
    bm: "Bambara",
    eu: "Basque",
    be: "Belarusian",
    bn: "Bengali",
    bho: "Bhojpuri",
    brx: "Bodo",
    bs: "Bosnian",
    bg: "Bulgarian",
    yue: "Cantonese",
    ca: "Catalan",
    ceb: "Cebuano",
    ny: "Chichewa",
    // Region codes rather than spelled-out qualifiers: these four were the only entries
    // long enough to set the width of the whole 133-row list. Nothing is lost - the
    // endonym beside each one (简体中文 / 繁體中文) already says "Simplified" and
    // "Traditional" outright to anyone who reads the script the distinction is about.
    "zh-cn": "Chinese (CN)",
    "zh-tw": "Chinese (TW)",
    co: "Corsican",
    hr: "Croatian",
    cs: "Czech",
    da: "Danish",
    dv: "Divehi",
    doi: "Dogri",
    nl: "Dutch",
    en: "English",
    eo: "Esperanto",
    et: "Estonian",
    ee: "Ewe",
    fil: "Filipino",
    fi: "Finnish",
    fr: "French",
    fy: "Frisian",
    ff: "Fula",
    gl: "Galician",
    lg: "Ganda",
    ka: "Georgian",
    de: "German",
    el: "Greek",
    gn: "Guarani",
    gu: "Gujarati",
    ht: "Haitian",
    ha: "Hausa",
    haw: "Hawaiian",
    he: "Hebrew",
    hil: "Hiligaynon",
    hi: "Hindi",
    hmn: "Hmong",
    hu: "Hungarian",
    is: "Icelandic",
    ig: "Igbo",
    ilo: "Iloko",
    id: "Indonesian",
    ga: "Irish",
    it: "Italian",
    ja: "Japanese",
    jv: "Javanese",
    kn: "Kannada",
    ks: "Kashmiri",
    kk: "Kazakh",
    km: "Khmer",
    ki: "Kikuyu",
    rw: "Kinyarwanda",
    rn: "Kirundi",
    gom: "Konkani",
    ko: "Korean",
    kri: "Krio",
    ku: "Kurmanji",
    ckb: "Sorani",
    ky: "Kyrgyz",
    lo: "Lao",
    la: "Latin",
    lv: "Latvian",
    ln: "Lingala",
    lt: "Lithuanian",
    lb: "Luxembourgish",
    mk: "Macedonian",
    mai: "Maithili",
    mg: "Malagasy",
    ms: "Malay",
    ml: "Malayalam",
    mt: "Maltese",
    mi: "Maori",
    mr: "Marathi",
    mni: "Meitei (Manipuri)",
    lus: "Mizo",
    mn: "Mongolian",
    mos: "Mooré",
    my: "Burmese",
    ne: "Nepali",
    nso: "Northern Sotho",
    no: "Norwegian",
    or: "Odia",
    om: "Oromo",
    ps: "Pashto",
    fa: "Persian",
    pl: "Polish",
    "pt-pt": "Portuguese (PT)",
    "pt-br": "Portuguese (BR)",
    pa: "Punjabi (Gurmukhi)",
    "pa-arab": "Punjabi (Shahmukhi)",
    qu: "Quechua",
    ro: "Romanian",
    ru: "Russian",
    sm: "Samoan",
    sa: "Sanskrit",
    sat: "Santali",
    gd: "Scottish",
    sr: "Serbian",
    st: "Sesotho",
    sn: "Shona",
    sd: "Sindhi",
    si: "Sinhala",
    sk: "Slovak",
    sl: "Slovenian",
    so: "Somali",
    es: "Spanish (ES)",
    "es-419": "Spanish (LATAM)",
    su: "Sundanese",
    sw: "Swahili",
    sv: "Swedish",
    tg: "Tajik",
    "ber-latn": "Tamazight (Latin)",
    ta: "Tamil",
    tt: "Tatar",
    te: "Telugu",
    th: "Thai",
    ti: "Tigrinya",
    ts: "Tsonga",
    tn: "Tswana",
    tr: "Turkish",
    tk: "Turkmen",
    ak: "Twi",
    uk: "Ukrainian",
    ur: "Urdu",
    ug: "Uyghur",
    uz: "Uzbek",
    vi: "Vietnamese",
    cy: "Welsh",
    wo: "Wolof",
    xh: "Xhosa",
    yi: "Yiddish",
    yo: "Yoruba",
    zu: "Zulu",
}

const languagesByName = Object.entries(languages).sort((a, b) => a[1].localeCompare(b[1], "en"))

// What each language calls itself, keyed by the same codes as `languages` above - keep the
// two in step when adding a language.
//
// Unlike a flag, this is a property of the language rather than a guess at which country
// stands in for it: one-to-one by construction, no duplicates, nothing to argue about. It
// also helps the person most likely to need help - someone hunting for their own language
// who may not read the English name confidently.
//
// Some of these are identical to the English name (Afrikaans, Filipino, Igbo, ...).
// They're still rendered rather than skipped: a blank in that column reads as missing
// data, and the ragged edge it leaves is worse to scan past than a harmless repetition.
const languageEndonyms = {
    af: "Afrikaans", sq: "Shqip", am: "አማርኛ", ar: "العربية", hy: "Հայերեն",
    as: "অসমীয়া", ay: "Aymar aru", az: "Azərbaycan dili", azb: "تۆرکجه", bm: "Bamanankan",
    eu: "Euskara", be: "Беларуская", bn: "বাংলা", bho: "भोजपुरी", brx: "बड़ो", bs: "Bosanski",
    bg: "Български", yue: "粵語", ca: "Català", ceb: "Cebuano", ny: "Chichewa",
    "zh-cn": "简体中文", "zh-tw": "繁體中文", co: "Corsu", hr: "Hrvatski",
    cs: "Čeština", da: "Dansk", dv: "ދިވެހި", doi: "डोगरी", nl: "Nederlands",
    en: "English", eo: "Esperanto", et: "Eesti", ee: "Eʋegbe", fil: "Filipino",
    fi: "Suomi", fr: "Français", fy: "Frysk", ff: "Fulfulde", gl: "Galego", lg: "Luganda",
    ka: "ქართული", de: "Deutsch", el: "Ελληνικά", gn: "Avañe'ẽ", gu: "ગુજરાતી",
    ht: "Kreyòl ayisyen", ha: "Hausa", haw: "ʻŌlelo Hawaiʻi", he: "עברית", hil: "Ilonggo",
    hi: "हिन्दी", hmn: "Hmoob", hu: "Magyar", is: "Íslenska", ig: "Igbo",
    ilo: "Ilokano", id: "Bahasa Indonesia", ga: "Gaeilge", it: "Italiano",
    ja: "日本語", jv: "Basa Jawa", kn: "ಕನ್ನಡ", ks: "کٲشُر", kk: "Қазақ тілі", km: "ខ្មែរ", ki: "Gĩkũyũ",
    rw: "Kinyarwanda", rn: "Ikirundi", gom: "कोंकणी", ko: "한국어", kri: "Krio", ku: "Kurmancî",
    ckb: "کوردیی ناوەندی", ky: "Кыргызча", lo: "ລາວ", la: "Latina", lv: "Latviešu",
    ln: "Lingála", lt: "Lietuvių", lb: "Lëtzebuergesch", mk: "Македонски",
    mai: "मैथिली", mg: "Malagasy", ms: "Bahasa Melayu", ml: "മലയാളം", mt: "Malti",
    mi: "Te Reo Māori", mr: "मराठी", mni: "ꯃꯩꯇꯩꯂꯣꯟ", lus: "Mizo ṭawng", mn: "Монгол", mos: "Mòoré", my: "မြန်မာ",
    ne: "नेपाली", nso: "Sepedi", no: "Norsk", or: "ଓଡ଼ିଆ", om: "Afaan Oromoo",
    ps: "پښتو", fa: "فارسی", pl: "Polski", "pt-pt": "Português (PT)",
    "pt-br": "Português (BR)", pa: "ਪੰਜਾਬੀ", "pa-arab": "پنجابی", qu: "Runa Simi", ro: "Română",
    ru: "Русский", sm: "Gagana Sāmoa", sa: "संस्कृतम्", sat: "ᱥᱟᱱᱛᱟᱲᱤ", gd: "Gàidhlig", sr: "Српски",
    st: "Sesotho", sn: "ChiShona", sd: "سنڌي", si: "සිංහල", sk: "Slovenčina",
    sl: "Slovenščina", so: "Soomaali", es: "Español (ES)", "es-419": "Español (LATAM)", su: "Basa Sunda",
    sw: "Kiswahili", sv: "Svenska", tg: "Тоҷикӣ", "ber-latn": "Tamaziɣt", ta: "தமிழ்", tt: "Татарча",
    te: "తెలుగు", th: "ไทย", ti: "ትግርኛ", ts: "Xitsonga", tn: "Setswana", tr: "Türkçe",
    tk: "Türkmençe", ak: "Twi", uk: "Українська", ur: "اردو", ug: "ئۇيغۇرچە",
    uz: "Oʻzbekcha", vi: "Tiếng Việt", cy: "Cymraeg", wo: "Wolof", xh: "isiXhosa", yi: "ייִדיש",
    yo: "Yorùbá", zu: "isiZulu",
}

// Null only when a language has no endonym recorded at all - every mapped one is shown,
// including the ones that match their English name.
function getLanguageEndonym(langCode) {
    return languageEndonyms[langCode] || null
}

function createLanguageEndonymSpan(endonym) {
    const span = document.createElement("span")
    span.className = "ml-auto shrink min-w-0 truncate text-right select-none text-sm text-neutral-500 dark:text-neutral-400"
    // Some are in RTL scripts (Arabic, Hebrew, Thaana). dir=auto lets the browser resolve
    // each one from its own first strong character instead of inheriting the page's LTR
    // and rendering the punctuation and any Latin fragments on the wrong side.
    span.dir = "auto"
    span.textContent = endonym
    return span
}

api.storage.sync.get({ yomi_target_lang: "en", yomi_email: "", yomi_error: false, yomi_auto_save: false }, (result) => {
    try {
        const targetLanguage = result["yomi_target_lang"]
        const userEmail = result["yomi_email"]
        const yomiError = result["yomi_error"]
        const autoSave = result["yomi_auto_save"]

        if (yomiError) {
            displayError(yomiError)

            api.storage.sync.set({ yomi_error: false })
        }

        document.getElementById("email-input").value = userEmail

        for (const [key, value] of languagesByName) {
            const languageOption = document.createElement("option")
            languageOption.classList.add("text-gray")

            languageOption.value = key
            languageOption.text = value

            if (key == targetLanguage) {
                languageOption.selected = true
            }

            languageSelect.appendChild(languageOption)
        }

        if (isMobile() || isSafari()) {
            api.storage.sync.set({ yomi_auto_save: false })
            autoSaveToggle.checked = false
            document.getElementById("auto-save-content").style.setProperty("display", "none", "important")
        } else if (autoSave) {
            api.permissions.contains({ permissions: ['downloads'] }, (hasPermission) => {
                if (hasPermission) {
                    autoSaveToggle.checked = true
                } else {
                    api.storage.sync.set({ yomi_auto_save: false })
                    autoSaveToggle.checked = false
                }
            })
        }
    } catch (e) {
        sendError(e, "api.storage.sync.get (init)")
    }
})

fontSelect.addEventListener("change", (event) => {
    try {
        api.storage.sync.set({ yomi_font: event.target.value })
    } catch (e) {
        sendError(e, "fontSelect listener")
    }
})

languageSelect.addEventListener("change", (event) => {
    try {
        api.storage.sync.set({ yomi_target_lang: event.target.value })
        switchToSupportedFontIfNeeded()
    } catch (e) {
        sendError(e, "languageSelect listener")
    }
})

// --- Custom Font Dropdown ---
const fontSelectBox = document.getElementById("font-select-box")
const fontDropdownTrigger = document.getElementById("font-dropdown-trigger")
const fontDropdownList = document.getElementById("font-dropdown-list")
const fontDropdownArrow = document.getElementById("font-dropdown-arrow")
const fontDropdownSelectedText = document.getElementById("font-dropdown-selected-text")

const fontOptions = []
for (let i = 0; i < fontSelect.options.length; i++) {
    const opt = fontSelect.options[i]
    fontOptions.push({ value: opt.value, text: opt.text, className: opt.className })
}

// Languages supported per font (noto/NotoSans is the universal fallback and is omitted, i.e. always supported)
const fontLanguageSupport = {
    wildwords: ["be", "bs", "bg", "mk", "ru", "sr", "el", "af", "sq", "eu", "ca", "hr", "cs", "da", "nl", "en", "eo", "et", "fil", "fi", "fr", "gl", "lg", "de", "hu", "is", "id", "ga", "it", "rw", "lv", "lt", "lb", "mg", "mt", "no", "om", "pl", "pt-pt", "pt-br", "pt", "qu", "ro", "gd", "sn", "sk", "sl", "so", "es", "sw", "sv", "tr", "uz", "vi", "cy", "fy", "yo", "zu", "rn", "wo", "hil", "ki", "tn", "es-419"],
    heroika: ["be", "bs", "bg", "mk", "ru", "sr", "uk", "af", "sq", "eu", "nl", "en", "et", "fil", "fi", "gl", "de", "id", "ga", "it", "rw", "lv", "lb", "mg", "mn", "om", "pt-pt", "pt-br", "pt", "qu", "gd", "sn", "sl", "so", "es", "sw", "sv", "uz", "zu", "rn", "hil", "tn", "es-419"],
    shonen: ["az", "be", "bs", "bg", "mk", "ru", "sr", "uk", "uz", "af", "sq", "eu", "hr", "cs", "da", "nl", "en", "eo", "et", "fil", "fi", "fr", "gl", "lg", "de", "hu", "is", "id", "ga", "it", "rw", "lv", "lt", "lb", "mg", "mn", "mt", "no", "om", "pl", "pt-pt", "pt-br", "pt", "qu", "gd", "sn", "sk", "sl", "so", "es", "sw", "sv", "tr", "zu", "rn", "wo", "hil", "ki", "tn", "es-419"],
    badcomic: ["be", "bs", "bg", "mk", "ru", "sr", "uk", "uz", "el", "af", "ak", "sq", "eu", "ca", "hr", "cs", "da", "nl", "en", "eo", "et", "ee", "fil", "fi", "fr", "gl", "lg", "de", "haw", "hu", "is", "ig", "id", "ga", "it", "rw", "lv", "ln", "lt", "lb", "mg", "mt", "mn", "om", "pl", "pt", "qu", "ro", "gd", "sn", "sk", "sl", "so", "es", "sw", "sv", "tr", "vi", "cy", "fy", "yo", "zu", "ff", "ber-latn", "rn", "wo", "hil", "ki", "tn", "es-419"],
    mashanzheng: ["en", "zh-cn", "id", "rw", "om", "sn", "so", "sw", "uz", "zu", "rn", "hil"],
    komika: ["af", "sq", "eu", "ca", "da", "nl", "en", "fil", "fr", "gl", "de", "is", "id", "ga", "it", "rw", "lb", "mg", "no", "om", "pt", "pt-pt", "pt-br", "qu", "gd", "sn", "so", "es", "sw", "sv", "uz", "zu", "rn", "hil", "tn", "es-419"],
    bangers: ["af", "sq", "eu", "ca", "hr", "cs", "da", "nl", "en", "eo", "et", "fil", "fi", "fr", "gl", "lg", "de", "hu", "is", "id", "ga", "it", "rw", "lv", "lt", "lb", "mg", "mt", "no", "om", "pl", "pt", "pt-pt", "pt-br", "qu", "ro", "gd", "sr", "sn", "sk", "sl", "so", "es", "sw", "sv", "tr", "uz", "vi", "cy", "fy", "zu", "rn", "wo", "hil", "ki", "tn", "es-419"],
    edo: ["en"],
    ridi: ["ru", "af", "sq", "eu", "ca", "hr", "cs", "da", "nl", "en", "eo", "et", "fil", "fi", "fr", "gl", "lg", "de", "hu", "is", "id", "ga", "ko", "it", "rw", "lv", "lt", "lb", "mg", "mt", "no", "om", "pl", "pt", "pt-pt", "pt-br", "qu", "ro", "sr", "sn", "sk", "sl", "so", "es", "sw", "sv", "tr", "uz", "cy", "zu", "rn", "wo", "hil", "ki", "tn", "es-419"],
    bushidoo: ["af", "sq", "eu", "hr", "cs", "da", "nl", "en", "et", "fil", "fi", "fr", "gl", "de", "hu", "is", "id", "ga", "it", "rw", "lb", "mg", "no", "om", "pt", "pt-pt", "pt-br", "qu", "sr", "sn", "sk", "sl", "so", "es", "sw", "sv", "uz", "zu", "rn", "hil", "tn", "es-419"],
    hayah: ["ar", "fa", "af", "sq", "eu", "ca", "da", "nl", "en", "et", "fil", "fi", "gl", "de", "is", "id", "ga", "it", "rw", "lb", "mg", "om", "pt", "pt-pt", "pt-br", "qu", "sn", "so", "es", "sw", "sv", "gd", "uz", "zu", "rn", "hil", "tn", "es-419"],
    itim: ["af", "sq", "eu", "ca", "da", "nl", "en", "eo", "et", "fo", "fil", "fi", "fr", "gl", "de", "haw", "hu", "is", "ig", "id", "ga", "it", "rw", "lv", "lt", "lb", "mg", "mt", "om", "pl", "pt", "pt-pt", "pt-br", "ro", "qu", "sn", "sk", "sl", "so", "es", "sw", "sv", "tr", "uz", "vi", "cy", "yo", "zu", "th", "rn", "wo", "hil", "ki", "tn", "es-419"],
    mogul: ["af", "sq", "eu", "be", "ca", "da", "nl", "en", "et", "fil", "fi", "fr", "gl", "de", "is", "id", "ga", "it", "rw", "lb", "mg", "mn", "om", "pt", "pt-pt", "pt-br", "qu", "ru", "sn", "so", "es", "sw", "sv", "uz", "gd", "zu", "rn", "hil", "tn", "es-419"],
    kalam: ["hi", "gom", "mr", "ne", "af", "sq", "eu", "ca", "hr", "cs", "da", "nl", "en", "et", "fil", "fi", "fr", "gl", "de", "hu", "is", "id", "ga", "it", "rw", "lv", "lt", "lb", "mg", "om", "pl", "pt", "qu", "ro", "gd", "sr", "sn", "sk", "sl", "so", "es", "sw", "sv", "tr", "uz", "zu", "rn", "hil", "tn", "brx", "es-419"],
    hindsiliguri: ["as", "bn", "af", "sq", "eu", "ca", "hr", "cs", "da", "nl", "en", "et", "fil", "fi", "fr", "gl", "de", "hu", "is", "id", "ga", "it", "rw", "lv", "lt", "lb", "mg", "om", "pl", "pt", "qu", "ro", "gd", "sr", "sn", "sk", "sl", "so", "es", "sw", "sv", "tr", "uz", "zu", "rn", "hil", "tn", "es-419"],
}

function isFontSupportedForLanguage(fontValue, langCode) {
    const supported = fontLanguageSupport[fontValue]
    return !supported || supported.includes(langCode)
}

function switchToSupportedFontIfNeeded() {
    const language = languageSelect.value
    if (isFontSupportedForLanguage(fontSelect.value, language)) return
    const firstSupported = fontOptions.find(o => isFontSupportedForLanguage(o.value, language))
    if (!firstSupported) return
    fontSelect.value = firstSupported.value
    fontSelect.dispatchEvent(new Event("change"))
}

function syncFontDropdownToSelect() {
    if (!fontDropdownSelectedText) return
    const selectedOpt = fontOptions.find(o => o.value === fontSelect.value)
    fontDropdownSelectedText.innerText = selectedOpt ? selectedOpt.text : fontSelect.value
}

function toggleFontDropdown(show) {
    if (!fontDropdownList || !fontDropdownTrigger) return
    const isHidden = fontDropdownList.classList.contains("hidden")
    const shouldShow = show !== undefined ? show : isHidden

    if (shouldShow) {
        updateFontDropdownList()
        positionFloatingDropdown(fontSelectBox || fontDropdownTrigger, fontDropdownList, 6)
        // After positioning, so the list's final max-height is what we scroll within.
        scrollDropdownToSelected(fontDropdownList, { center: true })
        if (fontDropdownArrow) fontDropdownArrow.classList.add("rotate-180")
    } else {
        fontDropdownList.classList.add("hidden")
        if (fontDropdownArrow) fontDropdownArrow.classList.remove("rotate-180")
    }
}

if (fontSelectBox) {
    fontSelectBox.addEventListener("click", () => {
        toggleFontDropdown()
    })
}

document.addEventListener("click", (e) => {
    if (fontDropdownList && !fontDropdownList.classList.contains("hidden")) {
        if (fontSelectBox && !fontSelectBox.contains(e.target) && !fontDropdownList.contains(e.target)) {
            toggleFontDropdown(false)
        }
    }
})

window.addEventListener("scroll", (e) => {
    if (fontDropdownList && fontDropdownList.contains(e.target)) {
        return
    }
    toggleFontDropdown(false)
}, true)

function updateFontDropdownList() {
    if (!fontDropdownList) return
    const currentValue = fontSelect.value
    fontDropdownList.innerHTML = ""

    const currentLanguage = languageSelect.value

    fontOptions.forEach(optInfo => {
        const isSupported = isFontSupportedForLanguage(optInfo.value, currentLanguage)

        const item = document.createElement("div")
        item.className = "flex items-center px-3 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 cursor-pointer text-neutral-800 dark:text-neutral-100 transition-colors min-w-0"
        if (optInfo.value === currentValue) {
            markDropdownItemSelected(item, { keepFontWeight: true })
        }
        if (!isSupported) {
            item.classList.add("opacity-40", "cursor-not-allowed")
            item.classList.remove("cursor-pointer", "hover:bg-neutral-200", "dark:hover:bg-neutral-700")
        }

        const textSpan = document.createElement("span")
        textSpan.className = "flex-grow select-none pr-4 text-base truncate"
        if (optInfo.className) textSpan.classList.add(optInfo.className)
        textSpan.innerText = optInfo.text
        item.appendChild(textSpan)

        if (!isSupported) {
            item.setAttribute("data-tooltip-desc", "Font not compatible with selected language")
            item.setAttribute("data-tooltip-direction", "right")
        }

        if (isSupported) {
            item.addEventListener("click", () => {
                fontSelect.value = optInfo.value
                syncFontDropdownToSelect()
                fontSelect.dispatchEvent(new Event("change"))
                toggleFontDropdown(false)
            })
        }

        fontDropdownList.appendChild(item)
    })
}

setupDropdownTypeahead(fontDropdownTrigger, fontDropdownList, fontSelect, {
    isSelectable: (opt) => isFontSupportedForLanguage(opt.value, languageSelect.value),
    onMatch: () => {
        syncFontDropdownToSelect()
        refreshOpenDropdown(fontDropdownList, updateFontDropdownList)
    }
})

setupDropdownArrowKeys(fontDropdownTrigger, fontDropdownList, toggleFontDropdown)

// --- Reasoning Effort Dropdown ---
//
// Same select + floating list the font/model/language pickers use, so it inherits their
// keyboard handling, positioning and theming rather than growing a second pattern.
const reasoningSelect = document.getElementById("reasoning-select")
const reasoningSelectBox = document.getElementById("reasoning-select-box")
const reasoningDropdownTrigger = document.getElementById("reasoning-dropdown-trigger")
const reasoningDropdownList = document.getElementById("reasoning-dropdown-list")
const reasoningDropdownArrow = document.getElementById("reasoning-dropdown-arrow")
const reasoningDropdownSelectedText = document.getElementById("reasoning-dropdown-selected-text")

const reasoningOptions = []
if (reasoningSelect) {
    for (let i = 0; i < reasoningSelect.options.length; i++) {
        const opt = reasoningSelect.options[i]
        reasoningOptions.push({ value: opt.value, text: opt.text })
    }
}

function syncReasoningDropdownToSelect() {
    if (!reasoningDropdownSelectedText || !reasoningSelect) return
    const selectedOpt = reasoningOptions.find(o => o.value === reasoningSelect.value)
    reasoningDropdownSelectedText.innerText = selectedOpt ? selectedOpt.text : reasoningSelect.value
}

// Reasoning costs money and time, and the two settings that cost the most say so. Amber for
// medium, red for high; none and low read as ordinary options because they are.
function getReasoningColorClass(value) {
    if (value === "high") return "text-red-500 dark:text-red-400"
    if (value === "medium") return "text-amber-500 dark:text-amber-400"
    return ""
}

function updateReasoningDropdownList() {
    if (!reasoningDropdownList || !reasoningSelect) return
    const currentValue = reasoningSelect.value
    reasoningDropdownList.innerHTML = ""

    reasoningOptions.forEach(optInfo => {
        const item = document.createElement("div")
        const colorClass = getReasoningColorClass(optInfo.value)
        const textClasses = colorClass || "text-neutral-800 dark:text-neutral-100 hover:text-neutral-900 dark:hover:text-white"
        item.className = `flex items-center px-3 py-1 hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50 cursor-pointer ${textClasses} transition-colors min-w-0`
        if (optInfo.value === currentValue) markDropdownItemSelected(item, { preserveTextColor: !!colorClass })

        const textSpan = document.createElement("span")
        textSpan.className = "flex-grow select-none pr-4 text-base truncate"
        textSpan.innerText = optInfo.text
        item.appendChild(textSpan)

        item.addEventListener("click", () => {
            reasoningSelect.value = optInfo.value
            syncReasoningDropdownToSelect()
            reasoningSelect.dispatchEvent(new Event("change"))
            toggleReasoningDropdown(false)
        })

        reasoningDropdownList.appendChild(item)
    })
}

function toggleReasoningDropdown(show) {
    if (!reasoningDropdownList || !reasoningDropdownTrigger) return
    const isHidden = reasoningDropdownList.classList.contains("hidden")
    const shouldShow = show !== undefined ? show : isHidden

    if (shouldShow) {
        updateReasoningDropdownList()
        positionFloatingDropdown(reasoningSelectBox || reasoningDropdownTrigger, reasoningDropdownList, 6)
        scrollDropdownToSelected(reasoningDropdownList, { center: true })
        if (reasoningDropdownArrow) reasoningDropdownArrow.classList.add("rotate-180")
    } else {
        reasoningDropdownList.classList.add("hidden")
        if (reasoningDropdownArrow) reasoningDropdownArrow.classList.remove("rotate-180")
    }
}

if (reasoningSelectBox) {
    reasoningSelectBox.addEventListener("click", () => {
        toggleReasoningDropdown()
    })
}

document.addEventListener("click", (e) => {
    if (reasoningDropdownList && !reasoningDropdownList.classList.contains("hidden")) {
        if (reasoningSelectBox && !reasoningSelectBox.contains(e.target) && !reasoningDropdownList.contains(e.target)) {
            toggleReasoningDropdown(false)
        }
    }
})

window.addEventListener("scroll", (e) => {
    if (reasoningDropdownList && reasoningDropdownList.contains(e.target)) {
        return
    }
    toggleReasoningDropdown(false)
}, true)

if (reasoningSelect) {
    setupDropdownTypeahead(reasoningDropdownTrigger, reasoningDropdownList, reasoningSelect, {
        onMatch: () => {
            syncReasoningDropdownToSelect()
            refreshOpenDropdown(reasoningDropdownList, updateReasoningDropdownList)
        }
    })

    setupDropdownArrowKeys(reasoningDropdownTrigger, reasoningDropdownList, toggleReasoningDropdown)

    reasoningSelect.addEventListener("change", (event) => {
        try {
            api.storage.sync.set({ yomi_reasoning_effort: event.target.value })
            syncReasoningDropdownToSelect()
            warnIfExpensiveReasoning()
        } catch (e) {
            sendError(e, "reasoningSelect listener")
        }
    })
}

// Drag-to-scrub number boxes, shared by both Advanced Options sliders. Lifted verbatim from
// the edit-mode copy in content.js - same control, same behaviour, and it depends on nothing
// but the element it is given.
function attachScrubInput(config) {
    const {
        el, span, getValue, setValue, onDragStart,
        decimals = 0, min = -Infinity, max = Infinity, step = 1,
    } = config
    if (!el) return

    const PX_PER_STEP = 4 // mouse-movement distance for one `step` of scrub change

    function clamp(v) {
        // min/max may be functions when the bound depends on live state rather than being
        // fixed (border padding's floor is derived from the selected text's own size).
        // Resolved here inside clamp() rather than by the caller so the scrub's internal
        // startValue+delta accumulation is bounded too - clamping inside setValue instead
        // would let the accumulator run past the limit and leave dead travel on the way back.
        const lo = typeof min === "function" ? min() : min
        const hi = typeof max === "function" ? max() : max
        return Math.min(hi, Math.max(lo, v))
    }

    function roundToDecimals(v) {
        const f = Math.pow(10, decimals)
        return Math.round(v * f) / f
    }

    function speedMultiplier(e) {
        if (e.shiftKey) return 10  // coarse: big jumps across a wide range
        if (e.altKey) return 0.1   // fine: precise, slow-moving adjustment
        return 1
    }

    let mode = "idle" // idle | pending | scrubbing | scrolling | editing
    let scroller = null
    let startScrollTop = 0
    let lastY = 0
    let lastTime = 0
    let velocity = 0
    let lockedOverflowY = null

    function refreshDisplay() {
        if (mode === "editing") return // don't clobber the user's in-progress typing
        if (span) el.value = span.textContent
    }
    refreshDisplay()

    if (span) {
        new MutationObserver(refreshDisplay).observe(span, { characterData: true, childList: true, subtree: true })
    }

    el.readOnly = true
    el.setAttribute("autocomplete", "off")
    el.setAttribute("spellcheck", "false")
    el.setAttribute("inputmode", decimals > 0 ? "decimal" : "numeric")

    let startX = 0, startY = 0, startValue = 0
    let editStartValue = 0
    let snapshotted = false

    function maybeSnapshot() {
        if (snapshotted) return
        snapshotted = true
        if (onDragStart) onDragStart()
    }

    function beginEdit() {
        mode = "editing"
        editStartValue = getValue()
        snapshotted = false
        el.readOnly = false
        el.value = editStartValue.toFixed(decimals)
        el.focus()
        el.select()
    }

    function endEdit(applyValue) {
        mode = "idle"
        el.readOnly = true
        if (applyValue) {
            const parsed = parseFloat(el.value)
            if (!isNaN(parsed)) {
                const next = roundToDecimals(clamp(parsed))
                if (next !== editStartValue) {
                    maybeSnapshot()
                    setValue(next, { commit: false })
                    setValue(next, { commit: true })
                }
            }
        }
        refreshDisplay()
    }

    el.addEventListener("focus", () => {
        if (mode !== "editing") beginEdit()
    })

    el.addEventListener("keydown", (e) => {
        if (mode !== "editing") return
        if (e.key === "Enter") {
            e.preventDefault()
            e.stopPropagation()
            endEdit(true)
            el.blur()
        } else if (e.key === "Escape") {
            e.preventDefault()
            e.stopPropagation()
            endEdit(false)
            el.blur()
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault()
            e.stopPropagation()
            const delta = (e.key === "ArrowUp" ? 1 : -1) * step * speedMultiplier(e)
            const current = parseFloat(el.value)
            const next = roundToDecimals(clamp((isNaN(current) ? getValue() : current) + delta))
            maybeSnapshot()
            setValue(next, { commit: false })
            el.value = next.toFixed(decimals)
        }
    })

    el.addEventListener("blur", () => {
        if (mode === "editing") endEdit(true)
    })

    el.addEventListener("pointerdown", (e) => {
        if (mode === "editing") return // let native caret placement/selection happen
        if (e.button !== 0) return
        mode = "pending"
        snapshotted = false
        startX = e.clientX
        startY = e.clientY
        startValue = getValue()
        scroller = findScrollParent(el)
        startScrollTop = scroller ? scroller.scrollTop : 0
        lastY = e.clientY
        lastTime = Date.now()
        velocity = 0
        stopGlide()
        el.setPointerCapture(e.pointerId)
        e.preventDefault()
    })

    el.addEventListener("pointermove", (e) => {
        if (mode !== "pending" && mode !== "scrubbing" && mode !== "scrolling") return
        const dx = e.clientX - startX
        const dy = e.clientY - startY
        if (mode === "pending") {
            if (Math.abs(dx) < SLIDER_GESTURE_THRESHOLD && Math.abs(dy) < SLIDER_GESTURE_THRESHOLD) return
            // Same rule the sliders commit on. pointerdown already took the pointer and cancelled
            // native scrolling, so the vertical half has to be driven here.
            mode = Math.abs(dx) > Math.abs(dy) ? "scrubbing" : "scrolling"
        }
        if (mode === "scrolling") {
            if (scroller) {
                const now = Date.now()
                const elapsed = now - lastTime
                if (elapsed > 0) velocity = (e.clientY - lastY) / elapsed
                lastY = e.clientY
                lastTime = now
                scroller.scrollTop = startScrollTop - dy
            }
            return
        }
        // Same lock as registerSliderTouchGesture - see the note there.
        if (scroller && lockedOverflowY === null) {
            lockedOverflowY = scroller.style.overflowY
            scroller.style.overflowY = "hidden"
        }
        const next = roundToDecimals(clamp(startValue + (dx / PX_PER_STEP) * step * speedMultiplier(e)))
        maybeSnapshot()
        setValue(next, { commit: false })
        refreshDisplay()
    })

    function endPointer() {
        if (scroller && lockedOverflowY !== null) {
            scroller.style.overflowY = lockedOverflowY
            lockedOverflowY = null
        }
        if (mode === "scrubbing") {
            setValue(roundToDecimals(clamp(getValue())), { commit: true })
            mode = "idle"
            refreshDisplay()
        } else if (mode === "pending") {
            mode = "idle"
            beginEdit()
        } else if (mode === "scrolling") {
            mode = "idle"
            if (Date.now() - lastTime < 100) glideScroll(scroller, velocity)
        }
    }

    el.addEventListener("pointerup", endPointer)
    el.addEventListener("pointercancel", () => {
        mode = "idle"
        refreshDisplay()
    })

    return { refresh: refreshDisplay }
}

// ===== Minimum font size =====
//
// The slider's raw 0-1000 position maps geometrically onto the size. Equal steps along the
// track are equal RATIO changes in px, which puts most of the travel below ~25px - where
// nearly every page actually sits - instead of spending half the track on 50-100px values
// almost nobody picks.
//
// #min-font-size stays a hidden input holding the real px value, so the request header and
// yomi_min_font_size storage read exactly what they always did.
const MIN_FONT_SIZE_MIN = 6
const MIN_FONT_SIZE_MAX = 100
const minFontSizeSlider = document.getElementById("min-font-size-slider")
const minFontSizeValue = document.getElementById("min-font-size-value")

function minFontSizeSliderPosToSize(pos) {
    const t = pos / 1000
    return MIN_FONT_SIZE_MIN * Math.pow(MIN_FONT_SIZE_MAX / MIN_FONT_SIZE_MIN, t)
}

function minFontSizeToSliderPos(size) {
    const clamped = Math.min(MIN_FONT_SIZE_MAX, Math.max(MIN_FONT_SIZE_MIN, size))
    const t = Math.log(clamped / MIN_FONT_SIZE_MIN) / Math.log(MIN_FONT_SIZE_MAX / MIN_FONT_SIZE_MIN)
    return t * 1000
}

// Whole pixels, and clamped rather than left open-ended: api.py answers an out-of-range
// min_font_size by falling back to 6 rather than clamping, so a value that escaped here would
// silently undo the setting instead of landing near it. A corrupt stored value lands on the
// floor rather than NaN.
function clampMinFontSize(size) {
    if (!Number.isFinite(size)) return MIN_FONT_SIZE_MIN
    return Math.min(MIN_FONT_SIZE_MAX, Math.max(MIN_FONT_SIZE_MIN, Math.round(size)))
}

function updateMinFontSizeSliderFill() {
    if (!minFontSizeSlider) return
    const percent = (parseFloat(minFontSizeSlider.value) / 1000) * 100
    minFontSizeSlider.style.backgroundImage = `linear-gradient(to right, #06b6d4 ${percent}%, transparent ${percent}%)`
}

// Records the size without moving the thumb - for the drag itself, where writing a rounded
// position back would tug it out from under the cursor.
function readMinFontSizeFromSlider() {
    if (!minFontSizeSlider) return
    minFontSizeInput.value = clampMinFontSize(minFontSizeSliderPosToSize(parseFloat(minFontSizeSlider.value)))
    if (minFontSizeValue) minFontSizeValue.textContent = minFontSizeInput.value + "px"
    updateMinFontSizeSliderFill()
}

// The other direction: a size from storage or the scrub box, which does move the thumb.
function applyMinFontSize(size) {
    minFontSizeInput.value = clampMinFontSize(size)
    if (minFontSizeSlider) {
        minFontSizeSlider.value = minFontSizeToSliderPos(parseFloat(minFontSizeInput.value))
        updateMinFontSizeSliderFill()
    }
    if (minFontSizeValue) minFontSizeValue.textContent = minFontSizeInput.value + "px"
}

function saveMinFontSize() {
    try {
        api.storage.sync.set({ yomi_min_font_size: parseInt(minFontSizeInput.value) })
    } catch (e) {
        sendError(e, "saveMinFontSize")
    }
}

if (minFontSizeSlider) {
    minFontSizeSlider.addEventListener("input", readMinFontSizeFromSlider)
    // On release, so a drag writes storage once rather than on every pixel.
    minFontSizeSlider.addEventListener("change", () => {
        readMinFontSizeFromSlider()
        saveMinFontSize()
    })
}

attachScrubInput({
    el: document.getElementById("min-font-size-scrub"),
    span: minFontSizeValue,
    getValue: () => parseFloat(minFontSizeInput.value),
    setValue: (v, { commit }) => {
        applyMinFontSize(v)
        if (commit) saveMinFontSize()
    },
    min: MIN_FONT_SIZE_MIN, max: MIN_FONT_SIZE_MAX,
})

// ===== Inpaint multiplier =====
//
// How far the inpainting spreads around each detected text block, as a multiple of whatever
// the server would do on its own. 1.0 is that default, and it sits exactly halfway along the
// track rather than a tenth of the way in, because the slider is logarithmic in each
// direction. Halving and doubling are then the same distance from centre, which is the only
// reading of "multiplier" that behaves.
const INPAINT_MULTIPLIER_MIN = 0.1
const INPAINT_MULTIPLIER_DEFAULT = 1
const INPAINT_MULTIPLIER_MAX = 10
const INPAINT_MULTIPLIER_SNAP_THRESHOLD = 0.2
// One decimal throughout: this scales a blur radius, so finer than 0.1 is noise, and rounding
// here is what lets 1.0 be reachable exactly by dragging.
const INPAINT_MULTIPLIER_DECIMALS = 1

const inpaintMultiplierSlider = document.getElementById("inpaint-multiplier-slider")
const inpaintMultiplierValue = document.getElementById("inpaint-multiplier-value")
let inpaintMultiplier = INPAINT_MULTIPLIER_DEFAULT

function inpaintMultiplierSliderPosToValue(pos) {
    if (pos <= 500) {
        const u = pos / 500
        return INPAINT_MULTIPLIER_MIN * Math.pow(INPAINT_MULTIPLIER_DEFAULT / INPAINT_MULTIPLIER_MIN, u)
    }
    const u = (pos - 500) / 500
    return INPAINT_MULTIPLIER_DEFAULT * Math.pow(INPAINT_MULTIPLIER_MAX / INPAINT_MULTIPLIER_DEFAULT, u)
}

function inpaintMultiplierValueToSliderPos(value) {
    if (value <= INPAINT_MULTIPLIER_DEFAULT) {
        const u = Math.log(value / INPAINT_MULTIPLIER_MIN) / Math.log(INPAINT_MULTIPLIER_DEFAULT / INPAINT_MULTIPLIER_MIN)
        return u * 500
    }
    const u = Math.log(value / INPAINT_MULTIPLIER_DEFAULT) / Math.log(INPAINT_MULTIPLIER_MAX / INPAINT_MULTIPLIER_DEFAULT)
    return 500 + u * 500
}

// Hard bounds, unlike the open-ended px sliders: there is no override for a typed value past
// either end, because there is no sensible inpaint at 10x.
function clampInpaintMultiplier(value, { snap = false } = {}) {
    if (!Number.isFinite(value)) return INPAINT_MULTIPLIER_DEFAULT
    if (snap && Math.abs(value - INPAINT_MULTIPLIER_DEFAULT) <= INPAINT_MULTIPLIER_SNAP_THRESHOLD) {
        return INPAINT_MULTIPLIER_DEFAULT
    }
    const clamped = Math.min(INPAINT_MULTIPLIER_MAX, Math.max(INPAINT_MULTIPLIER_MIN, value))
    const factor = Math.pow(10, INPAINT_MULTIPLIER_DECIMALS)
    return Math.round(clamped * factor) / factor
}

function updateInpaintMultiplierSliderFill() {
    if (!inpaintMultiplierSlider) return
    const percent = (parseFloat(inpaintMultiplierSlider.value) / 1000) * 100
    inpaintMultiplierSlider.style.backgroundImage = `linear-gradient(to right, #06b6d4 ${percent}%, transparent ${percent}%)`
}

function readInpaintMultiplierFromSlider() {
    if (!inpaintMultiplierSlider) return
    inpaintMultiplier = clampInpaintMultiplier(
        inpaintMultiplierSliderPosToValue(parseFloat(inpaintMultiplierSlider.value)),
        { snap: true }
    )
    if (inpaintMultiplierValue) {
        inpaintMultiplierValue.textContent = inpaintMultiplier.toFixed(INPAINT_MULTIPLIER_DECIMALS)
    }
    updateInpaintMultiplierSliderFill()
}

function applyInpaintMultiplier(value, { snap = false } = {}) {
    inpaintMultiplier = clampInpaintMultiplier(value, { snap })
    if (inpaintMultiplierSlider) {
        inpaintMultiplierSlider.value = inpaintMultiplierValueToSliderPos(inpaintMultiplier)
        updateInpaintMultiplierSliderFill()
    }
    if (inpaintMultiplierValue) {
        inpaintMultiplierValue.textContent = inpaintMultiplier.toFixed(INPAINT_MULTIPLIER_DECIMALS)
    }
}

// Named to match setMinFontSize/setMinImageSize, which is what the storage restore calls.
function setInpaintMultiplier(value) {
    applyInpaintMultiplier(parseFloat(value))
}

function saveInpaintMultiplier() {
    try {
        api.storage.sync.set({ yomi_inpaint_multiplier: inpaintMultiplier })
    } catch (e) {
        sendError(e, "saveInpaintMultiplier")
    }
}

if (inpaintMultiplierSlider) {
    inpaintMultiplierSlider.addEventListener("input", readInpaintMultiplierFromSlider)
    inpaintMultiplierSlider.addEventListener("change", () => {
        readInpaintMultiplierFromSlider()
        saveInpaintMultiplier()
    })
}

// Lightroom-style double-click-to-reset, wired only for sliders that mark a meaningful default
// with a centre tick in the markup. That is the inpaint multiplier and not minimum font size,
// whose default is the floor - there is nothing to return to that dragging to the left end does
// not already do.
function addSliderDoubleClickReset(sliderEl, resetFn) {
    if (!sliderEl) return
    sliderEl.addEventListener("dblclick", () => resetFn())
}

// No undo state to take - a translation setting, not an image edit.
addSliderDoubleClickReset(inpaintMultiplierSlider, () => {
    applyInpaintMultiplier(INPAINT_MULTIPLIER_DEFAULT)
    saveInpaintMultiplier()
})

attachScrubInput({
    el: document.getElementById("inpaint-multiplier-scrub"),
    span: inpaintMultiplierValue,
    getValue: () => inpaintMultiplier,
    setValue: (v, { commit }) => {
        applyInpaintMultiplier(v)
        if (commit) saveInpaintMultiplier()
    },
    decimals: INPAINT_MULTIPLIER_DECIMALS,
    step: 0.1,
    min: INPAINT_MULTIPLIER_MIN, max: INPAINT_MULTIPLIER_MAX,
})


// --- Custom Language Dropdown ---
// Unlike font/model, the language <select> is populated asynchronously (after the
// api.storage.sync.get callback near the top of this file resolves), so a snapshot taken
// at declaration time here would still be empty - read languageSelect.options live instead,
// same as the model dropdown.
const languageSelectBox = document.getElementById("language-select-box")
const languageDropdownTrigger = document.getElementById("language-dropdown-trigger")
const languageDropdownList = document.getElementById("language-dropdown-list")
const languageDropdownArrow = document.getElementById("language-dropdown-arrow")
const languageDropdownSelectedText = document.getElementById("language-dropdown-selected-text")

function syncLanguageDropdownToSelect() {
    if (!languageDropdownSelectedText) return
    const selectedOpt = languageSelect.options[languageSelect.selectedIndex]
    languageDropdownSelectedText.innerText = selectedOpt ? selectedOpt.text : languageSelect.value
}

function toggleLanguageDropdown(show) {
    if (!languageDropdownList || !languageDropdownTrigger) return
    const isHidden = languageDropdownList.classList.contains("hidden")
    const shouldShow = show !== undefined ? show : isHidden

    if (shouldShow) {
        updateLanguageDropdownList()
        positionFloatingDropdown(languageSelectBox || languageDropdownTrigger, languageDropdownList, 6)
        // After positioning, so the list's final max-height is what we scroll within.
        scrollDropdownToSelected(languageDropdownList, { center: true })
        if (languageDropdownArrow) languageDropdownArrow.classList.add("rotate-180")
    } else {
        languageDropdownList.classList.add("hidden")
        if (languageDropdownArrow) languageDropdownArrow.classList.remove("rotate-180")
    }
}

if (languageSelectBox) {
    languageSelectBox.addEventListener("click", () => {
        toggleLanguageDropdown()
    })
}

document.addEventListener("click", (e) => {
    if (languageDropdownList && !languageDropdownList.classList.contains("hidden")) {
        if (languageSelectBox && !languageSelectBox.contains(e.target) && !languageDropdownList.contains(e.target)) {
            toggleLanguageDropdown(false)
        }
    }
})

window.addEventListener("scroll", (e) => {
    if (languageDropdownList && languageDropdownList.contains(e.target)) {
        return
    }
    toggleLanguageDropdown(false)
}, true)

function updateLanguageDropdownList() {
    if (!languageDropdownList) return
    const currentValue = languageSelect.value
    languageDropdownList.innerHTML = ""

    Array.from(languageSelect.options).forEach(opt => {
        const item = document.createElement("div")
        item.className = "flex items-center gap-2 px-3 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 cursor-pointer text-neutral-800 dark:text-neutral-100 transition-colors min-w-0"
        if (opt.value === currentValue) {
            markDropdownItemSelected(item)
        }

        const endonym = getLanguageEndonym(opt.value)

        const textSpan = document.createElement("span")
        // shrink-0 when there is an endonym: the row is width-capped (see
        // #language-dropdown-list in popup.css), so something has to give on the longest
        // rows, and it should be the endonym rather than the name people are reading down
        // the list. The endonym own ml-auto is what pushes it right - English left,
        // endonym right.
        textSpan.className = endonym
            ? "shrink-0 select-none text-base"
            : "flex-grow select-none pr-4 text-base truncate"
        textSpan.innerText = opt.text
        item.appendChild(textSpan)

        if (endonym) item.appendChild(createLanguageEndonymSpan(endonym))

        item.addEventListener("click", () => {
            languageSelect.value = opt.value
            syncLanguageDropdownToSelect()
            languageSelect.dispatchEvent(new Event("change"))
            toggleLanguageDropdown(false)
        })

        languageDropdownList.appendChild(item)
    })
}

setupDropdownTypeahead(languageDropdownTrigger, languageDropdownList, languageSelect, {
    onMatch: () => {
        syncLanguageDropdownToSelect()
        refreshOpenDropdown(languageDropdownList, updateLanguageDropdownList)
    }
})

setupDropdownArrowKeys(languageDropdownTrigger, languageDropdownList, toggleLanguageDropdown)

// Intercept .value assignments on the three hidden <select>s (setFont/
// setTargetLanguage in initialize() set these directly, bypassing the dropdown's own click
// handler) so the visible custom dropdown label stays in sync no matter how the value changed.
function interceptSelectValue(selectEl, syncFn) {
    const originalValueProp = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')
    Object.defineProperty(selectEl, 'value', {
        get() {
            return originalValueProp.get.call(this)
        },
        set(val) {
            originalValueProp.set.call(this, val)
            syncFn()
        }
    })
}
interceptSelectValue(modelSelect, syncModelDropdownToSelect)
interceptSelectValue(fontSelect, syncFontDropdownToSelect)
interceptSelectValue(languageSelect, syncLanguageDropdownToSelect)

const TRIAL_CREDITS = 30
const DEFAULT_MODEL = "gemini-3.1-flash-lite"
const DEFAULT_REASONING = "none"
const REASONING_WARNING_LEVELS = { medium: "amber", high: "red" }

// Set by showExtension(); null until the user data arrives.
let account = null

// Free accounts can also hold any amount of shared credits, so the balance decides, not the plan alone.
function isOnTrialCredits() {
    return !!account && (account.plan || "free").toLowerCase() === "free" && account.balance <= TRIAL_CREDITS
}

function isByokModelSelected() {
    return modelSelect.options[modelSelect.selectedIndex]?.dataset.byok === "true"
}

function modelWarningLevel(tier) {
    if (tier >= 5) return "red"
    if (tier === 4) return "amber"
    return null
}

function warnIfExpensiveModel() {
    const model = defaultModels.find(m => m.value === modelSelect.value)
    const level = modelWarningLevel(getModelCostTier(model))
    if (!level || isByokModelSelected()) return

    const cost = level === "red" ? "very expensive" : "expensive"
    openCostWarning({
        dismissKey: "yomi_dismiss_expensive_model_warning",
        level,
        title: level === "red" ? "Very expensive model" : "Expensive model",
        label: model.text,
        badge: createCostDots(model.cost),
        message: isOnTrialCredits()
            ? `The selected model is ${cost} and might use all of your credits in a single translation. Try a cheaper model.`
            : `The selected model is ${cost} and can cost 10 to 30 credits per translation. Try a cheaper model to make your credits last longer.`,
        saferLabel: `Use ${defaultModels.find(m => m.value === DEFAULT_MODEL).text}`,
        useSafer: () => {
            modelSelect.value = DEFAULT_MODEL
            modelSelect.dispatchEvent(new Event("change"))
        },
    })
}

function warnIfExpensiveReasoning() {
    const level = REASONING_WARNING_LEVELS[reasoningSelect.value]
    if (!level || isByokModelSelected()) return

    const label = `${reasoningOptions.find(o => o.value === reasoningSelect.value).text} reasoning`
    const amount = level === "red" ? "a lot more" : "more"
    openCostWarning({
        dismissKey: "yomi_dismiss_reasoning_warning",
        level,
        title: level === "red" ? "Very expensive setting" : "Expensive setting",
        label,
        message: `${label} uses ${amount} credits per translation${isOnTrialCredits() ? ", so your credits will run out faster" : ""}.`,
        saferLabel: "Turn reasoning off",
        useSafer: () => {
            reasoningSelect.value = DEFAULT_REASONING
            reasoningSelect.dispatchEvent(new Event("change"))
        },
    })
}

const COST_WARNING_ACCENTS = {
    amber: { icon: "text-amber-500 dark:text-amber-400", row: "border-amber-500/30 bg-amber-500/10", label: "text-amber-700 dark:text-amber-300" },
    red: { icon: "text-red-500 dark:text-red-400", row: "border-red-500/30 bg-red-500/10", label: "text-red-700 dark:text-red-300" },
}

function openCostWarning(warning) {
    api.storage.sync.get({ [warning.dismissKey]: false }, (result) => {
        try {
            if (!result[warning.dismissKey]) showCostWarning(warning)
        } catch (e) {
            sendError(e, "openCostWarning")
        }
    })
}

let closeOpenCostWarning = null

function showCostWarning({ dismissKey, level, title, label, badge, message, saferLabel, useSafer }) {
    closeOpenCostWarning?.()
    const accent = COST_WARNING_ACCENTS[level]

    const overlay = document.createElement("div")
    overlay.id = "cost-warning"
    overlay.className = "fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
    overlay.innerHTML = `
        <div role="alertdialog" aria-modal="true" aria-labelledby="cost-warning-title" aria-describedby="cost-warning-text"
            class="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-600 rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
            <div class="flex items-center gap-2 px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/40">
                <svg class="w-5 h-5 shrink-0 ${accent.icon}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z" />
                </svg>
                <h3 id="cost-warning-title" class="text-base font-semibold text-neutral-800 dark:text-neutral-100"></h3>
            </div>
            <div class="p-5 flex flex-col gap-4">
                <div data-row class="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border ${accent.row}">
                    <span data-label class="min-w-0 truncate text-sm font-semibold ${accent.label}"></span>
                </div>
                <div class="flex flex-col gap-3">
                    <p id="cost-warning-text" class="text-sm text-neutral-600 dark:text-neutral-300"></p>
                    <label class="flex items-center gap-2 w-max text-xs text-neutral-500 dark:text-neutral-400 cursor-pointer select-none">
                        <input data-dismiss type="checkbox" class="accent-cyan-400 w-3.5 h-3.5 cursor-pointer">
                        Don't show this again
                    </label>
                </div>
                <div class="flex gap-2">
                    <button data-keep type="button"
                        class="shrink-0 py-2 px-4 text-sm font-medium rounded-lg shadow-sm hover:shadow bg-neutral-200/60 hover:bg-neutral-200 dark:bg-neutral-700/60 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-100 duration-100 ease-in-out cursor-pointer border border-neutral-200 dark:border-neutral-600/60 focus:outline-none">Keep it</button>
                    <button data-safer type="button"
                        class="flex-1 min-w-0 truncate py-2 px-4 text-sm font-semibold rounded-lg bg-blue-500 hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-500 text-white duration-100 ease-in-out cursor-pointer border border-blue-400/30 focus:outline-none"></button>
                </div>
            </div>
        </div>`

    overlay.querySelector("h3").textContent = title
    overlay.querySelector("[data-label]").textContent = label
    if (badge) overlay.querySelector("[data-row]").appendChild(badge)
    overlay.querySelector("#cost-warning-text").textContent = message
    const saferButton = overlay.querySelector("[data-safer]")
    saferButton.textContent = saferLabel

    const close = () => {
        overlay.remove()
        document.removeEventListener("keydown", onKeydown, true)
        if (closeOpenCostWarning === close) closeOpenCostWarning = null
    }
    const chooseSafer = () => {
        close()
        useSafer()
    }
    const onKeydown = (e) => {
        if (e.key !== "Escape") return
        e.preventDefault()
        e.stopPropagation()
        chooseSafer()
    }

    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) chooseSafer()
    })
    // Like the colorize and inpaint warnings, "Don't show this again" only sticks when the user goes ahead.
    overlay.querySelector("[data-keep]").addEventListener("click", () => {
        if (overlay.querySelector("[data-dismiss]").checked) api.storage.sync.set({ [dismissKey]: true })
        close()
    })
    saferButton.addEventListener("click", chooseSafer)
    document.addEventListener("keydown", onKeydown, true)
    closeOpenCostWarning = close

    document.body.appendChild(overlay)
    saferButton.focus()
}

modelSelect.addEventListener("change", (event) => {
    try {
        api.storage.sync.set({ translation_model: event.target.value })
        warnIfExpensiveModel()
    } catch (e) {
        sendError(e, "modelSelect listener")
    }
})


Object.entries(textAlignmentButtons).forEach(([alignment, btn]) => {
    if (!btn) return
    btn.addEventListener("click", () => {
        try {
            setTextAlignment(alignment)
            api.storage.sync.set({ yomi_text_alignment: alignment })
        } catch (e) {
            sendError(e, "textAlignmentButtons listener")
        }
    })
})

api.runtime.sendMessage({ type: "user", sender: "popup" }, (response) => {
    try {
        if (response && response.success) {
            showExtension(response)
            initialize()
        } else {
            showExtension({ success: true, content: { email: "free@yomi.local", credits: 999999, is_active: true } })
            initialize()
        }

        loader.classList.replace("flex", "hidden")
    } catch (e) {
        showExtension({ success: true, content: { email: "free@yomi.local", credits: 999999, is_active: true } })
        initialize()
        loader.classList.replace("flex", "hidden")
    }
})

// The provider sign-in opens in a separate tab, which on mobile replaces the popup entirely -
// without a word here the user is left staring at a spinner with nothing to act on.
function setLoginHint(visible) {
    document.getElementById("login-hint").classList.toggle("hidden", !visible)
}

document.getElementById("login-with-google-btn").addEventListener("click", async function () {
    try {
        loader.classList.replace("hidden", "flex")
        setLoginHint(true)
        login.classList.replace("flex", "hidden")

        document.getElementById("login-error").classList.add("hidden")
        document.getElementById("login-info").classList.add("hidden")

        api.runtime.sendMessage({ type: "login", provider: "google.com", screenWidth: window.screen.width, screenHeight: window.screen.height }, (response) => {
            try {
                if (response && response.success) {
                    showExtension(response)
                    initialize()

                    login.classList.replace("flex", "hidden")
                } else {
                    login.classList.replace("hidden", "flex")

                    // A cancelled login (the user just closed the provider window/tab
                    // themselves) isn't an error - showing one there would be confusing
                    // UX for something the user did on purpose. Genuine failures (wrong
                    // credentials, the window getting blocked, etc.) still show one.
                    if (!response?.cancelled) {
                        displayError(`${response?.content?.error || 'Login failed'}`)
                    }
                }

                loader.classList.replace("flex", "hidden")
                setLoginHint(false)
            } catch (e) {
                sendError(e, "login response callback")
                login.classList.replace("hidden", "flex")
                loader.classList.replace("flex", "hidden")
                setLoginHint(false)
            }
        })
    } catch (e) {
        sendError(e, "login-with-google-btn click")
        login.classList.replace("hidden", "flex")
        loader.classList.replace("flex", "hidden")
        setLoginHint(false)
    }
})

document.getElementById("login-with-apple-btn").addEventListener("click", async function () {
    try {
        loader.classList.replace("hidden", "flex")
        setLoginHint(true)
        login.classList.replace("flex", "hidden")

        document.getElementById("login-error").classList.add("hidden")
        document.getElementById("login-info").classList.add("hidden")

        api.runtime.sendMessage({ type: "login", provider: "apple.com", screenWidth: window.screen.width, screenHeight: window.screen.height }, (response) => {
            try {
                if (response && response.success) {
                    showExtension(response)
                    initialize()

                    login.classList.replace("flex", "hidden")
                } else {
                    login.classList.replace("hidden", "flex")

                    // A cancelled login (the user just closed the provider window/tab
                    // themselves) isn't an error - showing one there would be confusing
                    // UX for something the user did on purpose. Genuine failures (wrong
                    // credentials, the window getting blocked, etc.) still show one.
                    if (!response?.cancelled) {
                        displayError(`${response?.content?.error || 'Login failed'}`)
                    }
                }

                loader.classList.replace("flex", "hidden")
                setLoginHint(false)
            } catch (e) {
                sendError(e, "login response callback")
                login.classList.replace("hidden", "flex")
                loader.classList.replace("flex", "hidden")
                setLoginHint(false)
            }
        })
    } catch (e) {
        sendError(e, "login-with-apple-btn click")
        login.classList.replace("hidden", "flex")
        loader.classList.replace("flex", "hidden")
        setLoginHint(false)
    }
})

document.getElementById("login-with-email-btn").addEventListener("click", async function () {
    try {
        document.getElementById("login-error").classList.add("hidden")
        document.getElementById("login-info").classList.add("hidden")

        const email = document.getElementById("email-input").value

        // Same as the website's login page: these accounts belong to the provider buttons above.
        // const domain = (email.split("@")[1] || "").toLowerCase()
        // if (["gmail.com", "googlemail.com", "google.com"].includes(domain)) {
        //     displayError("Please use <b>Continue with Google</b> for Gmail addresses.")
        //     return
        // }
        // if (["icloud.com", "me.com", "mac.com", "privaterelay.appleid.com"].includes(domain) || domain.endsWith(".appleid.com")) {
        //     displayError("Please use <b>Continue with Apple</b> for Apple addresses.")
        //     return
        // }

        api.runtime.sendMessage({ type: "email", email }, (response) => {
            try {
                if (response && response.success) {
                    displayInfo("<b>Sign-in link sent.</b><br>Open it on this device, in this browser. Not in your inbox? Check your spam folder.")
                } else {
                    displayError(`${response?.content?.error || 'Email login failed'}`)
                }
            } catch (e) {
                sendError(e, "email login response")
            }
        })
    } catch (e) {
        sendError(e, "login-with-email-btn click")
    }
})

function performSignOut() {
    try {
        api.runtime.sendMessage({ type: "sign-out" }, (response) => {
            try {
                if (response && response.success) {
                    content.classList.replace("flex", "hidden")
                    footer.classList.replace("flex", "hidden")
                    login.classList.replace("hidden", "flex")
                    const profileEl = document.getElementById("profile")
                    if (profileEl) profileEl.classList.replace("flex", "hidden")
                }
            } catch (e) {
                sendError(e, "sign-out response")
            }
        })
    } catch (e) {
        sendError(e, "sign-out click")
    }
}

document.getElementById("profile-sign-out")?.addEventListener("click", performSignOut)

document.getElementById("sign-out").addEventListener("click", async function () {
    performSignOut()
})

document.getElementById("email-input").addEventListener("keydown", (event) => {
    try {
        if (event.key === "Enter") {
            document.getElementById("login-with-email-btn").click()
        }
    } catch (e) {
        sendError(e, "email-input keydown")
    }
})

function displayInfo(message) {
    loginError.classList.add("hidden")
    loginInfo.classList.remove("hidden")
    loginInfo.innerHTML = message
}

function displayError(message) {
    loginInfo.classList.add("hidden")
    loginError.innerHTML = message
    loginError.classList.remove("hidden")
}

// Matches translate.js's updateSidebarModeTabs() class strings verbatim (same treatment as
// the Translate/Edit mode toggle in the sidebar) - "relative" is appended so the settings
// button's update-badge child keeps its positioning context regardless of active state.
const FOOTER_TAB_ACTIVE_CLASS = "relative flex-1 flex items-center justify-center gap-2 py-1.5 px-3 text-sm font-semibold rounded-xl transition-all duration-150 bg-cyan-300/60 dark:bg-cyan-600/60 text-neutral-900 dark:text-neutral-100 shadow-sm cursor-pointer"
const FOOTER_TAB_INACTIVE_CLASS = "relative flex-1 flex items-center justify-center gap-2 py-1.5 px-3 text-sm font-medium rounded-xl transition-all duration-150 text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50 cursor-pointer bg-transparent border-transparent shadow-none"

function setPage(page) {
    home.classList.replace("flex", "hidden")
    recent.classList.replace("flex", "hidden")
    settings.classList.replace("flex", "hidden")

    homeButton.className = FOOTER_TAB_INACTIVE_CLASS
    recentButton.className = FOOTER_TAB_INACTIVE_CLASS
    settingsButton.className = FOOTER_TAB_INACTIVE_CLASS

    if (page === "home") {
        home.classList.replace("hidden", "flex")
        homeButton.className = FOOTER_TAB_ACTIVE_CLASS
    } else if (page === "recent") {
        recent.classList.replace("hidden", "flex")
        recentButton.className = FOOTER_TAB_ACTIVE_CLASS
    } else if (page === "settings") {
        settings.classList.replace("hidden", "flex")
        settingsButton.className = FOOTER_TAB_ACTIVE_CLASS
    }
}

homeButton.addEventListener("click", function () {
    try {
        setPage("home")
    } catch (e) {
        sendError(e, "homeButton click")
    }
})

recentButton.addEventListener("click", function () {
    try {
        setPage("recent")
        currentPage = 1
        loadRecentv2()
    } catch (e) {
        sendError(e, "recentButton click")
    }
})

async function loadRecentv2() {
    try {
        // Retention Check
        const savedTTL = localStorage.getItem('recent_ttl') || "604800000"
        retentionSelect.value = savedTTL

        // Mirror to extension storage so the background script's scheduled cleanup can read it;
        // localStorage is not shared between the popup and the service worker.
        api.storage.local.set({ yomi_recent_ttl: savedTTL }).catch(() => { })

        if (currentPage === 1) {
            try {
                await translationCache.cleanup(parseInt(savedTTL))
            } catch (e) {
                console.warn("Local cleanup failed, trying background", e)
                await new Promise(resolve => {
                    api.runtime.sendMessage({ type: "cleanup_cache", ttl: parseInt(savedTTL) }, (response) => {
                        resolve()
                    })
                })
            }
        }

        const offset = (currentPage - 1) * RECENT_LIMIT

        // Fetch LIMIT + 1 to check if there are more items
        let items
        try {
            items = await translationCache.getRecent(RECENT_LIMIT + 1, offset)
        } catch (e) {
            console.warn("Local getRecent failed, trying background", e)
            items = await new Promise((resolve, reject) => {
                api.runtime.sendMessage({ type: "get_recent", limit: RECENT_LIMIT + 1, offset: offset }, (response) => {
                    if (api.runtime.lastError) {
                        reject(api.runtime.lastError)
                    } else if (response && response.success) {
                        resolve(response.content)
                    } else {
                        reject(response?.content?.error || "Background fetch failed")
                    }
                })
            })
        }

        // If current page is empty and we are not on page 1, go back
        if (items.length === 0 && currentPage > 1) {
            currentPage--
            await loadRecentv2() // Recursively load previous page
            return
        }

        hasNextPage = items.length > RECENT_LIMIT
        const itemsToDisplay = items.slice(0, RECENT_LIMIT)
        currentRecentItems = itemsToDisplay

        // Always clear grid for pagination behavior
        recentGrid.innerHTML = ""
        renderRecentGrid(itemsToDisplay, false)

        // Update Pagination Controls
        if (hasNextPage || currentPage > 1) {
            paginationControls.classList.remove("hidden")
            paginationControls.classList.add("flex")
            pageIndicator.textContent = `Page ${currentPage}`

            prevPageBtn.disabled = currentPage <= 1
            nextPageBtn.disabled = !hasNextPage
        } else {
            paginationControls.classList.add("hidden")
            paginationControls.classList.remove("flex")
        }
    } catch (error) {
        sendError(error, "loadRecentv2")
        console.error("Failed to load recent translations", error)
    }
}

function renderRecentGrid(items, append = false) {
    if (!append) {
        currentRecentItems = items
        recentGrid.innerHTML = ""
    } else {
        currentRecentItems = [...currentRecentItems, ...items]
    }

    if (!append && items.length === 0) {
        recentEmpty.classList.replace("hidden", "flex")
        recentGrid.parentElement.classList.add("hidden") // Hide scroll container
    } else {
        recentEmpty.classList.replace("flex", "hidden")
        recentGrid.parentElement.classList.remove("hidden") // Show scroll container

        items.forEach(item => {
            const div = document.createElement("div")
            div.className = "relative group aspect-[3/4] rounded-lg overflow-hidden cursor-pointer border border-neutral-300 dark:border-neutral-600 shadow-sm hover:shadow transition-all duration-200 bg-white dark:bg-neutral-900/50"

            if (item.isCorrupted) {
                sendError(item.error, "renderRecentGrid")

                div.className = "relative group aspect-[3/4] rounded-lg overflow-hidden border border-red-600/30 bg-red-600/10 flex flex-col items-center justify-center text-center p-4 cursor-default";
                div.dataset.tooltipTitle = "Failed to load image data";

                div.innerHTML = `
                        <div class="text-red-500 dark:text-red-400 mb-2">
                            <svg class="w-10 h-10 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                        </div>
                        <div class="text-xs text-red-600 dark:text-red-400 font-medium">Image Corrupted</div>
                        <div class="text-[0.65rem] text-red-500 dark:text-red-400 mt-1 break-words w-full px-2">Data read failed</div>
                    `;

                recentGrid.appendChild(div)
                return;
            }

            const img = document.createElement("img")
            img.src = item.image
            img.className = "w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"

            const overlay = document.createElement("div")
            overlay.className = "absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center"

            const viewBtn = document.createElement("span")
            viewBtn.className = "px-4 py-2 bg-white/90 text-neutral-900 rounded-full text-sm font-medium transform translate-y-2 group-hover:translate-y-0 transition-transform duration-200"
            viewBtn.textContent = "View"

            overlay.appendChild(viewBtn)
            div.appendChild(img)
            div.appendChild(overlay)

            div.addEventListener("click", () => openRecentImage(item))
            recentGrid.appendChild(div)
        })
    }
}

prevPageBtn.addEventListener("click", () => {
    try {
        if (currentPage > 1) {
            currentPage--
            loadRecentv2()
        }
    } catch (e) {
        sendError(e, "prevPageBtn click")
    }
})

nextPageBtn.addEventListener("click", () => {
    try {
        currentPage++
        loadRecentv2()
    } catch (e) {
        sendError(e, "nextPageBtn click")
    }
})

async function navigateDetail(direction) {
    if (recentDetailView.classList.contains("hidden") || !currentViewingItem) return

    const idx = currentRecentItems.findIndex(i => i.key === currentViewingItem.key)
    if (idx === -1) return

    if (direction === 'next') {
        if (idx < currentRecentItems.length - 1) {
            openRecentImage(currentRecentItems[idx + 1])
        } else if (hasNextPage) {
            currentPage++
            await loadRecentv2()
            if (currentRecentItems.length > 0) openRecentImage(currentRecentItems[0])
        }
    } else if (direction === 'prev') {
        if (idx > 0) {
            openRecentImage(currentRecentItems[idx - 1])
        } else if (currentPage > 1) {
            currentPage--
            await loadRecentv2()
            if (currentRecentItems.length > 0) openRecentImage(currentRecentItems[currentRecentItems.length - 1])
        }
    }
}

prevRecentBtn.addEventListener("click", (e) => {
    try {
        e.stopPropagation();
        navigateDetail('prev')
    } catch (err) {
        sendError(err, "prevRecentBtn click")
    }
})
nextRecentBtn.addEventListener("click", (e) => {
    try {
        e.stopPropagation();
        navigateDetail('next')
    } catch (err) {
        sendError(err, "nextRecentBtn click")
    }
})

document.addEventListener("keydown", (e) => {
    try {
        if (recentDetailView.classList.contains("hidden")) return
        if (e.key === "ArrowLeft") navigateDetail('prev')
        if (e.key === "ArrowRight") navigateDetail('next')
    } catch (err) {
        sendError(err, "document keydown navigation")
    }
})

function openRecentImage(item) {
    currentViewingItem = item
    currentViewMode = 'translated'

    // Check if inpainted exists, fallback if not
    if (!item.inpainted && currentViewMode === 'inpainted') {
        currentViewMode = 'translated'
    }

    updateImageDisplay()
    // recentFilename.textContent = ... // Removed

    if (item.timestamp) {
        recentDate.textContent = new Date(item.timestamp).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
        recentDate.classList.remove("hidden")
    } else {
        recentDate.classList.add("hidden")
    }

    recentGridView.classList.add("hidden")
    autoSaveContainer.classList.add("hidden")
    recentDetailView.classList.replace("hidden", "flex")

    // Update Arrows
    const idx = currentRecentItems.findIndex(i => i.key === item.key)
    if (idx !== -1) {
        if (idx > 0 || currentPage > 1) {
            prevRecentBtn.classList.remove("hidden")
        } else {
            prevRecentBtn.classList.add("hidden")
        }

        if (idx < currentRecentItems.length - 1 || hasNextPage) {
            nextRecentBtn.classList.remove("hidden")
        } else {
            nextRecentBtn.classList.add("hidden")
        }
    }
}

function updateImageDisplay() {
    if (!currentViewingItem) return

    let src = currentViewingItem.image
    let label = "Translated"

    if (currentViewMode === 'original') {
        src = currentViewingItem.original
        label = "Original"
    } else if (currentViewMode === 'inpainted') {
        src = currentViewingItem.inpainted
        label = "Inpainted"
    }

    recentImage.src = src
    recentBadge.textContent = label
}

recentBackBtn.addEventListener("click", () => {
    try {
        recentDetailView.classList.add("hidden")
        recentDetailView.classList.remove("flex")
        recentGridView.classList.remove("hidden")
        autoSaveContainer.classList.remove("hidden")
        currentViewingItem = null
    } catch (e) {
        sendError(e, "recentBackBtn click")
    }
})

recentFlipBtn.addEventListener("click", () => {
    try {
        if (currentViewMode === 'translated') {
            currentViewMode = 'original'
        } else if (currentViewMode === 'original') {
            if (currentViewingItem.inpainted) {
                currentViewMode = 'inpainted'
            } else {
                currentViewMode = 'translated'
            }
        } else {
            currentViewMode = 'translated'
        }
        updateImageDisplay()
    } catch (e) {
        sendError(e, "recentFlipBtn click")
    }
})

recentDownloadBtn.addEventListener("click", () => {
    try {
        if (!currentViewingItem) return
        const link = document.createElement('a')
        link.href = recentImage.src
        link.download = `yomi_${currentViewMode}_${Date.now()}.jpg`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
    } catch (e) {
        sendError(e, "recentDownloadBtn click")
    }
})

recentOpenBtn.addEventListener("click", async (e) => {
    if (!currentViewingItem) return

    try {
        const blob = dataUrlToBlob(recentImage.src)
        const blobUrl = URL.createObjectURL(blob)

        api.tabs.create({ url: blobUrl, active: !e.ctrlKey })

        // Revoke after a few minutes to free memory
        setTimeout(() => URL.revokeObjectURL(blobUrl), 180000)
    } catch (error) {
        console.error("Failed to open image", error)
        sendError(error, "open image in tab")
    }
})

recentDeleteBtn.addEventListener("click", async () => {
    if (!currentViewingItem) return

    const performDelete = async () => {
        try {
            await translationCache.delete(currentViewingItem.key)
        } catch (error) {
            console.warn("Local delete failed, trying background", error);
            // Fallback to background
            await new Promise((resolve, reject) => {
                api.runtime.sendMessage({ type: "delete_recent", key: currentViewingItem.key }, (response) => {
                    if (api.runtime.lastError) reject(api.runtime.lastError);
                    else if (response && response.success) resolve();
                    else reject(response?.content?.error || "Background delete failed");
                });
            });
        }
    }

    try {
        await performDelete();
        recentBackBtn.click()
        loadRecentv2()
    } catch (error) {
        sendError(error, "recentDeleteBtn")
        console.error("Failed to delete translation", error)
    }
})

// The popover renders flat key/value rows, so the stored metadata is reduced to the numbers
// worth a line each. The attempts array and the reasoning transcript are deliberately left out
// - they belong in the details panel on the page, which has room to lay them out.
function summarizeTranslationMetadata(meta) {
    if (!meta || typeof meta !== "object") return null

    const num = (v) => (v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null)
    const seconds = (v) => (num(v) === null ? null : `${num(v).toFixed(1)}s`)

    const summary = {
        credits_used: num(meta.credits_used),
        fallback_model: meta.fallback_model || null,
        fallback_reason: meta.fallback_reason || null,
        ocr_time: seconds(meta.ocr_time),
        inpaint_time: seconds(meta.inpaint_time),
        translation_time: seconds(meta.translation_time),
        summarization_time: seconds(meta.summarization_time),
        render_time: seconds(meta.render_time),
        colorize_time: seconds(meta.colorize_time),
        total_texts: num(meta.total_texts_count),
        filtered_texts: num(meta.filtered_texts_count),
        prompt_tokens: num(meta.prompt_tokens),
        completion_tokens: num(meta.completion_tokens),
        reasoning_tokens: num(meta.reasoning_tokens),
        total_tokens: num(meta.total_tokens),
    }

    for (const key of Object.keys(summary)) {
        if (summary[key] === null || summary[key] === undefined) delete summary[key]
    }

    return Object.keys(summary).length > 0 ? summary : null
}

recentInfoBtn.addEventListener("click", (e) => {
    try {
        e.stopPropagation()
        if (recentInfoPopover.classList.contains("hidden")) {
            // Populate info
            recentInfoContent.innerHTML = ""
            // Check both direct settings object and potentially nested scenarios if any
            let itemSettings = currentViewingItem ? currentViewingItem.settings : null
            // What the server reported about the run, as opposed to what was asked of it.
            // Only present on records translated since this was added.
            const itemMetadata = summarizeTranslationMetadata(currentViewingItem ? currentViewingItem.metadata : null)

            if (itemSettings) {
                for (const [k, v] of Object.entries(itemSettings)) {
                    if (v === undefined || v === null || v === "") continue
                    const row = document.createElement("div")

                    if (k === 'custom_prompt') {
                        row.className = "flex flex-col gap-0.5"
                        row.innerHTML = `<span class="font-medium capitalize text-neutral-500 dark:text-neutral-400">${k.replace(/_/g, ' ')}:</span> <span class="text-left text-wrap break-words text-xs text-neutral-700 dark:text-neutral-200 bg-neutral-100 dark:bg-neutral-800 p-1 rounded border border-neutral-200 dark:border-neutral-700 max-h-24 overflow-y-auto">${v}</span>`
                    } else {
                        row.className = "flex justify-between gap-4"
                        row.innerHTML = `<span class="font-medium capitalize text-neutral-500 dark:text-neutral-400 whitespace-nowrap">${k.replace(/_/g, ' ')}:</span> <span class="text-right truncate">${v}</span>`
                    }
                    recentInfoContent.appendChild(row)
                }
            } else {
                recentInfoContent.innerHTML = "<span class='text-neutral-400 dark:text-neutral-500 italic'>No settings available</span>"
            }

            if (itemMetadata) {
                const heading = document.createElement("div")
                heading.className = "mt-2 pt-2 border-t border-neutral-200 dark:border-neutral-700 text-[0.65rem] uppercase font-bold tracking-wider text-neutral-400 dark:text-neutral-500"
                heading.textContent = "Reported by the server"
                recentInfoContent.appendChild(heading)

                for (const [k, v] of Object.entries(itemMetadata)) {
                    if (v === undefined || v === null || v === "") continue
                    const row = document.createElement("div")
                    row.className = "flex justify-between gap-4"
                    // textContent per cell, not innerHTML: fallback_reason is a server-authored
                    // string and has no business being parsed as markup.
                    const label = document.createElement("span")
                    label.className = "font-medium capitalize text-neutral-500 dark:text-neutral-400 whitespace-nowrap"
                    label.textContent = k.replace(/_/g, " ") + ":"
                    const value = document.createElement("span")
                    value.className = "text-right truncate"
                    value.textContent = v
                    row.appendChild(label)
                    row.appendChild(value)
                    recentInfoContent.appendChild(row)
                }
            }

            recentInfoPopover.classList.remove("hidden")
        } else {
            recentInfoPopover.classList.add("hidden")
        }
    } catch (err) {
        sendError(err, "recentInfoBtn click")
    }
})

document.addEventListener("click", (e) => {
    try {
        if (!recentInfoBtn.contains(e.target) && !recentInfoPopover.contains(e.target)) {
            recentInfoPopover.classList.add("hidden")
        }
    } catch (err) {
        sendError(err, "document click info popover")
    }
})

const retentionSelectBox = document.getElementById("retention-select-box")
const retentionDropdownTrigger = document.getElementById("retention-dropdown-trigger")
const retentionDropdownList = document.getElementById("retention-dropdown-list")
const retentionDropdownArrow = document.getElementById("retention-dropdown-arrow")
const retentionDropdownSelectedText = document.getElementById("retention-dropdown-selected-text")

function syncRetentionDropdownToSelect() {
    const selectedOpt = retentionSelect.options[retentionSelect.selectedIndex]
    retentionDropdownSelectedText.innerText = selectedOpt ? selectedOpt.text : ""
}

function updateRetentionDropdownList() {
    retentionDropdownList.innerHTML = ""
    for (const opt of retentionSelect.options) {
        const item = document.createElement("div")
        item.className = "flex items-center px-3 py-1 hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50 hover:text-neutral-900 dark:hover:text-white cursor-pointer text-neutral-800 dark:text-neutral-100 transition-colors min-w-0"
        if (opt.value === retentionSelect.value) markDropdownItemSelected(item)

        const textSpan = document.createElement("span")
        textSpan.className = "flex-grow select-none pr-4 text-base truncate"
        textSpan.innerText = opt.text
        item.appendChild(textSpan)

        item.addEventListener("click", (e) => {
            e.stopPropagation()
            retentionSelect.value = opt.value
            retentionSelect.dispatchEvent(new Event("change"))
            toggleRetentionDropdown(false)
        })
        retentionDropdownList.appendChild(item)
    }
}

function toggleRetentionDropdown(show) {
    const shouldShow = show !== undefined ? show : retentionDropdownList.classList.contains("hidden")
    if (shouldShow) {
        updateRetentionDropdownList()
        positionFloatingDropdown(retentionSelectBox, retentionDropdownList, 6)
        scrollDropdownToSelected(retentionDropdownList, { center: true })
        retentionDropdownArrow.classList.add("rotate-180")
    } else {
        retentionDropdownList.classList.add("hidden")
        retentionDropdownArrow.classList.remove("rotate-180")
    }
}

interceptSelectValue(retentionSelect, syncRetentionDropdownToSelect)
syncRetentionDropdownToSelect()

retentionSelectBox.addEventListener("click", (e) => {
    if (retentionDropdownList.contains(e.target)) return
    toggleRetentionDropdown()
})

document.addEventListener("click", (e) => {
    if (!retentionDropdownList.classList.contains("hidden") && !retentionSelectBox.contains(e.target)) {
        toggleRetentionDropdown(false)
    }
})

window.addEventListener("scroll", (e) => {
    if (retentionDropdownList.contains(e.target)) return
    toggleRetentionDropdown(false)
}, true)

setupDropdownTypeahead(retentionDropdownTrigger, retentionDropdownList, retentionSelect, {
    onMatch: () => {
        syncRetentionDropdownToSelect()
        refreshOpenDropdown(retentionDropdownList, updateRetentionDropdownList)
    }
})
setupDropdownArrowKeys(retentionDropdownTrigger, retentionDropdownList, toggleRetentionDropdown)

retentionSelect.addEventListener("change", async () => {
    try {
        localStorage.setItem('recent_ttl', retentionSelect.value)
        api.storage.local.set({ yomi_recent_ttl: retentionSelect.value }).catch(() => { })

        try {
            await translationCache.cleanup(parseInt(retentionSelect.value))
        } catch (error) {
            console.warn("Local cleanup failed, trying background", error);
            await new Promise((resolve, reject) => {
                api.runtime.sendMessage({ type: "cleanup_cache", ttl: parseInt(retentionSelect.value) }, (response) => {
                    if (api.runtime.lastError) reject(api.runtime.lastError);
                    else if (response && response.success) resolve();
                    else reject(response?.content?.error || "Background cleanup failed");
                })
            })
        }

        loadRecentv2()
    } catch (error) {
        sendError(error, "retentionSelect")
    }
})

settingsButton.addEventListener("click", function () {
    try {
        setPage("settings")
    } catch (e) {
        sendError(e, "settingsButton click")
    }
})

defaultEnabled.addEventListener("change", (event) => {
    try {
        api.storage.sync.set({ yomi_default_enabled: defaultEnabled.checked })
    } catch (e) {
        sendError(e, "defaultEnabled listener")
    }
})

if (textStroke) {
    textStroke.addEventListener("click", async (event) => {
        try {
            const setting = await api.storage.sync.get({ yomi_stroke_enabled: false })
            console.log("textStroke click", setting["yomi_stroke_enabled"])
            api.storage.sync.set({ yomi_stroke_enabled: !setting["yomi_stroke_enabled"] })
            updateStrokeBtnState(!setting["yomi_stroke_enabled"])
        } catch (e) {
            sendError(e, "strokeEnabled listener")
        }
    })
}

bubblesOnly.addEventListener("click", async (event) => {
    try {
        const setting = await api.storage.sync.get({ yomi_bubbles_only: false })
        console.log("bubblesOnly click", setting["yomi_bubbles_only"])
        api.storage.sync.set({ yomi_bubbles_only: !setting["yomi_bubbles_only"] })
        setBubblesOnly(!setting["yomi_bubbles_only"])
    } catch (e) {
        sendError(e, "bubblesOnly listener")
    }
})

contextSharing.addEventListener("click", async (event) => {
    try {
        const setting = await api.storage.sync.get({ yomi_context_sharing: false })
        console.log("contextSharing click", setting["yomi_context_sharing"])
        api.storage.sync.set({ yomi_context_sharing: !setting["yomi_context_sharing"] })
        updateContextSharingBtnState(!setting["yomi_context_sharing"])
    } catch (e) {
        sendError(e, "contextSharing listener")
    }
})

autocache.addEventListener("change", (event) => {
    try {
        api.storage.sync.set({ autocache: autocache.checked })
    } catch (e) {
        sendError(e, "autocache listener")
    }
})

if (minImageSizeInput) {
    minImageSizeInput.addEventListener("input", (event) => {
        try {
            let value = parseInt(event.target.value)
            if (minImageSizeValue) {
                minImageSizeValue.textContent = value + "px"
            }
        } catch (e) {
            sendError(e, "minImageSizeInput input listener")
        }
    })

    minImageSizeInput.addEventListener("change", (event) => {
        try {
            let value = parseInt(event.target.value)
            if (minImageSizeValue) {
                minImageSizeValue.textContent = value + "px"
            }
            api.storage.sync.set({ yomi_min_image_size: value })
        } catch (e) {
            sendError(e, "minImageSizeInput change listener")
        }
    })
}

yomiTL.addEventListener("click", (event) => {
    try {
        setYomiLocation("tl")
        api.storage.sync.set({ yomi_location: "tl" })
    } catch (e) {
        sendError(e, "yomiTL click")
    }
})

yomiTR.addEventListener("click", (event) => {
    try {
        setYomiLocation("tr")
        api.storage.sync.set({ yomi_location: "tr" })
    } catch (e) {
        sendError(e, "yomiTR click")
    }
})

// An open section's header sits at full contrast, a closed one stays muted - so the one
// expanded section reads as the active one at a glance. The classes live on the button
// itself (not a nested label div) so its chevron, which inherits currentColor, brightens
// along with the text.
function setAccordionHeaderOpen(btn, isOpen) {
    if (!btn) return
    btn.classList.toggle("text-neutral-800", isOpen)
    btn.classList.toggle("dark:text-neutral-100", isOpen)
    btn.classList.toggle("text-neutral-500", !isOpen)
    btn.classList.toggle("dark:text-neutral-400", !isOpen)
}

// The browser auto-scrolls a focused field only when it thinks the field is offscreen, and it
// thinks the keyboard-covered strip is still visible. scrollTo, not scrollIntoView, for the
// same reason: scrollIntoView no-ops on a field it considers already in view.
function scrollFocusedFieldIntoView(field) {
    const scrollport = document.getElementById("translate-settings")
    const scrollContent = document.getElementById("translate-settings-content")
    if (!scrollport || !scrollContent || !scrollport.contains(field)) return

    // Aim at the group holding the field's label, so its label and toggle come along instead of
    // being left above the fold - the BYOK cards put both above the input.
    const target = (field.id && field.closest(`:has(label[for="${field.id}"])`)) || field

    // Section headers are sticky, so stop short of them or they cover what we scrolled to.
    const section = Array.from(scrollContent.children).find((c) => c.contains(field))
    const sticky = section?.querySelector(":scope > .sticky")
    const stickyHeight = sticky ? sticky.getBoundingClientRect().height : 0
    const offset = target.getBoundingClientRect().top - scrollport.getBoundingClientRect().top

    scrollport.scrollTo({
        top: scrollport.scrollTop + offset - stickyHeight - 8,
        behavior: "smooth"
    })
}

// Firefox for Android paints the soft keyboard over the popup without resizing either
// viewport, so an open section has to be able to scroll clear of it under its own steam.
function setAccordionScrollReserve(open) {
    if (!document.documentElement.classList.contains("is-mobile")) return

    const scrollContent = document.getElementById("translate-settings-content")
    if (!scrollContent) return

    // A spacer, not padding-bottom: scrollContent is a stretched flex item with
    // box-sizing:border-box, so padding is swallowed and buys no scroll range at all.
    let spacer = document.getElementById("accordion-scroll-reserve")
    if (!spacer) {
        spacer = document.createElement("div")
        spacer.id = "accordion-scroll-reserve"
        spacer.style.flex = "0 0 auto"
        scrollContent.appendChild(spacer)
    }

    spacer.style.height = open ? "50vh" : "0px"
}

function toggleAccordion(toggleBtn, bodyEl) {
    if (!toggleBtn || !bodyEl) return
    const isHidden = bodyEl.classList.contains("hidden")

    // Only one of the three settings sections (custom prompt / BYOK / source lang
    // whitelist) can be expanded at a time - collapse the others whenever we open one.
    if (isHidden) {
        const otherAccordions = [
            [toggleCustomPromptBtn, customPromptBody],
            [toggleByokBtn, byokBody],
            [toggleSourceLangsBtn, sourceLangsBody],
        ]
        otherAccordions.forEach(([btn, body]) => {
            if (!btn || !body || body === bodyEl) return
            body.classList.add("hidden")
            btn.setAttribute("aria-expanded", "false")
            const otherArrow = btn.querySelector(":scope > svg")
            if (otherArrow) otherArrow.classList.add("-rotate-90")
            setAccordionHeaderOpen(btn, false)
        })
    }

    bodyEl.classList.toggle("hidden", !isHidden)
    setAccordionScrollReserve(isHidden)
    toggleBtn.setAttribute("aria-expanded", isHidden ? "true" : "false")
    // Must be a direct child of the button, not just any "svg:last-child" - the status-dot
    // icon (nested inside its own span, earlier in the DOM) also matches "last-child of its
    // own parent" and would otherwise be picked up by querySelector first, since it comes
    // before the real chevron in document order. That's what was rotating instead of the arrow.
    // Matches the website's convention (translate.js's initSectionToggle): closed = -rotate-90
    // (pointing right), open = no rotation (pointing down) - NOT rotate-180/up.
    const arrow = toggleBtn.querySelector(":scope > svg")
    if (arrow) arrow.classList.toggle("-rotate-90", !isHidden)
    setAccordionHeaderOpen(toggleBtn, isHidden)

    // isHidden is the PRE-toggle state, i.e. true means we just opened it - bring the header
    // to the top of the scrollable panel so the newly-revealed content is actually visible.
    if (isHidden) {
        toggleBtn.scrollIntoView({ behavior: "smooth", block: "start" })
    }
}

toggleCustomPromptBtn.addEventListener("click", () => {
    try {
        toggleAccordion(toggleCustomPromptBtn, customPromptBody)
    } catch (e) {
        sendError(e, "toggleCustomPromptBtn click")
    }
})

toggleByokBtn.addEventListener("click", () => {
    try {
        toggleAccordion(toggleByokBtn, byokBody)
    } catch (e) {
        sendError(e, "toggleByokBtn click")
    }
})

// Helper to mask API keys
function maskApiKey(key) {
    if (!key) return "";
    if (key.length <= 10) {
        return key.length >= 3 ? "..." + key.slice(-3) : "...";
    }
    return key.slice(0, 8) + "..." + key.slice(-4);
}

// Helper to update active status indicators
function updateBYOKIndicator(provider, isActive) {
    const input = document.getElementById(`byok-${provider}-input`);
    if (!input) return;
    const container = input.parentElement;
    let indicator = container.querySelector(".byok-status-indicator");

    if (isActive) {
        input.classList.remove("pr-3");
        input.classList.add("pr-8");
        if (!indicator) {
            indicator = document.createElement("span");
            indicator.className = "byok-status-indicator absolute right-3 flex items-center text-green-500 cursor-default pointer-events-auto";
            indicator.setAttribute("data-tooltip-title", "Key is active and will be used");
            indicator.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-green-600 dark:text-green-500" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                </svg>
            `;
            container.appendChild(indicator);
        }
    } else {
        input.classList.remove("pr-8");
        input.classList.add("pr-3");
        if (indicator) {
            indicator.remove();
        }
    }
}

// Applies enabled/active visual state (toggle, dimmed inputs, status indicator) for a BYOK provider card
function applyBYOKProviderVisualState(provider, isEnabled, hasCredentials) {
    const toggle = byokToggles[provider];
    if (toggle) {
        toggle.checked = isEnabled;
        // A switch with nothing to switch stays quiet, so seven "on" switches don't outshine an empty form.
        toggle.closest("label")?.classList.toggle("opacity-50", !hasCredentials);
    }
    const card = document.querySelector(`.byok-provider-card[data-provider="${provider}"]`);
    if (card) {
        const inputWrapper = card.querySelector(".byok-input-wrapper");
        if (inputWrapper) {
            if (isEnabled) {
                inputWrapper.classList.remove("opacity-50", "pointer-events-none");
            } else {
                inputWrapper.classList.add("opacity-50", "pointer-events-none");
            }
        }
    }
    updateBYOKIndicator(provider, isEnabled && hasCredentials);
}

// Reads enabled/saved-key state from storage and applies it to the BYOK provider card
async function refreshBYOKProviderVisualState(provider) {
    if (provider === "local") {
        const result = await api.storage.sync.get({
            yomi_byok_local_enabled: true,
            yomi_byok_local_url: "",
            yomi_byok_local_model: ""
        });
        const isEnabled = result["yomi_byok_local_enabled"] !== false;
        const localUrlClean = (result["yomi_byok_local_url"] || "").trim();
        const localModelClean = (result["yomi_byok_local_model"] || "").trim();
        applyBYOKProviderVisualState(provider, isEnabled, localUrlClean !== "" && localModelClean !== "");
    } else {
        const result = await api.storage.sync.get({
            [`yomi_byok_${provider}_enabled`]: true,
            [`yomi_byok_${provider}`]: ""
        });
        const isEnabled = result[`yomi_byok_${provider}_enabled`] !== false;
        applyBYOKProviderVisualState(provider, isEnabled, !!result[`yomi_byok_${provider}`]);
    }
    updateByokStatusDot()
}

async function updateByokStatusDot() {
    const result = await api.storage.sync.get({
        yomi_byok_openrouter: "", yomi_byok_openrouter_enabled: true,
        yomi_byok_google: "", yomi_byok_google_enabled: true,
        yomi_byok_openai: "", yomi_byok_openai_enabled: true,
        yomi_byok_anthropic: "", yomi_byok_anthropic_enabled: true,
        yomi_byok_deepseek: "", yomi_byok_deepseek_enabled: true,
        yomi_byok_xai: "", yomi_byok_xai_enabled: true,
        yomi_byok_local_url: "", yomi_byok_local_model: "", yomi_byok_local_enabled: true
    })
    const isActive = byokProviders.some(provider => {
        if (provider === "local") {
            const localUrlClean = (result["yomi_byok_local_url"] || "").trim()
            const localModelClean = (result["yomi_byok_local_model"] || "").trim()
            return result["yomi_byok_local_enabled"] !== false && localUrlClean !== "" && localModelClean !== ""
        }
        return result[`yomi_byok_${provider}_enabled`] !== false && !!result[`yomi_byok_${provider}`]
    })
    if (byokStatus) {
        if (isActive) unhide(byokStatus)
        else hide(byokStatus)
    }
}

byokProviders.forEach(provider => {
    const input = document.getElementById(`byok-${provider}-input`)

    const toggle = byokToggles[provider];
    if (toggle) {
        toggle.addEventListener("change", async () => {
            const enabled = toggle.checked;
            await api.storage.sync.set({ [`yomi_byok_${provider}_enabled`]: enabled });
            await refreshBYOKProviderVisualState(provider);
            if (enabled) {
                if (provider === "local") {
                    autoSelectLocalModel();
                } else {
                    const savedKeyResult = await api.storage.sync.get({ [`yomi_byok_${provider}`]: "" });
                    if (savedKeyResult[`yomi_byok_${provider}`]) {
                        autoSelectModelForProvider(provider);
                    }
                }
            }
            updateModelSelectDropdown();
        });
    }

    if (input) {
        // Selection handles crowd out an already-cramped field on touch.
        const selectAll = () => { if (!isMobile()) input.select(); };
        input.addEventListener("click", selectAll);
        input.addEventListener("focus", selectAll);
        input.addEventListener("change", async (e) => {
            const rawKey = e.target.value.trim();

            api.storage.sync.get({
                [`yomi_byok_${provider}`]: "",
                [`yomi_byok_${provider}_masked`]: "",
                [`yomi_byok_${provider}_enabled`]: true
            }, async (result) => {
                const savedKey = result[`yomi_byok_${provider}`];
                const lastMasked = result[`yomi_byok_${provider}_masked`] || "Saved Key";

                if (savedKey && rawKey === lastMasked) {
                    return;
                }

                if (!rawKey) {
                    try {
                        await api.storage.sync.set({
                            [`yomi_byok_${provider}`]: "",
                            [`yomi_byok_${provider}_masked`]: ""
                        });
                        await refreshBYOKProviderVisualState(provider);
                        updateModelSelectDropdown();
                        if (provider === "local") updateSaveLocalPresetBtnState();
                    } catch (err) {
                        sendError(err, `byok-${provider}-input clear`);
                    }
                    return;
                }

                input.disabled = true;
                try {
                    api.runtime.sendMessage({ type: "byok-encrypt", key: rawKey, provider: provider }, async (response) => {
                        input.disabled = false;
                        const keyToStore = (response && response.success && response.encrypted_key) ? response.encrypted_key : rawKey;
                        try {
                            const masked = maskApiKey(rawKey);
                            await api.storage.sync.set({
                                [`yomi_byok_${provider}`]: keyToStore,
                                [`yomi_byok_${provider}_masked`]: masked
                            });
                            await api.storage.local.set({
                                [`yomi_byok_${provider}_plain`]: rawKey,
                                [`raw_byok_${provider}`]: rawKey
                            });
                            input.value = masked;
                            await refreshBYOKProviderVisualState(provider);
                            if (result[`yomi_byok_${provider}_enabled`] !== false) {
                                autoSelectModelForProvider(provider);
                            }
                            updateModelSelectDropdown();
                            if (provider === "local") updateSaveLocalPresetBtnState();
                        } catch (err) {
                            sendError(err, `byok-${provider}-input save`);
                            resetInput();
                        }
                    });
                } catch (err) {
                    input.disabled = false;
                    sendError(err, `byok-${provider}-input encrypt start`);
                    resetInput();
                }
            });

            async function resetInput() {
                try {
                    api.storage.sync.get({
                        [`yomi_byok_${provider}`]: "",
                        [`yomi_byok_${provider}_masked`]: ""
                    }, (result) => {
                        const savedVal = result[`yomi_byok_${provider}`];
                        const maskedVal = result[`yomi_byok_${provider}_masked`];
                        input.value = savedVal ? (maskedVal || "Saved Key") : "";
                        updateBYOKIndicator(provider, !!savedVal);
                        if (provider === "local") updateSaveLocalPresetBtnState();
                    });
                } catch (err) {
                    input.value = "";
                    updateBYOKIndicator(provider, false);
                    if (provider === "local") updateSaveLocalPresetBtnState();
                }
            }
        });
    }
})

// Self-Hosted URL and Model change listeners
const localUrlInput = document.getElementById("byok-local-url-input")
if (localUrlInput) {
    localUrlInput.addEventListener("change", (e) => {
        api.storage.sync.set({ yomi_byok_local_url: e.target.value.trim() }, async () => {
            validateLocalModelInput();
            const enabledResult = await api.storage.sync.get({ yomi_byok_local_enabled: true });
            if (enabledResult["yomi_byok_local_enabled"] !== false) {
                autoSelectLocalModel();
            }
            await refreshBYOKProviderVisualState("local");
            updateModelSelectDropdown();
            updateSaveLocalPresetBtnState();
        })
    })
    localUrlInput.addEventListener("input", () => {
        validateLocalModelInput();
        updateSaveLocalPresetBtnState();
    })
}
const localModelInput = document.getElementById("byok-local-model-input")
if (localModelInput) {
    localModelInput.addEventListener("change", (e) => {
        api.storage.sync.set({ yomi_byok_local_model: e.target.value.trim() }, async () => {
            validateLocalModelInput();
            const enabledResult = await api.storage.sync.get({ yomi_byok_local_enabled: true });
            if (enabledResult["yomi_byok_local_enabled"] !== false) {
                autoSelectLocalModel();
            }
            await refreshBYOKProviderVisualState("local");
            updateModelSelectDropdown();
            updateSaveLocalPresetBtnState();
        })
    })
    localModelInput.addEventListener("input", () => {
        validateLocalModelInput();
        updateModelSelectDropdown();
        updateSaveLocalPresetBtnState();
    })
}

// --- Saved Self-Hosted (BYOK Local) Presets ---
const savedLocalPresetsTrigger = document.getElementById("saved-local-presets-trigger")
const savedLocalPresetsTriggerText = document.getElementById("saved-local-presets-trigger-text")
const savedLocalPresetsList = document.getElementById("saved-local-presets-list")
const savedLocalPresetsArrow = document.getElementById("saved-local-presets-arrow")
const clearLocalPresetBtn = document.getElementById("clear-local-preset-btn")
const addLocalPresetBtn = document.getElementById("add-local-preset-btn")

let selectedLocalPresetId = null

function setSelectedLocalPresetId(id) {
    selectedLocalPresetId = id
    api.storage.sync.set({ yomi_selected_byok_local_preset_id: id })
}

function generateLocalPresetId() {
    return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

function getSavedLocalPresets() {
    return new Promise((resolve) => {
        api.storage.sync.get({ yomi_saved_byok_local_presets: [] }, (result) => {
            resolve(result.yomi_saved_byok_local_presets || [])
        })
    })
}

function saveSavedLocalPresets(presets) {
    api.storage.sync.set({ yomi_saved_byok_local_presets: presets })
}

function toggleSavedLocalPresetsDropdown(show) {
    if (!savedLocalPresetsList || !savedLocalPresetsTrigger) return
    const isHidden = savedLocalPresetsList.classList.contains("hidden")
    const shouldShow = show !== undefined ? show : isHidden

    if (shouldShow) {
        renderSavedLocalPresets()
        positionFloatingDropdown(savedLocalPresetsContainer || savedLocalPresetsTrigger, savedLocalPresetsList, 6)
        scrollDropdownToSelected(savedLocalPresetsList, { center: true })
        if (savedLocalPresetsArrow) savedLocalPresetsArrow.classList.add("rotate-180")
    } else {
        savedLocalPresetsList.classList.add("hidden")
        if (savedLocalPresetsArrow) savedLocalPresetsArrow.classList.remove("rotate-180")
    }
}

if (savedLocalPresetsTrigger) {
    savedLocalPresetsTrigger.addEventListener("click", () => {
        toggleSavedLocalPresetsDropdown()
    })
}

setupDropdownArrowKeys(savedLocalPresetsTrigger, savedLocalPresetsList, toggleSavedLocalPresetsDropdown)

document.addEventListener("click", (e) => {
    if (savedLocalPresetsList && !savedLocalPresetsList.classList.contains("hidden")) {
        if (savedLocalPresetsContainer && !savedLocalPresetsContainer.contains(e.target) && !savedLocalPresetsList.contains(e.target)) {
            toggleSavedLocalPresetsDropdown(false)
        }
    }
})

window.addEventListener("scroll", (e) => {
    if (savedLocalPresetsList && savedLocalPresetsList.contains(e.target)) {
        return
    }
    toggleSavedLocalPresetsDropdown(false)
}, true)

async function updateSaveLocalPresetBtnState() {
    const url = localUrlInput ? localUrlInput.value.trim() : ""
    const model = localModelInput ? localModelInput.value.trim() : ""
    const localKeyInput = document.getElementById("byok-local-input")
    const keyVal = localKeyInput ? localKeyInput.value.trim() : ""

    const saved = await getSavedLocalPresets()
    let selectedPreset = selectedLocalPresetId ? saved.find(p => p.id === selectedLocalPresetId) : null
    if (selectedLocalPresetId && !selectedPreset) {
        setSelectedLocalPresetId(null)
    }

    if (savedLocalPresetsTriggerText) {
        savedLocalPresetsTriggerText.innerText = selectedPreset
            ? (selectedPreset.name || selectedPreset.model || selectedPreset.url)
            : "Add new preset ..."
    }

    const hasAnyContent = !!(url || model || keyVal)
    if (clearLocalPresetBtn) {
        clearLocalPresetBtn.disabled = !hasAnyContent
    }

    if (!url || !model) {
        if (addLocalPresetBtn) addLocalPresetBtn.disabled = true
        if (saveLocalPresetBtn) saveLocalPresetBtn.disabled = true
        return
    }

    const storageResult = await api.storage.sync.get({
        yomi_byok_local: "",
        yomi_byok_local_masked: ""
    })
    const currentEncryptedKey = storageResult.yomi_byok_local || ""

    // Add only ever creates, so having a preset selected no longer blocks it - only an exact
    // duplicate does. That is the whole point of the split: you can add without first clearing.
    if (addLocalPresetBtn) {
        addLocalPresetBtn.disabled = saved.some(p =>
            p.url === url &&
            p.model === model &&
            (p.encryptedKey || "") === currentEncryptedKey
        )
    }

    // Save only ever overwrites the selected preset, so with nothing selected there is nothing
    // it could write to.
    if (saveLocalPresetBtn) {
        saveLocalPresetBtn.disabled = !selectedPreset || (
            selectedPreset.url === url &&
            selectedPreset.model === model &&
            (selectedPreset.encryptedKey || "") === currentEncryptedKey
        )
    }
}

let renamingLocalPresetIndex = -1

async function renderSavedLocalPresets() {
    const presets = await getSavedLocalPresets()

    if (!savedLocalPresetsList) return
    savedLocalPresetsList.innerHTML = ""

    const addNewItem = document.createElement("div")
    addNewItem.className = "flex items-center px-3 py-1.5 cursor-pointer text-neutral-800 dark:text-neutral-100 italic transition-colors min-w-0 hover:bg-neutral-200 dark:hover:bg-neutral-700"
    if (presets.length > 0) {
        addNewItem.classList.add("border-b", "border-neutral-300", "dark:border-neutral-700")
    }
    if (selectedLocalPresetId === null) {
        markDropdownItemSelected(addNewItem)
        addNewItem.classList.add("not-italic")
    }
    addNewItem.innerText = "Add new preset ..."
    addNewItem.addEventListener("click", () => {
        setSelectedLocalPresetId(null)
        if (localUrlInput) {
            localUrlInput.value = ""
            localUrlInput.dispatchEvent(new Event("change"))
        }
        if (localModelInput) {
            localModelInput.value = ""
            localModelInput.dispatchEvent(new Event("change"))
        }
        const localKeyInput = document.getElementById("byok-local-input")
        if (localKeyInput) {
            localKeyInput.value = ""
            localKeyInput.dispatchEvent(new Event("change"))
        }
        toggleSavedLocalPresetsDropdown(false)
    })
    savedLocalPresetsList.appendChild(addNewItem)

    presets.forEach((preset, index) => {
        const displayName = preset.name || preset.model || preset.url
        const isRenaming = index === renamingLocalPresetIndex
        const isSelected = preset.id === selectedLocalPresetId

        const item = document.createElement("div")
        item.className = "flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-100 transition-colors min-w-0"
        item.classList.toggle("cursor-pointer", !isRenaming)
        if (isSelected && !isRenaming) {
            markDropdownItemSelected(item)
        }

        if (isRenaming) {
            const nameInput = document.createElement("input")
            nameInput.type = "text"
            nameInput.value = displayName
            nameInput.className = "flex-grow min-w-0 text-sm bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 border border-cyan-600 rounded px-1.5 py-0.5 focus:outline-none"

            const commitRename = () => {
                nameInput.removeEventListener("blur", commitRename)
                const newName = nameInput.value.trim()
                renamingLocalPresetIndex = -1
                getSavedLocalPresets().then(saved => {
                    const target = saved.find(p => p.id === preset.id)
                    if (target && newName && newName !== displayName) {
                        target.name = newName
                        saveSavedLocalPresets(saved)
                    }
                    renderSavedLocalPresets()
                    updateSaveLocalPresetBtnState()
                })
            }

            nameInput.addEventListener("click", (e) => e.stopPropagation())
            nameInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault()
                    commitRename()
                } else if (e.key === "Escape") {
                    e.preventDefault()
                    nameInput.removeEventListener("blur", commitRename)
                    renamingLocalPresetIndex = -1
                    renderSavedLocalPresets()
                }
            })
            nameInput.addEventListener("blur", commitRename)

            item.appendChild(nameInput)
            savedLocalPresetsList.appendChild(item)
            nameInput.focus()
            nameInput.select()
            return
        }

        const textSpan = document.createElement("span")
        textSpan.className = "flex-grow select-none pr-2 text-sm truncate max-w-56"
        textSpan.innerText = displayName
        textSpan.title = `${displayName}\nURL: ${preset.url}\nModel: ${preset.model}`
        item.appendChild(textSpan)

        const actionsContainer = document.createElement("div")
        actionsContainer.className = "flex items-center gap-1 shrink-0"

        const renameBtn = document.createElement("button")
        renameBtn.type = "button"
        renameBtn.className = "rename-local-preset-btn p-1 hover:bg-neutral-300 dark:hover:bg-neutral-600 text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100 rounded transition-colors focus:outline-none shrink-0 cursor-pointer"
        renameBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M15.7279 9.57627L14.3137 8.16206L5 17.4758V18.89H6.41421L15.7279 9.57627ZM17.1421 8.16206L18.5563 6.74785L17.1421 5.33363L15.7279 6.74785L17.1421 8.16206ZM7.24264 20.89H3V16.6474L16.435 3.21233C16.8256 2.8218 17.4587 2.8218 17.8492 3.21233L20.6777 6.04074C21.0682 6.43126 21.0682 7.06443 20.6777 7.45495L7.24264 20.89Z"></path></svg>`
        renameBtn.dataset.tooltipTitle = "Rename preset"
        renameBtn.setAttribute("aria-label", "Rename preset")

        renameBtn.addEventListener("click", (e) => {
            e.stopPropagation()
            renamingLocalPresetIndex = index
            renderSavedLocalPresets()
        })

        const deleteBtn = document.createElement("button")
        deleteBtn.type = "button"
        deleteBtn.className = "delete-local-preset-btn p-1 hover:bg-red-50 text-neutral-400 hover:text-red-500 rounded transition-colors focus:outline-none shrink-0 cursor-pointer"
        deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17 6H22V8H20V21C20 21.5523 19.5523 22 19 22H5C4.44772 22 4 21.5523 4 21V8H2V6H7V4C7 3.44772 7.44772 3 8 3H16C16.5523 3 17 3.44772 17 4V6ZM15 6V5H9V6H15ZM6 8V20H18V8H6ZM9 11H11V17H9V11ZM13 11H15V17H13V11Z"></path></svg>`
        deleteBtn.dataset.tooltipTitle = "Delete preset"
        deleteBtn.setAttribute("aria-label", "Delete preset")

        deleteBtn.addEventListener("click", async (e) => {
            e.stopPropagation()
            const saved = await getSavedLocalPresets()
            const filtered = saved.filter(p => p.id !== preset.id)
            saveSavedLocalPresets(filtered)

            if (isSelected) {
                setSelectedLocalPresetId(null)
                if (localUrlInput) {
                    localUrlInput.value = ""
                    localUrlInput.dispatchEvent(new Event("change"))
                }
                if (localModelInput) {
                    localModelInput.value = ""
                    localModelInput.dispatchEvent(new Event("change"))
                }
                const localKeyInput = document.getElementById("byok-local-input")
                if (localKeyInput) {
                    localKeyInput.value = ""
                    localKeyInput.dispatchEvent(new Event("change"))
                }
            }

            renderSavedLocalPresets()
            updateSaveLocalPresetBtnState()
        })

        actionsContainer.appendChild(renameBtn)
        actionsContainer.appendChild(deleteBtn)
        item.appendChild(actionsContainer)

        item.addEventListener("click", async () => {
            setSelectedLocalPresetId(preset.id)
            if (localUrlInput) localUrlInput.value = preset.url
            if (localModelInput) localModelInput.value = preset.model

            const localKeyInput = document.getElementById("byok-local-input")
            if (localKeyInput) {
                localKeyInput.value = preset.maskedKey || (preset.encryptedKey ? "Saved Key" : "")
            }

            // Sync storage for local byok fields immediately
            await api.storage.sync.set({
                yomi_byok_local_url: preset.url,
                yomi_byok_local_model: preset.model,
                yomi_byok_local: preset.encryptedKey || "",
                yomi_byok_local_masked: preset.maskedKey || ""
            })

            validateLocalModelInput()
            const enabledResult = await api.storage.sync.get({ yomi_byok_local_enabled: true })
            if (enabledResult["yomi_byok_local_enabled"] !== false) {
                autoSelectLocalModel()
            }
            await refreshBYOKProviderVisualState("local")
            updateModelSelectDropdown()
            updateSaveLocalPresetBtnState()
            toggleSavedLocalPresetsDropdown(false)
        })

        savedLocalPresetsList.appendChild(item)
    })

    repositionOpenDropdown(savedLocalPresetsContainer || savedLocalPresetsTrigger, savedLocalPresetsList, 6)
}

// The url/model/key trio both buttons write, read once from the fields and sync storage.
async function readLocalPresetFields() {
    const url = localUrlInput ? localUrlInput.value.trim() : ""
    const model = localModelInput ? localModelInput.value.trim() : ""
    if (!url || !model) return null

    const storageResult = await api.storage.sync.get({
        yomi_byok_local: "",
        yomi_byok_local_masked: ""
    })
    return {
        url,
        model,
        encryptedKey: storageResult.yomi_byok_local || "",
        maskedKey: storageResult.yomi_byok_local_masked || ""
    }
}

if (addLocalPresetBtn) {
    addLocalPresetBtn.addEventListener("click", async () => {
        const fields = await readLocalPresetFields()
        if (!fields) return

        const saved = await getSavedLocalPresets()
        const isDuplicate = saved.some(p =>
            p.url === fields.url &&
            p.model === fields.model &&
            (p.encryptedKey || "") === fields.encryptedKey
        )
        if (isDuplicate) return

        const newPreset = {
            id: generateLocalPresetId(),
            name: fields.model,
            url: fields.url,
            model: fields.model,
            encryptedKey: fields.encryptedKey,
            maskedKey: fields.maskedKey
        }
        saved.push(newPreset)
        saveSavedLocalPresets(saved)
        setSelectedLocalPresetId(newPreset.id)
        renderSavedLocalPresets()
        updateSaveLocalPresetBtnState()
    })
}

if (saveLocalPresetBtn) {
    saveLocalPresetBtn.addEventListener("click", async () => {
        const fields = await readLocalPresetFields()
        if (!fields || !selectedLocalPresetId) return

        const saved = await getSavedLocalPresets()
        const existing = saved.find(p => p.id === selectedLocalPresetId)
        if (!existing) {
            // Deleted from another device while it was selected.
            setSelectedLocalPresetId(null)
            renderSavedLocalPresets()
            updateSaveLocalPresetBtnState()
            return
        }

        // Renaming is the only thing that gives a preset a name of its own; every other name is
        // the model it was added with, and goes stale the moment the model changes. Checked
        // against the OLD value, before it is overwritten below.
        const hadCustomName = !!existing.name && existing.name !== existing.model

        existing.url = fields.url
        existing.model = fields.model
        existing.encryptedKey = fields.encryptedKey
        existing.maskedKey = fields.maskedKey
        if (!hadCustomName) existing.name = fields.model
        saveSavedLocalPresets(saved)
        renderSavedLocalPresets()
        updateSaveLocalPresetBtnState()
    })
}

if (clearLocalPresetBtn) {
    clearLocalPresetBtn.addEventListener("click", () => {
        setSelectedLocalPresetId(null)
        if (localUrlInput) {
            localUrlInput.value = ""
            localUrlInput.dispatchEvent(new Event("change"))
        }
        if (localModelInput) {
            localModelInput.value = ""
            localModelInput.dispatchEvent(new Event("change"))
        }
        const localKeyInput = document.getElementById("byok-local-input")
        if (localKeyInput) {
            localKeyInput.value = ""
            localKeyInput.dispatchEvent(new Event("change"))
        }
    })
}

let customPromptSaveTimeout = null
customPromptInput.addEventListener("input", (e) => {
    try {
        const value = e.target.value
        const currentLength = value.length
        customPromptCounter.textContent = `${currentLength}/1000`
        updateSavePromptBtnState()

        // Debounce storage save
        if (customPromptSaveTimeout) clearTimeout(customPromptSaveTimeout)
        customPromptSaveTimeout = setTimeout(() => {
            api.storage.sync.set({ yomi_custom_prompt: value })
        }, 500)
    } catch (err) {
        sendError(err, "customPromptInput input")
    }
})

// --- Saved Custom Prompts ---
const savedPromptsTrigger = document.getElementById("saved-prompts-trigger")
const savedPromptsTriggerText = document.getElementById("saved-prompts-trigger-text")
const savedPromptsList = document.getElementById("saved-prompts-list")
const savedPromptsArrow = document.getElementById("saved-prompts-arrow")
const clearPromptBtn = document.getElementById("clear-prompt-btn")
const addPromptBtn = document.getElementById("add-prompt-btn")

// Currently selected saved prompt (null = "Add new prompt ..." / creating a fresh one).
// Persisted (loaded during initialize(), see yomi_selected_prompt_id below) so the
// selection survives closing and reopening the popup, same as on the website.
let selectedPromptId = null

function setSelectedPromptId(id) {
    selectedPromptId = id
    api.storage.sync.set({ yomi_selected_prompt_id: id })
}

function generatePromptId() {
    return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

function getSavedPrompts() {
    return new Promise((resolve) => {
        api.storage.sync.get({ yomi_saved_prompts: [] }, (result) => {
            resolve(result.yomi_saved_prompts || [])
        })
    })
}

function saveSavedPrompts(prompts) {
    api.storage.sync.set({ yomi_saved_prompts: prompts })
}

function toggleSavedPromptsDropdown(show) {
    if (!savedPromptsList || !savedPromptsTrigger) return
    const isHidden = savedPromptsList.classList.contains("hidden")
    const shouldShow = show !== undefined ? show : isHidden

    if (shouldShow) {
        renderSavedPrompts()
        positionFloatingDropdown(savedPromptsContainer || savedPromptsTrigger, savedPromptsList, 6)
        // After positioning, so the list's final max-height is what we scroll within.
        scrollDropdownToSelected(savedPromptsList, { center: true })
        if (savedPromptsArrow) savedPromptsArrow.classList.add("rotate-180")
    } else {
        savedPromptsList.classList.add("hidden")
        if (savedPromptsArrow) savedPromptsArrow.classList.remove("rotate-180")
    }
}

if (savedPromptsTrigger) {
    savedPromptsTrigger.addEventListener("click", () => {
        toggleSavedPromptsDropdown()
    })
}

// No typeahead counterpart here - this list isn't backed by a <select> - but the arrow
// keys work off the rendered rows, so it gets keyboard navigation like the rest.
setupDropdownArrowKeys(savedPromptsTrigger, savedPromptsList, toggleSavedPromptsDropdown)

document.addEventListener("click", (e) => {
    if (savedPromptsList && !savedPromptsList.classList.contains("hidden")) {
        if (savedPromptsContainer && !savedPromptsContainer.contains(e.target) && !savedPromptsList.contains(e.target)) {
            toggleSavedPromptsDropdown(false)
        }
    }
})

window.addEventListener("scroll", (e) => {
    if (savedPromptsList && savedPromptsList.contains(e.target)) {
        return
    }
    toggleSavedPromptsDropdown(false)
}, true)

async function updateSavePromptBtnState() {
    const promptText = customPromptInput.value.trim()
    const saved = await getSavedPrompts()
    let selectedPrompt = selectedPromptId ? saved.find(p => p.id === selectedPromptId) : null
    if (selectedPromptId && !selectedPrompt) {
        // The selected prompt was deleted elsewhere (e.g. another device) - fall back to "Add" mode
        setSelectedPromptId(null)
    }

    if (savedPromptsTriggerText) {
        savedPromptsTriggerText.innerText = selectedPrompt ? (selectedPrompt.name || selectedPrompt.text) : "Add new prompt ..."
    }
    if (clearPromptBtn) {
        clearPromptBtn.disabled = !promptText
    }

    if (!promptText) {
        if (addPromptBtn) addPromptBtn.disabled = true
        savePromptBtn.disabled = true
        if (customPromptStatus) hide(customPromptStatus)
        return
    }

    if (customPromptStatus) unhide(customPromptStatus)

    // Add only ever creates, so a selected prompt no longer blocks it - only an exact duplicate
    // does. Save only ever overwrites the selected one.
    if (addPromptBtn) addPromptBtn.disabled = saved.some(p => p.text === promptText)
    savePromptBtn.disabled = !selectedPrompt || selectedPrompt.text === promptText
}

let renamingPromptIndex = -1

async function renderSavedPrompts() {
    const prompts = await getSavedPrompts()

    if (!savedPromptsList) return
    savedPromptsList.innerHTML = ""

    const addNewItem = document.createElement("div")
    addNewItem.className = "flex items-center px-3 py-1.5 cursor-pointer text-neutral-800 dark:text-neutral-100 italic transition-colors min-w-0 hover:bg-neutral-200 dark:hover:bg-neutral-700"
    if (prompts.length > 0) {
        addNewItem.classList.add("border-b", "border-neutral-300", "dark:border-neutral-700")
    }
    if (selectedPromptId === null) {
        markDropdownItemSelected(addNewItem)
        addNewItem.classList.add("not-italic")
    }
    addNewItem.innerText = "Add new prompt ..."
    addNewItem.addEventListener("click", () => {
        setSelectedPromptId(null)
        customPromptInput.value = ""
        customPromptInput.dispatchEvent(new Event("input", { bubbles: true }))
        toggleSavedPromptsDropdown(false)
    })
    savedPromptsList.appendChild(addNewItem)

    prompts.forEach((prompt, index) => {
        const displayName = prompt.name || prompt.text
        const isRenaming = index === renamingPromptIndex
        const isSelected = prompt.id === selectedPromptId

        const item = document.createElement("div")
        item.className = "flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-100 transition-colors min-w-0"
        item.classList.toggle("cursor-pointer", !isRenaming)
        if (isSelected && !isRenaming) {
            markDropdownItemSelected(item)
        }

        if (isRenaming) {
            const nameInput = document.createElement("input")
            nameInput.type = "text"
            nameInput.value = displayName
            nameInput.className = "flex-grow min-w-0 text-sm bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 border border-cyan-600 rounded px-1.5 py-0.5 focus:outline-none"

            const commitRename = () => {
                nameInput.removeEventListener("blur", commitRename)
                const newName = nameInput.value.trim()
                renamingPromptIndex = -1
                getSavedPrompts().then(saved => {
                    const target = saved.find(p => p.id === prompt.id)
                    if (target && newName && newName !== displayName) {
                        target.name = newName
                        saveSavedPrompts(saved)
                    }
                    renderSavedPrompts()
                    updateSavePromptBtnState()
                })
            }

            nameInput.addEventListener("click", (e) => e.stopPropagation())
            nameInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault()
                    commitRename()
                } else if (e.key === "Escape") {
                    e.preventDefault()
                    nameInput.removeEventListener("blur", commitRename)
                    renamingPromptIndex = -1
                    renderSavedPrompts()
                }
            })
            nameInput.addEventListener("blur", commitRename)

            item.appendChild(nameInput)
            savedPromptsList.appendChild(item)
            nameInput.focus()
            nameInput.select()
            return
        }

        const textSpan = document.createElement("span")
        textSpan.className = "flex-grow select-none pr-2 text-sm truncate max-w-56"
        textSpan.innerText = displayName
        item.appendChild(textSpan)

        const actionsContainer = document.createElement("div")
        actionsContainer.className = "flex items-center gap-1 shrink-0"

        const renameBtn = document.createElement("button")
        renameBtn.type = "button"
        renameBtn.className = "rename-prompt-btn p-1 hover:bg-neutral-300 dark:hover:bg-neutral-600 text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100 rounded transition-colors focus:outline-none shrink-0 cursor-pointer"
        renameBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M15.7279 9.57627L14.3137 8.16206L5 17.4758V18.89H6.41421L15.7279 9.57627ZM17.1421 8.16206L18.5563 6.74785L17.1421 5.33363L15.7279 6.74785L17.1421 8.16206ZM7.24264 20.89H3V16.6474L16.435 3.21233C16.8256 2.8218 17.4587 2.8218 17.8492 3.21233L20.6777 6.04074C21.0682 6.43126 21.0682 7.06443 20.6777 7.45495L7.24264 20.89Z"></path></svg>`
        renameBtn.dataset.tooltipTitle = "Rename prompt"
        renameBtn.setAttribute("aria-label", "Rename prompt")

        renameBtn.addEventListener("click", (e) => {
            e.stopPropagation()
            renamingPromptIndex = index
            renderSavedPrompts()
        })

        const deleteBtn = document.createElement("button")
        deleteBtn.type = "button"
        deleteBtn.className = "delete-prompt-btn p-1 hover:bg-red-50 text-neutral-400 hover:text-red-500 rounded transition-colors focus:outline-none shrink-0 cursor-pointer"
        deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17 6H22V8H20V21C20 21.5523 19.5523 22 19 22H5C4.44772 22 4 21.5523 4 21V8H2V6H7V4C7 3.44772 7.44772 3 8 3H16C16.5523 3 17 3.44772 17 4V6ZM15 6V5H9V6H15ZM6 8V20H18V8H6ZM9 11H11V17H9V11ZM13 11H15V17H13V11Z"></path></svg>`
        deleteBtn.dataset.tooltipTitle = "Delete prompt"
        deleteBtn.setAttribute("aria-label", "Delete prompt")

        deleteBtn.addEventListener("click", async (e) => {
            e.stopPropagation()
            const saved = await getSavedPrompts()
            const filtered = saved.filter(p => p.id !== prompt.id)
            saveSavedPrompts(filtered)

            if (isSelected) {
                setSelectedPromptId(null)
                customPromptInput.value = ""
                customPromptInput.dispatchEvent(new Event("input", { bubbles: true }))
            }

            renderSavedPrompts()
            updateSavePromptBtnState()
        })

        actionsContainer.appendChild(renameBtn)
        actionsContainer.appendChild(deleteBtn)
        item.appendChild(actionsContainer)

        item.addEventListener("click", () => {
            setSelectedPromptId(prompt.id)
            customPromptInput.value = prompt.text
            customPromptInput.dispatchEvent(new Event("input", { bubbles: true }))
            toggleSavedPromptsDropdown(false)
        })

        savedPromptsList.appendChild(item)
    })

    repositionOpenDropdown(savedPromptsContainer || savedPromptsTrigger, savedPromptsList, 6)
}

if (addPromptBtn) {
    addPromptBtn.addEventListener("click", async () => {
        const promptText = customPromptInput.value.trim()
        if (!promptText) return

        const saved = await getSavedPrompts()
        if (saved.some(p => p.text === promptText)) return

        const newPrompt = { id: generatePromptId(), text: promptText, name: promptText }
        saved.push(newPrompt)
        saveSavedPrompts(saved)
        setSelectedPromptId(newPrompt.id)
        renderSavedPrompts()
        updateSavePromptBtnState()
    })
}

savePromptBtn.addEventListener("click", async () => {
    const promptText = customPromptInput.value.trim()
    if (!promptText || !selectedPromptId) return

    const saved = await getSavedPrompts()
    const existing = saved.find(p => p.id === selectedPromptId)
    if (!existing) {
        // Deleted from another device while it was selected.
        setSelectedPromptId(null)
        renderSavedPrompts()
        updateSavePromptBtnState()
        return
    }

    // Renaming is the only thing that gives a prompt a name of its own; every other name is the
    // text it was added with, and goes stale the moment the text is edited.
    const hadCustomName = !!existing.name && existing.name !== existing.text

    existing.text = promptText
    if (!hadCustomName) existing.name = promptText
    saveSavedPrompts(saved)
    renderSavedPrompts()
    updateSavePromptBtnState()
})

if (clearPromptBtn) {
    clearPromptBtn.addEventListener("click", () => {
        setSelectedPromptId(null)
        customPromptInput.value = ""
        customPromptInput.dispatchEvent(new Event("input", { bubbles: true }))
    })
}

// --- Source Language Whitelist ---
// Loaded from api.storage.sync during initialize() (see yomi_source_langs_whitelist).
let whitelistedSourceLangs = []

const sourceLangSelect = document.getElementById("source-lang-select")
const sourceLangSelectBox = document.getElementById("source-lang-select-box")
const sourceLangDropdownTrigger = document.getElementById("source-lang-dropdown-trigger")
const sourceLangDropdownList = document.getElementById("source-lang-dropdown-list")
const sourceLangDropdownArrow = document.getElementById("source-lang-dropdown-arrow")
const sourceLangDropdownSelectedText = document.getElementById("source-lang-dropdown-selected-text")
const selectedSourceLangsList = document.getElementById("selected-source-langs-list")
const selectedSourceLangsWrapper = document.getElementById("selected-source-langs-wrapper")
const sourceLangStatus = document.getElementById("source-langs-status")

// The server's language detector (cld2) can't recognise these, so a whitelist entry would never match.
const UNDETECTABLE_SOURCE_LANGS = new Set(["bm", "ilo", "lus", "doi", "gom", "ckb", "pa-arab", "azb", "ff", "ber-latn", "hil", "ki", "mos", "sat", "mni", "brx"])

if (sourceLangSelect) {
    for (const [key, value] of languagesByName) {
        if (UNDETECTABLE_SOURCE_LANGS.has(key)) continue
        const option = document.createElement("option")
        option.value = key
        option.text = value
        sourceLangSelect.appendChild(option)
    }

    sourceLangSelect.addEventListener("change", () => {
        const code = sourceLangSelect.value
        if (code) {
            addSourceLangToWhitelist(code)
            sourceLangSelect.value = ""
        }
        syncSourceLangDropdownToSelect()
    })
}

function syncSourceLangDropdownToSelect() {
    if (!sourceLangDropdownSelectedText || !sourceLangSelect) return
    const selectedOpt = sourceLangSelect.options[sourceLangSelect.selectedIndex]
    sourceLangDropdownSelectedText.innerText = selectedOpt ? selectedOpt.text : "Add language..."
}

function toggleSourceLangDropdown(show) {
    if (!sourceLangDropdownList || !sourceLangDropdownTrigger) return
    const isHidden = sourceLangDropdownList.classList.contains("hidden")
    const shouldShow = show !== undefined ? show : isHidden

    if (shouldShow) {
        updateSourceLangDropdownList()
        positionFloatingDropdown(sourceLangSelectBox || sourceLangDropdownTrigger, sourceLangDropdownList, 6)
        if (sourceLangDropdownArrow) sourceLangDropdownArrow.classList.add("rotate-180")
    } else {
        sourceLangDropdownList.classList.add("hidden")
        if (sourceLangDropdownArrow) sourceLangDropdownArrow.classList.remove("rotate-180")
    }
}

if (sourceLangSelectBox) {
    sourceLangSelectBox.addEventListener("click", () => {
        toggleSourceLangDropdown()
    })
}

document.addEventListener("click", (e) => {
    if (sourceLangDropdownList && !sourceLangDropdownList.classList.contains("hidden")) {
        if (sourceLangSelectBox && !sourceLangSelectBox.contains(e.target) && !sourceLangDropdownList.contains(e.target)) {
            toggleSourceLangDropdown(false)
        }
    }
})

window.addEventListener("scroll", (e) => {
    if (sourceLangDropdownList && sourceLangDropdownList.contains(e.target)) {
        return
    }
    toggleSourceLangDropdown(false)
}, true)

function updateSourceLangDropdownList() {
    if (!sourceLangDropdownList || !sourceLangSelect) return
    sourceLangDropdownList.innerHTML = ""

    Array.from(sourceLangSelect.options).forEach(opt => {
        if (!opt.value) return

        const item = document.createElement("div")
        item.className = "flex items-center px-3 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 cursor-pointer text-neutral-800 dark:text-neutral-100 transition-colors min-w-0"

        if (opt.disabled) {
            item.classList.add("opacity-40", "cursor-not-allowed")
            item.classList.remove("cursor-pointer", "hover:bg-neutral-200", "dark:hover:bg-neutral-700")
            item.setAttribute("data-tooltip-desc", "Already in the whitelist")
            item.setAttribute("data-tooltip-direction", "right")
        }

        const textSpan = document.createElement("span")
        textSpan.className = "flex-grow select-none pr-4 text-base truncate"
        textSpan.innerText = opt.text
        item.appendChild(textSpan)

        if (!opt.disabled) {
            item.addEventListener("click", () => {
                sourceLangSelect.value = opt.value
                sourceLangSelect.dispatchEvent(new Event("change"))
                toggleSourceLangDropdown(false)
            })
        }

        sourceLangDropdownList.appendChild(item)
    })
}

setupDropdownTypeahead(sourceLangDropdownTrigger, sourceLangDropdownList, sourceLangSelect, {
    // No selected-row marker here on purpose: picking a language commits it to the
    // whitelist and resets the select back to its placeholder, so there is never a
    // standing selection to scroll to. This still keeps the reader's place across
    // the rebuild that repaints the now-disabled rows.
    onMatch: () => refreshOpenDropdown(sourceLangDropdownList, updateSourceLangDropdownList)
})

setupDropdownArrowKeys(sourceLangDropdownTrigger, sourceLangDropdownList, toggleSourceLangDropdown)

function renderSourceLangsWhitelist() {
    if (!selectedSourceLangsList) return

    selectedSourceLangsList.innerHTML = ""

    if (sourceLangSelect) {
        Array.from(sourceLangSelect.options).forEach(option => {
            if (option.value) {
                option.disabled = whitelistedSourceLangs.includes(option.value)
            }
        })
    }

    if (whitelistedSourceLangs.length === 0) {
        const placeholder = document.createElement("div")
        placeholder.className = "text-[0.8rem] text-neutral-400 italic py-2 text-center w-full"
        placeholder.textContent = "All source languages translated"
        selectedSourceLangsList.appendChild(placeholder)
        if (sourceLangStatus) hide(sourceLangStatus)
        if (selectedSourceLangsWrapper) hide(selectedSourceLangsWrapper)
        return
    }

    if (sourceLangStatus) unhide(sourceLangStatus)
    if (selectedSourceLangsWrapper) unhide(selectedSourceLangsWrapper)

    whitelistedSourceLangs.forEach(code => {
        const langName = languages[code] || code
        const item = document.createElement("div")
        item.className = "flex items-center cursor-pointer gap-1 bg-white dark:bg-neutral-900 border border-neutral-400 dark:border-neutral-500 rounded-full py-0.5 px-2.5 text-[0.7rem] text-neutral-800 dark:text-neutral-100 shadow-sm hover:shadow-xs transition-all w-max select-none"
        item.addEventListener("click", (e) => {
            e.stopPropagation()
            removeSourceLangFromWhitelist(code)
        })

        const nameSpan = document.createElement("span")
        nameSpan.className = "truncate max-w-32"
        nameSpan.textContent = langName

        const removeBtn = document.createElement("button")
        removeBtn.className = "text-red-500 hover:text-red-700 font-bold px-0.5 cursor-pointer focus:outline-none"
        removeBtn.textContent = "×"
        removeBtn.dataset.tooltipTitle = `Remove ${langName}`
        removeBtn.setAttribute("aria-label", `Remove ${langName}`)

        item.appendChild(nameSpan)
        item.appendChild(removeBtn)
        selectedSourceLangsList.appendChild(item)
    })
}

function addSourceLangToWhitelist(code) {
    if (!code) return
    if (!whitelistedSourceLangs.includes(code)) {
        whitelistedSourceLangs.push(code)
        api.storage.sync.set({ yomi_source_langs_whitelist: whitelistedSourceLangs })
        renderSourceLangsWhitelist()
    }
}

function removeSourceLangFromWhitelist(code) {
    whitelistedSourceLangs = whitelistedSourceLangs.filter(c => c !== code)
    api.storage.sync.set({ yomi_source_langs_whitelist: whitelistedSourceLangs })
    renderSourceLangsWhitelist()
}

const toggleSourceLangsBtn = document.getElementById("toggle-source-langs")
const sourceLangsBody = document.getElementById("source-langs-body")
if (toggleSourceLangsBtn) {
    toggleSourceLangsBtn.addEventListener("click", () => {
        toggleAccordion(toggleSourceLangsBtn, sourceLangsBody)
    })
}

enabled.addEventListener("change", (event) => {
    try {
        api.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
            try {
                api.storage.sync.set({ ["yomi_" + tabs[0].url.split("/")[2]]: enabled.checked })
            } catch (err) {
                sendError(err, "enabled listener callback")
            }
        })
    } catch (e) {
        sendError(e, "enabled listener")
    }
})

document.getElementById("updates").addEventListener("click", (event) => {
    try {
        api.runtime.sendMessage({ type: "update_seen" }, (response) => {
            try {
                if (response && response.success) {
                    api.storage.sync.set({ yomi_new_version: false })
                }
            } catch (err) {
                sendError(err, "update_seen callback")
            }
        })
    } catch (e) {
        sendError(e, "updates click")
    }
})


function showExtension(response) {
    content.classList.replace("hidden", "flex")
    header.classList.replace("hidden", "flex")
    footer.classList.replace("hidden", "flex")

    const subscriptions_status = response.content.subscription?.status

    let totalCredits = response.content.credits
    if (subscriptions_status) totalCredits += response.content.subscription.credits

    credits.innerHTML = formatCredits(totalCredits)
    account = { plan: response.content.plan, balance: totalCredits }

    const profileEl = document.getElementById("profile")
    if (profileEl) profileEl.classList.replace("hidden", "flex")

    const profileImage = document.getElementById("profile-image")
    if (profileImage && response.content.photoURL) {
        profileImage.src = response.content.photoURL
    }

    // The shared markup points Rate at the Chrome Web Store; the other two builds each
    // ship to a storefront of their own, so send it there instead.
    const ratingLink = document.getElementById("rating")
    if (ratingLink) {
        if (isSafari()) ratingLink.href = "https://apps.apple.com/us/app/yomi-image-translator/id6780277628"
        else if (isFirefox()) ratingLink.href = "https://addons.mozilla.org/en-US/firefox/addon/yomi-image-translator/"
    }
}

function formatCredits(credits) {
    return credits.toFixed(0)
}

function setEnabled(checked) {
    enabled.checked = checked
}

function setDefaultEnabled(checked) {
    defaultEnabled.checked = checked
}

// One selected state for the whole app, kept identical to translate.js and content.js. The rest
// style belongs to the surface, so callers pass theirs; every string must match the markup
// verbatim, or toggle(cls, false) silently leaves the rest style behind and it ties with the
// active fill.
const STATE_BTN_ACTIVE = ["bg-cyan-300/60", "dark:bg-cyan-600/60", "text-neutral-900", "dark:text-white"]
const STATE_BTN_REST_PANEL = ["bg-white", "dark:bg-neutral-900/50", "hover:bg-neutral-50", "dark:hover:bg-neutral-900", "text-neutral-800", "dark:text-neutral-200"]
const STATE_BTN_REST_SEGMENT = ["text-neutral-600", "dark:text-neutral-300", "hover:bg-neutral-200/50", "dark:hover:bg-neutral-700/50"]

function setStateBtnActive(btn, isEnabled, restClasses) {
    if (!btn) return
    restClasses.forEach(c => btn.classList.toggle(c, !isEnabled))
    STATE_BTN_ACTIVE.forEach(c => btn.classList.toggle(c, isEnabled))
}

// A well child: the well paints the rest fill, so only text and hover are swapped.
function setSegmentActive(btn, isActive) {
    setStateBtnActive(btn, isActive, STATE_BTN_REST_SEGMENT)
}

// "Disable Stroke" is an inverted toggle relative to the stored yomi_stroke_enabled flag -
// the button should read as pressed/active when stroke is OFF, not when it's on.
function updateStrokeBtnState(checked) {
    setStateBtnActive(textStroke, !checked, STATE_BTN_REST_PANEL)
}

function setStrokeEnabled(checked) {
    updateStrokeBtnState(checked)
}

function updateBubblesOnlyBtnState(checked) {
    setStateBtnActive(bubblesOnly, checked, STATE_BTN_REST_PANEL)
}

function setBubblesOnly(checked) {
    updateBubblesOnlyBtnState(checked)
}

function updateContextSharingBtnState(checked) {
    setStateBtnActive(contextSharing, checked, STATE_BTN_REST_PANEL)
}

function setContextSharing(checked) {
    updateContextSharingBtnState(checked)
}

function setAutocache(checked) {
    autocache.checked = checked
}

function setYomiLocation(location) {
    setSegmentActive(yomiTL, location === "tl")
    setSegmentActive(yomiTR, location === "tr")
}

function setTargetLanguage(language) {
    languageSelect.value = language
}

function setMinFontSize(fontSize) {
    applyMinFontSize(parseFloat(fontSize))
}

function setMinImageSize(size) {
    if (minImageSizeInput) {
        minImageSizeInput.value = size
    }
    if (minImageSizeValue) {
        minImageSizeValue.textContent = size + "px"
    }
}

autoSaveToggle.addEventListener("change", (e) => {
    try {
        if (e.target.checked) {
            api.permissions.request({
                permissions: ['downloads']
            }, (granted) => {
                try {
                    if (granted) {
                        api.storage.sync.set({ yomi_auto_save: true })
                    } else {
                        e.target.checked = false
                        api.storage.sync.set({ yomi_auto_save: false })
                    }
                } catch (err) {
                    sendError(err, "permissions.request callback")
                }
            })
        } else {
            api.storage.sync.set({ yomi_auto_save: false })
            api.permissions.remove({
                permissions: ['downloads']
            }, (removed) => {
                try {
                    if (removed) {
                        console.log("Downloads permission removed")
                    }
                } catch (err) {
                    sendError(err, "permissions.remove callback")
                }
            })
        }
    } catch (err) {
        sendError(err, "autoSaveToggle change")
    }
})

autoSaveFolderInput.addEventListener("change", (e) => {
    try {
        let value = e.target.value.trim()
        // Remove leading/trailing slashes and illegal characters
        value = value.replace(/^\/+|\/+$/g, '').replace(/[<>:"|?*]/g, '')

        if (value.length === 0) {
            value = "YomiTranslations"
        }

        e.target.value = value
        api.storage.sync.set({ yomi_auto_save_folder: value })
    } catch (err) {
        sendError(err, "autoSaveFolderInput change")
    }
})

function setTextAlignment(alignment) {
    Object.entries(textAlignmentButtons).forEach(([key, btn]) => {
        setSegmentActive(btn, key === alignment)
    })
}

function setFont(font) {
    fontSelect.value = font
}

function toggleUpdateBadges(beenUpdated) {
    const badges = document.getElementsByClassName("update-badge")

    if (beenUpdated) {
        for (const badge of badges) {
            badge.classList.replace("hidden", "flex")
        }
    } else {
        for (const badge of badges) {
            badge.classList.replace("flex", "hidden")
        }
    }
}

function initialize() {
    api.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        try {
            let stored_url = "yomi_extension"
            try {
                stored_url = "yomi_" + tabs[0].url.split("/")[2]
            } catch (error) {
                console.log("Focused window is extension.")
            }

            api.storage.sync.get(
                {
                    [stored_url]: "na",
                    yomi_default_enabled: true,
                    translation_model: "gemini-3.1-flash-lite",
                    yomi_target_lang: "en",
                    yomi_new_version: false,
                    yomi_font: "wildwords",
                    yomi_stroke_enabled: true,
                    yomi_bubbles_only: false,
                    yomi_context_sharing: false,
                    yomi_location: "tl",
                    yomi_custom_prompt: "",
                    yomi_selected_prompt_id: null,
                    yomi_source_langs_whitelist: [],
                    yomi_min_font_size: 6,
                    yomi_reasoning_effort: "none",
                    yomi_inpaint_multiplier: 1,
                    yomi_text_alignment: "auto",
                    autocache: false,
                    yomi_min_image_size: 200,
                    yomi_auto_save_folder: "YomiTranslations",
                    yomi_byok_openrouter: "",
                    yomi_byok_openrouter_masked: "",
                    yomi_byok_openrouter_enabled: true,
                    yomi_byok_google: "",
                    yomi_byok_google_masked: "",
                    yomi_byok_google_enabled: true,
                    yomi_byok_openai: "",
                    yomi_byok_openai_masked: "",
                    yomi_byok_openai_enabled: true,
                    yomi_byok_anthropic: "",
                    yomi_byok_anthropic_masked: "",
                    yomi_byok_anthropic_enabled: true,
                    yomi_byok_deepseek: "",
                    yomi_byok_deepseek_masked: "",
                    yomi_byok_deepseek_enabled: true,
                    yomi_byok_xai: "",
                    yomi_byok_xai_masked: "",
                    yomi_byok_xai_enabled: true,
                    yomi_byok_local: "",
                    yomi_byok_local_masked: "",
                    yomi_byok_local_url: "",
                    yomi_byok_local_model: "",
                    yomi_byok_local_enabled: true,
                    yomi_saved_byok_local_presets: [],
                    yomi_selected_byok_local_preset_id: null,
                    yomi_min_font_size_reset_v3: false
                },
                (result) => {
                    try {
                        if (!result["yomi_min_font_size_reset_v3"]) {
                            api.storage.sync.set({ yomi_min_font_size: 6 })
                            api.storage.sync.set({ yomi_min_font_size_reset_v3: true })
                            result["yomi_min_font_size"] = 6
                        }

                        setPage("home")
                        // Populate self-hosted input fields first so they can be validated and used for dropdown setup
                        const localUrlInputVal = document.getElementById("byok-local-url-input")
                        const localModelInputVal = document.getElementById("byok-local-model-input")
                        if (localUrlInputVal) {
                            localUrlInputVal.value = result["yomi_byok_local_url"] || ""
                        }
                        if (localModelInputVal) {
                            localModelInputVal.value = result["yomi_byok_local_model"] || ""
                        }
                        validateLocalModelInput();

                        updateModelSelectDropdown()
                        setTargetLanguage(result["yomi_target_lang"])
                        setMinFontSize(result["yomi_min_font_size"])

                        if (reasoningSelect && reasoningOptions.some(o => o.value === result["yomi_reasoning_effort"])) {
                            reasoningSelect.value = result["yomi_reasoning_effort"]
                            syncReasoningDropdownToSelect()
                        }
                        setInpaintMultiplier(result["yomi_inpaint_multiplier"])
                        setTextAlignment(result["yomi_text_alignment"])
                        setFont(result["yomi_font"])
                        switchToSupportedFontIfNeeded()
                        setContextSharing(result["yomi_context_sharing"])
                        setDefaultEnabled(result["yomi_default_enabled"])
                        setStrokeEnabled(result["yomi_stroke_enabled"])
                        setBubblesOnly(result["yomi_bubbles_only"])
                        setAutocache(result["autocache"])
                        setMinImageSize(result["yomi_min_image_size"])
                        setYomiLocation(result["yomi_location"])
                        toggleUpdateBadges(result["yomi_new_version"])

                        customPromptInput.value = result["yomi_custom_prompt"]
                        customPromptCounter.textContent = `${result["yomi_custom_prompt"].length}/1000`
                        selectedPromptId = result["yomi_selected_prompt_id"] || null

                        selectedLocalPresetId = result["yomi_selected_byok_local_preset_id"] || null

                        whitelistedSourceLangs = Array.isArray(result["yomi_source_langs_whitelist"]) ? result["yomi_source_langs_whitelist"] : []
                        renderSourceLangsWhitelist()
                        syncSourceLangDropdownToSelect()

                        byokProviders.forEach(provider => {
                            const input = document.getElementById(`byok-${provider}-input`)
                            if (input) {
                                const savedVal = result[`yomi_byok_${provider}`];
                                const maskedVal = result[`yomi_byok_${provider}_masked`];
                                input.value = savedVal ? (maskedVal || "Saved Key") : "";
                            }

                            const isEnabled = provider === "local"
                                ? result["yomi_byok_local_enabled"] !== false
                                : result[`yomi_byok_${provider}_enabled`] !== false;
                            const hasCredentials = provider === "local"
                                ? !!(result["yomi_byok_local_url"] || "").trim() && !!(result["yomi_byok_local_model"] || "").trim()
                                : !!result[`yomi_byok_${provider}`];
                            applyBYOKProviderVisualState(provider, isEnabled, hasCredentials);
                        })
                        updateByokStatusDot()

                        renderSavedPrompts()
                        updateSavePromptBtnState()

                        renderSavedLocalPresets()
                        updateSaveLocalPresetBtnState()

                        autoSaveFolderInput.value = result["yomi_auto_save_folder"]

                        if (result[stored_url] == "na") {
                            setEnabled(result["yomi_default_enabled"])
                        } else {
                            setEnabled(result[stored_url])
                        }
                    } catch (err) {
                        sendError(err, "initialize storage callback")
                    }
                }
            )
        } catch (err) {
            sendError(err, "initialize tabs callback")
        }
    })
}

function isMobile() {
    if (navigator?.userAgentData?.mobile) return true;
    const ua = navigator.userAgent;
    if (/Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(ua)) return true;
    if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return true;
    return false;
}

function isSafari() {
    const ua = navigator.userAgent.toLowerCase();
    return ua.includes('safari') && !ua.includes('chrome') && !ua.includes('chromium');
}

function isFirefox() {
    return navigator.userAgent.toLowerCase().includes('firefox');
}

function sendError(error, loc) {
    console.log("Send error: ", error)
    api.runtime.sendMessage({ type: "error", message: error?.message || error, stack: error?.stack || "nothing", loc: loc }).then((response) => {
        console.log("Send error response: ", response)
    }).catch((error) => {
        console.log("Send error error: ", error)
    })
}

function dataUrlToBlob(dataUrl) {
    const arr = dataUrl.split(',')
    const mime = arr[0].match(/:(.*?);/)[1]
    const bstr = atob(arr[1])
    let n = bstr.length
    const u8arr = new Uint8Array(n)
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n)
    }
    return new Blob([u8arr], { type: mime })
}