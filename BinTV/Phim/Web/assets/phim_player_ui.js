/* [Phim ANDROID 2026-09 v1.2.1] phim_player_ui.js - HUD player cho Android.
 *
 * Khac phuc theo yeu cau nguoi dung (khong thay doi logic goc cua app.js):
 *
 * 1) TU AN OVERLAY: ten phim + trang thai ("Dang phat", "Tam dung"...) khong
 *    con chom man hinh khi dang xem. HUD (overlay + timeline + nut tam dung)
 *    tu an sau 3.5s khi video dang phat; hien lai khi:
 *      - tam dung / dang buffer / loi phat (giu hien de thay trang thai)
 *      - nguoi dung tuong tac: phim bat ky tren TV (D-pad), cham man hinh
 *        tren dien thoai.
 *
 * 2) DIEN THOAI - CHAM NHANH = BAT/TAT HUD (khong con pause khi cham):
 *    Cham hien ten phim + nut "Tam dung" + timeline; cham lai de an.
 *    Nut tam dung that su pause/tiep tuc (mo phong phim OK nhu ban Windows
 *    de app.js cap nhat trang thai "Dang phat/Tam dung" day du).
 *
 * 3) DIEN THOAI - KEO TIMELINE DE TUA: cham giu va keo thanh trượt timeline,
 *    tha tay de tua den vi tri da chon (thay cho phai giu nua trai/phai
 *    man hinh). Chi cap nhat video.currentTime - dong ho phat cua app.js
 *    tu dong dong bo lai qua su kien ontimeupdate san co.
 *
 * 4) TU DONG XOAY NGANG KHI PHAT VIDEO (dien thoai): khi player mo -> goi
 *    AndroidBridge.setPlayerLandscape("1") -> MainActivity khoa SENSOR_LANDSCAPE
 *    (khong phai bat xoay man hinh he thong); khi dong player -> tra ve
 *    UNSPECIFIED (theo khoa xoay cua nguoi dung). Tren Android TV da khoa
 *    landscape tu onCreate nen MainActivity se bo qua.
 *
 * Cach ngan can xung dot voi app.js: nghe touch o GIAI DOAN CAPTURE tren
 * document (app.js dang ky tren phan tu player, chay sau) -> stopPropagation
 * chan su kien ha canh xuong player khi minh da xu ly (tap = HUD, keo =
 * tua). Cac cham vao nut/menu (interactive) duoc bo qua de click xu ly
 * binh thuong - giong hanh vi goc.
 */
(function () {
    "use strict";

    var HUD_HIDE_DELAY = 3500;
    var TOUCH_SLOP = 12;
    var TAP_MAX_MS = 600;
    var INTERACTIVE_SELECTOR = ".jvhd-quality-option, .movie-subtitle-option, .movie-player-episode-option, .movie-filter-menu-option, .movie-episode-button, button, a, input, select, textarea, #phim-phone-pause";

    var isPhone = /[?&]android=phone(?:&|$)/.test(window.location.search);

    var player = null;
    var video = null;
    var timeline = null;
    var track = null;
    var progress = null;
    var thumb = null;
    var pauseButton = null;

    var hudVisible = true;
    var hudHideTimer = null;
    var hudOwnedTimelineShow = false;
    var landscapeOn = false;

    var dragState = null;
    var tapTracker = null;

    // Phong tra "click lang thang" cho nut tam dung: khi cham vao giua man
    // hinh de mo HUD, nut vua xuat hien dung vi tri ngon tay -> click tong
    // hop (sinh sau touchend) co the roi trung nut -> pause oan. Chi chap
    // nhan click khi cham/ chuot BAT DAU tren chinh nut nay truoc do.
    var pauseArmTouchAt = 0;
    var pauseArmMouseAt = 0;
    var lastTouchEndAt = 0;
    var PAUSE_ARM_WINDOW_MS = 700;

    function getElement(id) { return document.getElementById(id); }

    function formatClock(seconds) {
        seconds = Math.max(0, Math.floor(Number(seconds) || 0));
        var h = Math.floor(seconds / 3600);
        var m = Math.floor((seconds % 3600) / 60);
        var s = seconds % 60;
        var mm = (m < 10 ? "0" : "") + m;
        var ss = (s < 10 ? "0" : "") + s;
        return h > 0 ? h + ":" + mm + ":" + ss : mm + ":" + ss;
    }

    function playerOpen() {
        return !!(player && player.classList.contains("show"));
    }

    function setHudVisible(visible, autoHide) {
        hudVisible = !!visible;
        if (!player) return;
        if (hudVisible) player.classList.remove("phim-hud-hidden");
        else player.classList.add("phim-hud-hidden");
        // Dien thoai: timeline di kem HUD
        if (hudVisible && isPhone && timeline && !timeline.classList.contains("show")) {
            timeline.classList.add("show");
            hudOwnedTimelineShow = true;
        }
        if (!hudVisible && hudOwnedTimelineShow && timeline) {
            timeline.classList.remove("show");
            hudOwnedTimelineShow = false;
        }
        if (hudHideTimer) { clearTimeout(hudHideTimer); hudHideTimer = null; }
        if (hudVisible && autoHide && video && !video.paused) {
            hudHideTimer = setTimeout(function () {
                hudHideTimer = null;
                if (playerOpen() && video && !video.paused) setHudVisible(false, false);
            }, HUD_HIDE_DELAY);
        }
    }

    function revealHud() {
        if (!playerOpen()) return;
        setHudVisible(true, true);
    }

    // ------------------------------------------------------------------
    // Cap nhat timeline theo vi tri phat (phone, khi HUD hien va khong keo)
    // ------------------------------------------------------------------
    function updateTimelineFromPlayback() {
        if (!video || !isFinite(video.duration) || video.duration <= 0) return;
        var fraction = Math.max(0, Math.min(1, video.currentTime / video.duration));
        if (progress) progress.style.width = (fraction * 100) + "%";
        if (thumb) thumb.style.left = (fraction * 100) + "%";
        var currentLabel = getElement("bintv-movie-seek-current");
        var targetLabel = getElement("bintv-movie-seek-target");
        if (currentLabel) currentLabel.textContent = formatClock(video.currentTime);
        if (targetLabel) targetLabel.textContent = formatClock(video.currentTime) + " / " + formatClock(video.duration);
    }

    // ------------------------------------------------------------------
    // Nut tam dung (phone)
    // ------------------------------------------------------------------
    function createPauseButton() {
        if (getElement("phim-phone-pause")) return;
        pauseButton = document.createElement("button");
        pauseButton.id = "phim-phone-pause";
        pauseButton.type = "button";
        pauseButton.setAttribute("aria-label", "Tạm dừng / Tiếp tục");
        pauseButton.textContent = "⏸";
        pauseButton.addEventListener("touchstart", function () {
            // Cham bat dau tren chinh nut -> cho phep xu ly click ke tiep
            pauseArmTouchAt = Date.now();
        }, { passive: true });
        pauseButton.addEventListener("pointerdown", function (event) {
            // Chuot that (USB/ Bluetooth): chi arm khi KHONG phai mouse event
            // tong hop sinh ra ngay sau touch (pointerType "mouse", gan touchend)
            try { if (event.pointerType && event.pointerType !== "mouse") return; } catch (typeError) {}
            if (Date.now() - lastTouchEndAt < 400) return;
            pauseArmMouseAt = Date.now();
        });
        pauseButton.addEventListener("click", function (event) {
            try { event.stopPropagation(); } catch (stopError) {}
            var now = Date.now();
            var armed = (pauseArmTouchAt && now - pauseArmTouchAt < PAUSE_ARM_WINDOW_MS)
                     || (pauseArmMouseAt && now - pauseArmMouseAt < PAUSE_ARM_WINDOW_MS);
            pauseArmTouchAt = 0;
            pauseArmMouseAt = 0;
            if (!armed) {
                // Click khong duoc cham truoc tren nut (VD: nut vua hien ra duoi
                // ngon tay da cham de mo HUD) -> bo qua, khong pause oan.
                return;
            }
            // Mo phong phim OK (Enter) - app.js toggleMoviePlayback() se
            // pause/play + cap nhat trang thai "Đang phát/Tạm dừng" + dong ho
            try {
                window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
                window.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
            } catch (dispatchError) {}
            // Dang pause -> giu HUD hien; dang phay -> tu an sau 3.5s
            setHudVisible(true, true);
            refreshPauseIcon();
        });
        player.appendChild(pauseButton);
    }

    function refreshPauseIcon() {
        if (!pauseButton || !video) return;
        pauseButton.textContent = video.paused ? "▶" : "⏸";
    }

    // ------------------------------------------------------------------
    // Keo timeline de tua (phone)
    // ------------------------------------------------------------------
    function timelineFractionFromTouch(touch) {
        if (!track) return 0;
        try {
            var rect = track.getBoundingClientRect();
            if (!rect.width) return 0;
            return Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
        } catch (rectError) { return 0; }
    }

    function applyDragPreview(fraction) {
        if (!video || !isFinite(video.duration) || video.duration <= 0) return;
        var target = fraction * video.duration;
        if (progress) progress.style.width = (fraction * 100) + "%";
        if (thumb) thumb.style.left = (fraction * 100) + "%";
        var currentLabel = getElement("bintv-movie-seek-current");
        var targetLabel = getElement("bintv-movie-seek-target");
        var durationLabel = getElement("bintv-movie-seek-duration");
        if (currentLabel) currentLabel.textContent = formatClock(target);
        if (targetLabel) targetLabel.textContent = formatClock(target) + " / " + formatClock(video.duration);
        if (durationLabel) durationLabel.textContent = target > video.currentTime ? "Tua tiến" : (target < video.currentTime ? "Tua lùi" : "Chọn vị trí");
    }

    function finishDragSeek(fraction) {
        if (!video || !isFinite(video.duration) || video.duration <= 0) return;
        var target = Math.max(0, Math.min(video.duration - 0.25, fraction * video.duration));
        try { video.currentTime = target; } catch (seekError) {}
    }

    // ------------------------------------------------------------------
    // Phan loai muc cham
    // ------------------------------------------------------------------
    function isInteractiveTarget(target) {
        try { return !!(target && target.closest && target.closest(INTERACTIVE_SELECTOR)); } catch (e) { return false; }
    }

    function anyMenuOpen() {
        var subtitleMenu = getElement("bintv-movie-subtitle-menu");
        var episodeMenu = getElement("bintv-movie-player-episodes");
        return !!((subtitleMenu && subtitleMenu.classList.contains("show"))
            || (episodeMenu && episodeMenu.classList.contains("show")));
    }

    function insideTimeline(target) {
        try { return !!(target && target.closest && target.closest("#bintv-movie-seek-timeline")); } catch (e) { return false; }
    }

    // ------------------------------------------------------------------
    // Touch (phone) - nghe o CAPTURE tren document, chan ha canh xuong
    // player khi da xu ly (app.js dang ky tren player, chay sau).
    // ------------------------------------------------------------------
    function onPhoneTouchStart(event) {
        if (!playerOpen() || !event.touches || !event.touches.length) return;
        var touch = event.touches[0];
        var target = touch.target || event.target;
        if (isInteractiveTarget(target)) return;   // nut/menu: click xu ly binh thuong
        if (anyMenuOpen()) return;                 // dang mo menu/phu de: khong xu ly cham
        if (!hudVisible) {
            // HUD dang an: moi cham (keo hay giu) chi danh cho bat HUD
            if (insideTimeline(target)) return;    // (timeline dang an khong nhan cham)
            tapTracker = {
                id: touch.identifier,
                x: touch.clientX,
                y: touch.clientY,
                at: Date.now(),
                moved: false
            };
            event.stopPropagation();
            return;
        }
        if (insideTimeline(target)) {
            // Keo thanh trượt de tua
            event.preventDefault();
            event.stopPropagation();
            dragState = { fraction: timelineFractionFromTouch(touch) };
            applyDragPreview(dragState.fraction);
            return;
        }
        // Vung thuong (HUD dang hien): ghi nhan de phan biet tap / keo
        tapTracker = {
            id: touch.identifier,
            x: touch.clientX,
            y: touch.clientY,
            at: Date.now(),
            moved: false
        };
        event.stopPropagation();
    }

    function onPhoneTouchMove(event) {
        var touch = (event.touches && event.touches[0]) || null;
        if (dragState) {
            event.preventDefault();
            event.stopPropagation();
            if (touch) dragState.fraction = timelineFractionFromTouch(touch);
            applyDragPreview(dragState.fraction);
            return;
        }
        if (!tapTracker || !touch || touch.identifier !== tapTracker.id) return;
        var dx = touch.clientX - tapTracker.x;
        var dy = touch.clientY - tapTracker.y;
        if (Math.sqrt(dx * dx + dy * dy) > TOUCH_SLOP) tapTracker.moved = true;
        event.stopPropagation();
    }

    function onPhoneTouchEnd(event) {
        lastTouchEndAt = Date.now();
        var touch = (event.changedTouches && event.changedTouches[0]) || null;
        if (dragState) {
            event.preventDefault();
            event.stopPropagation();
            finishDragSeek(dragState.fraction);
            dragState = null;
            setHudVisible(true, true);
            return;
        }
        if (!tapTracker || !touch || touch.identifier !== tapTracker.id) return;
        var wasTap = !tapTracker.moved && (Date.now() - tapTracker.at) < TAP_MAX_MS;
        tapTracker = null;
        event.stopPropagation();
        if (!wasTap) return;
        // Cham nhanh = bat/tat HUD (ten phim + nut tam dung + timeline)
        setHudVisible(!hudVisible, true);
    }

    function onPhoneTouchCancel() {
        lastTouchEndAt = Date.now();
        dragState = null;
        tapTracker = null;
    }

    // ------------------------------------------------------------------
    // Xoay ngang tu dong khi player mo (phone; TV da khoa san)
    // ------------------------------------------------------------------
    function notifyLandscape(open) {
        if (landscapeOn === open) return;
        landscapeOn = open;
        try {
            if (window.AndroidBridge && typeof window.AndroidBridge.setPlayerLandscape === "function") {
                window.AndroidBridge.setPlayerLandscape(open ? "1" : "0");
            }
        } catch (bridgeError) {}
    }

    // ------------------------------------------------------------------
    // Khoi tao
    // ------------------------------------------------------------------
    function init() {
        player = getElement("bintv-movie-player");
        video = getElement("bintv-movie-html5-player");
        timeline = getElement("bintv-movie-seek-timeline");
        track = player ? player.querySelector(".movie-seek-timeline-track") : null;
        progress = getElement("bintv-movie-seek-progress");
        thumb = getElement("bintv-movie-seek-thumb");
        if (!player || !video) return;

        if (isPhone) {
            createPauseButton();
            // Dang ky CAPTURE tren document: chay truoc cac listener cua app.js
            // tren phan tu player -> stopPropagation() chan app.js khi da xu ly
            document.addEventListener("touchstart", onPhoneTouchStart, { capture: true, passive: false });
            document.addEventListener("touchmove", onPhoneTouchMove, { capture: true, passive: false });
            document.addEventListener("touchend", onPhoneTouchEnd, { capture: true, passive: false });
            document.addEventListener("touchcancel", onPhoneTouchCancel, { capture: true, passive: true });
        }

        // Player mo/dong -> HUD + xoay ngang
        var lastOpen = player.classList.contains("show");
        var observer = new MutationObserver(function () {
            var open = player.classList.contains("show");
            if (open === lastOpen) return;
            lastOpen = open;
            if (open) {
                setHudVisible(true, false); // hien ngay (trang thai "Dang chuan bi phat")
                notifyLandscape(true);
            } else {
                if (hudHideTimer) { clearTimeout(hudHideTimer); hudHideTimer = null; }
                hudVisible = true;
                player.classList.remove("phim-hud-hidden");
                if (hudOwnedTimelineShow && timeline) {
                    timeline.classList.remove("show");
                    hudOwnedTimelineShow = false;
                }
                dragState = null;
                tapTracker = null;
                notifyLandscape(false);
            }
        });
        observer.observe(player, { attributes: true, attributeFilter: ["class"] });

        // Trang thai phat quyet dinh an/hien HUD
        video.addEventListener("playing", function () { refreshPauseIcon(); setHudVisible(true, true); });
        video.addEventListener("pause", function () { refreshPauseIcon(); setHudVisible(true, false); });
        video.addEventListener("waiting", function () { setHudVisible(true, false); });
        video.addEventListener("error", function () { setHudVisible(true, false); });
        video.addEventListener("play", function () { refreshPauseIcon(); });
        video.addEventListener("timeupdate", function () {
            refreshPauseIcon();
            if (isPhone && hudVisible && !dragState) updateTimelineFromPlayback();
        });

        // TV: phim bat ky (D-pad) -> hien HUD roi tu an
        window.addEventListener("keydown", function () {
            if (playerOpen()) revealHud();
        }, true);

        refreshPauseIcon();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
