(function () {
    "use strict";

    const VISITOR_API_URL = "https://yuwu-visitor-map-api.maxyuwu2023.workers.dev";
    const WORLD_DATA_URL = "assets/vendor/countries-110m.json";
    const DESKTOP_MAP_WIDTH_RATIO = 0.84;
    const VISIT_CACHE_KEY = "visitor-map-last-visits-v1";
    const WORLD_CACHE_KEY = "visitor-map-last-world-v1";
    const SNAPSHOT_CACHE_KEY_PREFIX = "visitor-map-last-snapshot-v2";

    const isEnglish = document.documentElement.lang
        .toLowerCase()
        .startsWith("en");

    const locale = isEnglish ? "en" : "zh-CN";

    const regionNames = typeof Intl.DisplayNames === "function"
        ? new Intl.DisplayNames([locale], { type: "region" })
        : null;

    const host = document.getElementById("visitor-map");
    const canvas = host && host.querySelector("canvas");
    const summary = document.getElementById("visit-summary");

    if (!host || !canvas) return;

    function snapshotCacheKey() {
        const layout = window.innerWidth <= 600
            ? "mobile"
            : "desktop";

        return `${SNAPSHOT_CACHE_KEY_PREFIX}-${layout}`;
    }

    let hasCachedSnapshot = false;

    try {
        const snapshot = localStorage.getItem(
            snapshotCacheKey()
        );

        if (snapshot) {
            host.style.backgroundImage = `url("${snapshot}")`;
            host.style.backgroundSize = "cover";
            host.style.backgroundPosition = "center";
            hasCachedSnapshot = true;
        }
    } catch (_) {
        // 快照缓存不可用时不影响页面其他内容。
    }

    if (!window.d3 || !window.topojson) return;

    const ctx = canvas.getContext("2d");
    const projection = d3.geoNaturalEarth1();
    const path = d3.geoPath(projection, ctx);

    let land = null;
    let points = [];
    let totalViews = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let mapStretchX = 1;
    let mapCenterX = 0;
    let animationFrame = null;
    let pointer = null;
    let snapshotTimer = null;

    function readCache(key) {
        try {
            const value = localStorage.getItem(key);
            return value ? JSON.parse(value) : null;
        } catch (_) {
            return null;
        }
    }

    function writeCache(key, value) {
        try {
            localStorage.setItem(
                key,
                JSON.stringify(value)
            );
        } catch (_) {
            // 缓存不可用时不影响地图正常显示。
        }
    }

    function requestRender() {
        if (!animationFrame) {
            animationFrame = window.requestAnimationFrame(
                render
            );
        }
    }

    function resize() {
        const rect = host.getBoundingClientRect();

        width = Math.max(1, rect.width);
        height = Math.max(1, rect.height);
        dpr = Math.min(
            window.devicePixelRatio || 1
