(function () {
    "use strict";

    const VISITOR_API_URL = "https://yuwu-visitor-map-api.maxyuwu2023.workers.dev";
    const WORLD_DATA_URL = "assets/vendor/countries-110m.json";
    const DESKTOP_MAP_WIDTH_RATIO = 0.84;
    const VISIT_CACHE_KEY = "visitor-map-last-visits-v1";
    const WORLD_CACHE_KEY = "visitor-map-last-world-v1";
    const SNAPSHOT_CACHE_KEY_PREFIX = "visitor-map-last-snapshot-v2";
    const PENDING_CN_CACHE_KEY = "visitor-map-pending-cn-v1";

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
            host.style.backgroundImage =
                `url("${snapshot}")`;

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

    function pendingChinaVisits() {
        try {
            return Math.max(
                0,
                Math.min(
                    100,
                    Number(
                        localStorage.getItem(
                            PENDING_CN_CACHE_KEY
                        )
                    ) || 0
                )
            );
        } catch (_) {
            return 0;
        }
    }

    function setPendingChinaVisits(count) {
        try {
            const safeCount = Math.max(
                0,
                Math.min(
                    100,
                    Math.floor(Number(count) || 0)
                )
            );

            if (safeCount > 0) {
                localStorage.setItem(
                    PENDING_CN_CACHE_KEY,
                    String(safeCount)
                );
            } else {
                localStorage.removeItem(
                    PENDING_CN_CACHE_KEY
                );
            }
        } catch (_) {
            // 本地存储不可用时无法延期补报。
        }
    }

    function addChinaVisitsToCurrentData(count) {
        if (!count) return;

        let chinaPoint = points.find(
            (point) =>
                String(
                    point.country || ""
                ).toUpperCase() === "CN"
        );

        if (!chinaPoint) {
            chinaPoint = {
                latitude: 35.9,
                longitude: 104.2,
                city: "",
                country: "CN",
                views: 0
            };

            points.push(chinaPoint);
        }

        chinaPoint.views =
            Number(chinaPoint.views || 0) +
            count;

        totalViews += count;
    }

    function rememberFailedVisitAsChina() {
        const pending = Math.min(
            100,
            pendingChinaVisits() + 1
        );

        setPendingChinaVisits(pending);
        addChinaVisitsToCurrentData(1);

        writeCache(
            VISIT_CACHE_KEY,
            {
                points,
                totalViews,
                savedAt: Date.now()
            }
        );

        updateSummary();
        requestRender();
    }

    async function flushPendingChinaVisits() {
        const pending = pendingChinaVisits();

        if (!pending) return null;

        const response = await fetch(
            `${VISITOR_API_URL.replace(
                /\/$/,
                ""
            )}/api/fallback-cn`,
            {
                method: "POST",
                headers: {
                    "Content-Type":
                        "application/json"
                },
                body: JSON.stringify({
                    count: pending
                }),
                mode: "cors",
                credentials: "omit"
            }
        );

        if (!response.ok) {
            throw new Error(
                `Fallback HTTP ${response.status}`
            );
        }

        const data = await response.json();

        setPendingChinaVisits(0);

        return data;
    }

    function requestRender() {
        if (!animationFrame) {
            animationFrame =
                window.requestAnimationFrame(
                    render
                );
        }
    }

    function resize() {
        const rect =
            host.getBoundingClientRect();

        width = Math.max(
            1,
            rect.width
        );

        height = Math.max(
            1,
            rect.height
        );

        dpr = Math.min(
            window.devicePixelRatio || 1,
            2
        );

        canvas.width =
            Math.round(width * dpr);

        canvas.height =
            Math.round(height * dpr);

        ctx.setTransform(
            dpr,
            0,
            0,
            dpr,
            0,
            0
        );

        projection.fitExtent(
            [
                [18, 16],
                [width - 18, height - 16]
            ],
            { type: "Sphere" }
        );

        const sphereBounds =
            path.bounds({
                type: "Sphere"
            });

        const projectedWidth =
            sphereBounds[1][0] -
            sphereBounds[0][0];

        mapCenterX =
            (
                sphereBounds[0][0] +
                sphereBounds[1][0]
            ) / 2;

        const targetWidth =
            width > 700
                ? width * DESKTOP_MAP_WIDTH_RATIO
                : width - 24;

        mapStretchX = Math.max(
            1,
            targetWidth /
                Math.max(
                    1,
                    projectedWidth
                )
        );

        requestRender();
    }

    function projectPoint(
        longitude,
        latitude
    ) {
        const projected =
            projection([
                longitude,
                latitude
            ]);

        if (!projected) return null;

        return [
            mapCenterX +
                (
                    projected[0] -
                    mapCenterX
                ) *
                    mapStretchX,
            projected[1]
        ];
    }

    function seededRandom(seed) {
        let value = seed >>> 0;

        return function () {
            value =
                (
                    value * 1664525 +
                    1013904223
                ) >>> 0;

            return value / 4294967296;
        };
    }

    function drawStars() {
        const random =
            seededRandom(20260913);

        ctx.save();

        const starCount = Math.max(
            90,
            Math.round(width / 9)
        );

        for (
            let index = 0;
            index < starCount;
            index += 1
        ) {
            const x = random() * width;
            const y = random() * height;
            const radius =
                random() * 0.85 + 0.2;

            ctx.beginPath();

            ctx.fillStyle =
                `rgba(185, 220, 245, ${
                    0.08 +
                    random() * 0.24
                })`;

            ctx.arc(
                x,
                y,
                radius,
                0,
                Math.PI * 2
            );

            ctx.fill();
        }

        ctx.restore();
    }

    function drawMap() {
        if (!land) return;

        ctx.save();

        ctx.translate(
            mapCenterX,
            0
        );

        ctx.scale(
            mapStretchX,
            1
        );

        ctx.translate(
            -mapCenterX,
            0
        );

        ctx.beginPath();

        path({
            type: "Sphere"
        });

        ctx.fillStyle =
            "rgba(1, 7, 16, 0.96)";

        ctx.fill();

        ctx.beginPath();
        path(land);

        const landGradient =
            ctx.createLinearGradient(
                0,
                0,
                0,
                height
            );

        landGradient.addColorStop(
            0,
            "rgba(39, 107, 137, 0.94)"
        );

        landGradient.addColorStop(
            1,
            "rgba(15, 59, 83, 0.98)"
        );

        ctx.fillStyle = landGradient;
        ctx.fill();

        ctx.strokeStyle =
            "rgba(147, 222, 244, 0.58)";

        ctx.lineWidth = 0.72;
        ctx.stroke();

        ctx.restore();
    }

    function dotRadius(views) {
        const count = Math.max(
            1,
            Number(views) || 1
        );

        return (
            2.3 +
            Math.min(
                7.7,
                Math.log2(count + 1) * 0.65
            )
        );
    }

    function drawVisitDots(point) {
        const center =
            projectPoint(
                point.longitude,
                point.latitude
            );

        if (!center) return;

        const radius =
            dotRadius(point.views);

        ctx.save();

        ctx.fillStyle =
            "rgba(255, 47, 57, 0.96)";

        ctx.beginPath();

        ctx.arc(
            center[0],
            center[1],
            radius,
            0,
            Math.PI * 2
        );

        ctx.fill();

        ctx.strokeStyle =
            "rgba(255, 225, 225, 0.82)";

        ctx.lineWidth = 0.7;
        ctx.stroke();

        ctx.restore();
    }

    function saveSuccessfulSnapshot() {
        if (!land) return;

        if (snapshotTimer) {
            window.clearTimeout(
                snapshotTimer
            );
        }

        snapshotTimer =
            window.setTimeout(
                () => {
                    try {
                        const snapshot =
                            canvas.toDataURL(
                                "image/webp",
                                0.82
                            );

                        localStorage.setItem(
                            snapshotCacheKey(),
                            snapshot
                        );

                        host.style.backgroundImage =
                            `url("${snapshot}")`;

                        host.style.backgroundSize =
                            "cover";

                        host.style.backgroundPosition =
                            "center";

                        hasCachedSnapshot = true;
                    } catch (_) {
                        // 快照保存失败时继续显示实时地图。
                    }
                },
                250
            );
    }

    function render() {
        animationFrame = null;

        ctx.clearRect(
            0,
            0,
            width,
            height
        );

        if (
            !land &&
            hasCachedSnapshot
        ) {
            return;
        }

        const ocean =
            ctx.createLinearGradient(
                0,
                0,
                0,
                height
            );

        ocean.addColorStop(
            0,
            "#01040a"
        );

        ocean.addColorStop(
            0.58,
            "#020b16"
        );

        ocean.addColorStop(
            1,
            "#04101d"
        );

        ctx.fillStyle = ocean;

        ctx.fillRect(
            0,
            0,
            width,
            height
        );

        drawStars();
        drawMap();

        points.forEach(
            drawVisitDots
        );

        saveSuccessfulSnapshot();
    }

    function updateSummary() {
        if (
            !summary ||
            !totalViews
        ) {
            return;
        }

        const countryTotals =
            new Map();

        points.forEach(
            (point) => {
                const code =
                    String(
                        point.country || ""
                    ).toUpperCase() ||
                    "UNKNOWN";

                const visits =
                    Number(point.views) || 0;

                countryTotals.set(
                    code,
                    (
                        countryTotals.get(
                            code
                        ) || 0
                    ) + visits
                );
            }
        );

        const rankedCountries =
            [
                ...countryTotals.entries()
            ].sort(
                (first, second) =>
                    second[1] -
                    first[1]
            );

        /*
         * 只显示访问量最高的4个国家。
         */
        const visibleCountries =
            rankedCountries
                .slice(0, 4)
                .map(
                    ([
                        code,
                        visits
                    ]) => {
                        const name =
                            code === "UNKNOWN"
                                ? (
                                      isEnglish
                                          ? "Unknown"
                                          : "未知地区"
                                  )
                                : (
                                      regionNames?.of(
                                          code
                                      ) ||
                                      code
                                  );

                        return isEnglish
                            ? `${name} ${visits.toLocaleString(locale)}`
                            : `${name} ${visits.toLocaleString(locale)}次`;
                    }
                );

        /*
         * 第5个国家开始合并为“其他”。
         */
        const remainingVisits =
            rankedCountries
                .slice(4)
                .reduce(
                    (
                        sum,
                        [, visits]
                    ) =>
                        sum + visits,
                    0
                );

        if (
            remainingVisits > 0
        ) {
            visibleCountries.push(
                isEnglish
                    ? `Other ${remainingVisits.toLocaleString(locale)}`
                    : `其他 ${remainingVisits.toLocaleString(locale)}次`
            );
        }

        summary.textContent = isEnglish
            ? `Global visitor footprint · ${visibleCountries.join(" · ")}`
            : `全球访问足迹 · ${visibleCountries.join(" · ")}`;

        summary.hidden = false;
    }

    function restoreCachedVisits() {
        const cached =
            readCache(
                VISIT_CACHE_KEY
            );

        if (
            !cached ||
            !Array.isArray(
                cached.points
            )
        ) {
            return false;
        }

        points = cached.points;

        totalViews =
            Number(
                cached.totalViews
            ) || 0;

        updateSummary();
        requestRender();

        return true;
    }

    function setTooltip(
        point,
        x,
        y
    ) {
        let tooltip =
            host.querySelector(
                ".map-tooltip"
            );

        if (!point) {
            if (tooltip) {
                tooltip.remove();
            }

            return;
        }

        if (!tooltip) {
            tooltip =
                document.createElement(
                    "div"
                );

            tooltip.className =
                "map-tooltip";

            host.appendChild(
                tooltip
            );
        }

        const countryCode =
            String(
                point.country || ""
            ).toUpperCase();

        const countryName =
            countryCode
                ? (
                      regionNames?.of(
                          countryCode
                      ) ||
                      countryCode
                  )
                : "";

        const place =
            [
                point.city,
                countryName
            ]
                .filter(Boolean)
                .join(" · ") ||
            (
                isEnglish
                    ? "Unknown location"
                    : "未知地区"
            );

        const visits =
            Number(point.views) || 0;

        tooltip.textContent =
            isEnglish
                ? `${place}: ${visits.toLocaleString(locale)} visit${visits === 1 ? "" : "s"}`
                : `${place}：${visits.toLocaleString(locale)} 次访问`;

        tooltip.style.left =
            `${x}px`;

        tooltip.style.top =
            `${y}px`;
    }

    function findNearest(x, y) {
        let nearest = null;
        let bestDistance = Infinity;

        points.forEach(
            (point) => {
                const projected =
                    projectPoint(
                        point.longitude,
                        point.latitude
                    );

                if (!projected) return;

                const distance =
                    Math.hypot(
                        projected[0] - x,
                        projected[1] - y
                    );

                if (
                    distance < bestDistance &&
                    distance <=
                        dotRadius(point.views) + 8
                ) {
                    bestDistance = distance;
                    nearest = point;
                }
            }
        );

        return nearest;
    }

    host.addEventListener(
        "pointermove",
        (event) => {
            const rect =
                host.getBoundingClientRect();

            const pointer = {
                x:
                    event.clientX -
                    rect.left,
                y:
                    event.clientY -
                    rect.top
            };

            setTooltip(
                findNearest(
                    pointer.x,
                    pointer.y
                ),
                pointer.x,
                pointer.y
            );
        }
    );

    host.addEventListener(
        "pointerleave",
        () => {
            setTooltip(null);
        }
    );

    document
        .querySelectorAll(
            ".language-switch a"
        )
        .forEach(
            (link) => {
                link.addEventListener(
                    "click",
                    () => {
                        try {
                            sessionStorage.setItem(
                                "visitor-map-skip-next-record",
                                "1"
                            );
                        } catch (_) {
                            // 不影响语言切换。
                        }
                    }
                );
            }
        );

    async function loadVisits() {
        if (!VISITOR_API_URL) return;

        const restoredFromCache =
            restoreCachedVisits();

        try {
            let skipThisRecord = false;

            try {
                skipThisRecord =
                    sessionStorage.getItem(
                        "visitor-map-skip-next-record"
                    ) === "1";

                sessionStorage.removeItem(
                    "visitor-map-skip-next-record"
                );
            } catch (_) {
                // sessionStorage不可用时正常请求。
            }

            const endpoint =
                skipThisRecord
                    ? "/api/visits"
                    : "/api/visit";

            const response =
                await fetch(
                    `${VISITOR_API_URL.replace(
                        /\/$/,
                        ""
                    )}${endpoint}`,
                    {
                        method:
                            skipThisRecord
                                ? "GET"
                                : "POST",

                        headers:
                            skipThisRecord
                                ? undefined
                                : {
                                      "Content-Type":
                                          "application/json"
                                  },

                        body:
                            skipThisRecord
                                ? undefined
                                : "{}",

                        mode: "cors",
                        credentials: "omit"
                    }
                );

            if (!response.ok) {
                throw new Error(
                    `HTTP ${response.status}`
                );
            }

            let data =
                await response.json();

            /*
             * 如果浏览器此前有失败请求，
             * 在本次成功连接后补报到中国大陆中心点。
             */
            try {
                const syncedData =
                    await flushPendingChinaVisits();

                if (syncedData) {
                    data = syncedData;
                }
            } catch (syncError) {
                console.warn(
                    "中国大陆待补报访问暂未同步：",
                    syncError
                );

                const pending =
                    pendingChinaVisits();

                if (
                    pending &&
                    Array.isArray(data.points)
                ) {
                    points = data.points;

                    totalViews =
                        Number(data.totalViews) || 0;

                    addChinaVisitsToCurrentData(
                        pending
                    );

                    data = {
                        points,
                        totalViews
                    };
                }
            }

            points =
                Array.isArray(data.points)
                    ? data.points
                    : [];

            totalViews =
                Number(data.totalViews) || 0;

            writeCache(
                VISIT_CACHE_KEY,
                {
                    points,
                    totalViews,
                    savedAt: Date.now()
                }
            );

            updateSummary();
            requestRender();
        } catch (error) {
            console.warn(
                "访问地图数据暂时不可用：",
                error
            );

            /*
             * 所有完全失败的请求，
             * 暂时计入中国大陆中心点。
             */
            rememberFailedVisitAsChina();

            if (restoredFromCache) {
                requestRender();
            }
        }
    }

    async function loadWorldData() {
        try {
            const response =
                await fetch(
                    WORLD_DATA_URL,
                    {
                        cache: "no-cache"
                    }
                );

            if (!response.ok) {
                throw new Error(
                    `HTTP ${response.status}`
                );
            }

            const world =
                await response.json();

            writeCache(
                WORLD_CACHE_KEY,
                world
            );

            return world;
        } catch (error) {
            const cachedWorld =
                readCache(
                    WORLD_CACHE_KEY
                );

            if (
                cachedWorld
                    ?.objects
                    ?.countries
            ) {
                console.warn(
                    "世界地图数据加载失败，正在显示上次成功的地图：",
                    error
                );

                return cachedWorld;
            }

            throw error;
        }
    }

    const observer =
        new ResizeObserver(
            () => resize()
        );

    observer.observe(host);
    resize();

    Promise.all([
        loadWorldData(),
        loadVisits()
    ])
        .then(([world]) => {
            land =
                topojson.feature(
                    world,
                    world.objects.countries
                );

            requestRender();
        })
        .catch((error) => {
            console.warn(
                "世界地图数据加载失败：",
                error
            );
        });

    requestRender();

    document.addEventListener(
        "visibilitychange",
        () => {
            if (
                document.hidden &&
                animationFrame
            ) {
                window.cancelAnimationFrame(
                    animationFrame
                );

                animationFrame = null;
            } else if (
                !document.hidden &&
                !animationFrame
            ) {
                requestRender();
            }
        }
    );
})();
