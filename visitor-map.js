(function () {
    "use strict";

    const VISITOR_API_URL =
        "https://yuwu-visitor-map-api.maxyuwu2023.workers.dev";

    const WORLD_DATA_URL =
        "assets/vendor/countries-110m.json";

    // 桌面端地图横向宽度比例
    const DESKTOP_MAP_WIDTH_RATIO = 0.84;

    // 根据网页语言决定访问统计的显示语言
    const isEnglish =
        document.documentElement.lang
            .toLowerCase()
            .startsWith("en");

    const locale =
        isEnglish ? "en" : "zh-CN";

    const regionNames =
        typeof Intl.DisplayNames === "function"
            ? new Intl.DisplayNames(
                  [locale],
                  { type: "region" }
              )
            : null;

    const host =
        document.getElementById(
            "visitor-map"
        );

    const canvas =
        host &&
        host.querySelector("canvas");

    const summary =
        document.getElementById(
            "visit-summary"
        );

    if (
        !host ||
        !canvas ||
        !window.d3 ||
        !window.topojson
    ) {
        return;
    }

    const ctx =
        canvas.getContext("2d");

    const projection =
        d3.geoNaturalEarth1();

    const path =
        d3.geoPath(projection, ctx);

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

        width =
            Math.max(1, rect.width);

        height =
            Math.max(1, rect.height);

        dpr =
            Math.min(
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
                [
                    width - 18,
                    height - 16
                ]
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
                ? width *
                  DESKTOP_MAP_WIDTH_RATIO
                : width - 24;

        mapStretchX =
            Math.max(
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

        if (!projected) {
            return null;
        }

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

            return (
                value / 4294967296
            );
        };
    }

    function drawStars() {
        const random =
            seededRandom(20260913);

        ctx.save();

        const starCount =
            Math.max(
                90,
                Math.round(width / 9)
            );

        for (
            let index = 0;
            index < starCount;
            index += 1
        ) {
            const x =
                random() * width;

            const y =
                random() * height;

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
        if (!land) {
            return;
        }

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

        // 绘制海洋区域
        ctx.beginPath();

        path({
            type: "Sphere"
        });

        ctx.fillStyle =
            "rgba(1, 7, 16, 0.96)";

        ctx.fill();

        // 绘制陆地
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

        ctx.fillStyle =
            landGradient;

        ctx.fill();

        // 绘制国家边界
        ctx.strokeStyle =
            "rgba(147, 222, 244, 0.58)";

        ctx.lineWidth = 0.72;
        ctx.stroke();

        ctx.restore();
    }

    /*
     * 根据访问次数计算红点大小。
     *
     * 一个地区只显示一个红点。
     * 访问次数越多，红点越大。
     *
     * 使用对数增长，防止访问次数
     * 很高时红点变得过大。
     */
    function dotRadius(views) {
        const count =
            Math.max(
                1,
                Number(views) || 1
            );

        return (
            2.3 +
            Math.min(
                7.7,
                Math.log2(
                    count + 1
                ) * 1.15
            )
        );
    }

    function drawVisitDots(point) {
        const center =
            projectPoint(
                point.longitude,
                point.latitude
            );

        if (!center) {
            return;
        }

        const radius =
            dotRadius(point.views);

        ctx.save();

        // 纯红点，没有光晕
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

        // 细边框用于增强辨识度
        ctx.strokeStyle =
            "rgba(255, 225, 225, 0.82)";

        ctx.lineWidth = 0.7;
        ctx.stroke();

        ctx.restore();
    }

    function render() {
        animationFrame = null;

        ctx.clearRect(
            0,
            0,
            width,
            height
        );

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
                        point.country ||
                        ""
                    )
                        .toUpperCase() ||
                    "UNKNOWN";

                const visits =
                    Number(
                        point.views
                    ) || 0;

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
                (
                    first,
                    second
                ) =>
                    second[1] -
                    first[1]
            );

        // 只显示访问量最高的7个国家
        const visibleCountries =
            rankedCountries
                .slice(0, 4)
                .map(
                    ([
                        code,
                        visits
                    ]) => {
                        const name =
                            code ===
                            "UNKNOWN"
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

                        if (isEnglish) {
                            return (
                                `${name} ` +
                                `${visits.toLocaleString(
                                    locale
                                )}`
                            );
                        }

                        return (
                            `${name} ` +
                            `${visits.toLocaleString(
                                locale
                            )}次`
                        );
                    }
                );

        // 其他国家合并显示
        const remainingVisits =
            rankedCountries
                .slice(4)
                .reduce(
                    (
                        sum,
                        [, visits]
                    ) =>
                        sum +
                        visits,
                    0
                );

        if (
            remainingVisits > 0
        ) {
            if (isEnglish) {
                visibleCountries.push(
                    `Other ${remainingVisits.toLocaleString(
                        locale
                    )}`
                );
            } else {
                visibleCountries.push(
                    `其他 ${remainingVisits.toLocaleString(
                        locale
                    )}次`
                );
            }
        }

        if (isEnglish) {
            summary.textContent =
                `Global visitor footprint · ` +
                visibleCountries.join(
                    " · "
                );
        } else {
            summary.textContent =
                `全球访问足迹 · ` +
                visibleCountries.join(
                    " · "
                );
        }

        summary.hidden = false;
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
            Number(
                point.views
            ) || 0;

        if (isEnglish) {
            tooltip.textContent =
                `${place}: ` +
                `${visits.toLocaleString(
                    locale
                )} ` +
                `visit${
                    visits === 1
                        ? ""
                        : "s"
                }`;
        } else {
            tooltip.textContent =
                `${place}：` +
                `${visits.toLocaleString(
                    locale
                )} 次访问`;
        }

        tooltip.style.left =
            `${x}px`;

        tooltip.style.top =
            `${y}px`;
    }

    function findNearest(x, y) {
        let nearest = null;
        let bestDistance =
            Infinity;

        points.forEach(
            (point) => {
                const projected =
                    projectPoint(
                        point.longitude,
                        point.latitude
                    );

                if (!projected) {
                    return;
                }

                const distance =
                    Math.hypot(
                        projected[0] -
                            x,
                        projected[1] -
                            y
                    );

                const clickableRadius =
                    dotRadius(
                        point.views
                    ) + 8;

                if (
                    distance <
                        bestDistance &&
                    distance <=
                        clickableRadius
                ) {
                    bestDistance =
                        distance;

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

            pointer = {
                x:
                    event.clientX -
                    rect.left,
                y:
                    event.clientY -
                    rect.top
            };

            const point =
                findNearest(
                    pointer.x,
                    pointer.y
                );

            setTooltip(
                point,
                pointer.x,
                pointer.y
            );
        }
    );

    host.addEventListener(
        "pointerleave",
        () => {
            pointer = null;
            setTooltip(null);
        }
    );

    async function loadVisits() {
        if (!VISITOR_API_URL) {
            return;
        }

        try {
            /*
             * 中文和英文页面共享 sessionStorage。
             * 在同一次浏览会话中切换语言，
             * 不会重复增加访问次数。
             */
            let alreadyRecorded =
                false;

            try {
                alreadyRecorded =
                    sessionStorage.getItem(
                        "visitor-map-recorded"
                    ) === "1";
            } catch (_) {
                // 隐私模式下仍可正常加载。
            }

            const endpoint =
                alreadyRecorded
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
                            alreadyRecorded
                                ? "GET"
                                : "POST",

                        headers:
                            alreadyRecorded
                                ? undefined
                                : {
                                      "Content-Type":
                                          "application/json"
                                  },

                        body:
                            alreadyRecorded
                                ? undefined
                                : "{}",

                        mode: "cors",
                        credentials:
                            "omit"
                    }
                );

            if (!response.ok) {
                throw new Error(
                    `HTTP ${response.status}`
                );
            }

            const data =
                await response.json();

            if (!alreadyRecorded) {
                try {
                    sessionStorage.setItem(
                        "visitor-map-recorded",
                        "1"
                    );
                } catch (_) {
                    // 不影响地图显示。
                }
            }

            points =
                Array.isArray(
                    data.points
                )
                    ? data.points
                    : [];

            totalViews =
                Number(
                    data.totalViews
                ) || 0;

            updateSummary();
            requestRender();
        } catch (error) {
            console.warn(
                "访问地图数据暂时不可用：",
                error
            );
        }
    }

    const observer =
        new ResizeObserver(
            () => {
                resize();
            }
        );

    observer.observe(host);
    resize();

    Promise.all([
        fetch(
            WORLD_DATA_URL
        ).then(
            (response) => {
                if (!response.ok) {
                    throw new Error(
                        `HTTP ${response.status}`
                    );
                }

                return response.json();
            }
        ),
        loadVisits()
    ])
        .then(([world]) => {
            land =
                topojson.feature(
                    world,
                    world.objects
                        .countries
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

                animationFrame =
                    null;
            } else if (
                !document.hidden &&
                !animationFrame
            ) {
                requestRender();
            }
        }
    );
})();
