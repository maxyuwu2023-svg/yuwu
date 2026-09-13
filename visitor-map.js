(function () {
    "use strict";

    const VISITOR_API_URL = "https://yuwu-visitor-map-api.maxyuwu2023.workers.dev";
    const WORLD_DATA_URL = "assets/vendor/countries-110m.json";
    const DESKTOP_MAP_WIDTH_RATIO = 0.84;
    const VISIT_DOT_RADIUS = 2.0;
    const MAX_DOTS_PER_LOCATION = 2000;

    const host = document.getElementById("visitor-map");
    const canvas = host && host.querySelector("canvas");
    const summary = document.getElementById("visit-summary");
    if (!host || !canvas || !window.d3 || !window.topojson) return;

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

    function requestRender() {
        if (!animationFrame) animationFrame = window.requestAnimationFrame(render);
    }

    function resize() {
        const rect = host.getBoundingClientRect();
        width = Math.max(1, rect.width);
        height = Math.max(1, rect.height);
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        projection.fitExtent([[18, 16], [width - 18, height - 16]], { type: "Sphere" });
        const sphereBounds = path.bounds({ type: "Sphere" });
        const projectedWidth = sphereBounds[1][0] - sphereBounds[0][0];
        mapCenterX = (sphereBounds[0][0] + sphereBounds[1][0]) / 2;
        const targetWidth = width > 700
            ? width * DESKTOP_MAP_WIDTH_RATIO
            : width - 24;
        mapStretchX = Math.max(1, targetWidth / Math.max(1, projectedWidth));
        requestRender();
    }

    function projectPoint(longitude, latitude) {
        const projected = projection([longitude, latitude]);
        if (!projected) return null;
        return [
            mapCenterX + (projected[0] - mapCenterX) * mapStretchX,
            projected[1]
        ];
    }

    function seededRandom(seed) {
        let value = seed >>> 0;
        return function () {
            value = (value * 1664525 + 1013904223) >>> 0;
            return value / 4294967296;
        };
    }

    function drawStars() {
        const random = seededRandom(20260913);
        ctx.save();
        for (let i = 0; i < Math.max(90, Math.round(width / 9)); i += 1) {
            const x = random() * width;
            const y = random() * height;
            const r = random() * 0.85 + 0.2;
            ctx.beginPath();
            ctx.fillStyle = `rgba(185, 220, 245, ${0.08 + random() * 0.24})`;
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    function drawMap() {
        if (!land) return;
        ctx.save();
        ctx.translate(mapCenterX, 0);
        ctx.scale(mapStretchX, 1);
        ctx.translate(-mapCenterX, 0);
        ctx.beginPath();
        path({ type: "Sphere" });
        ctx.fillStyle = "rgba(1, 7, 16, 0.96)";
        ctx.fill();

        ctx.beginPath();
        path(land);
        const landGradient = ctx.createLinearGradient(0, 0, 0, height);
        landGradient.addColorStop(0, "rgba(39, 107, 137, 0.94)");
        landGradient.addColorStop(1, "rgba(15, 59, 83, 0.98)");
        ctx.fillStyle = landGradient;
        ctx.fill();
        ctx.strokeStyle = "rgba(147, 222, 244, 0.58)";
        ctx.lineWidth = 0.72;
        ctx.stroke();
        ctx.restore();
    }

    function clusterRadius(views) {
        return Math.min(58, VISIT_DOT_RADIUS + 1.65 * Math.sqrt(Math.max(1, views)));
    }

    function drawVisitDots(point) {
        const center = projectPoint(point.longitude, point.latitude);
        if (!center) return;
        const visits = Math.max(1, Math.floor(Number(point.views) || 1));
        const dotCount = Math.min(visits, MAX_DOTS_PER_LOCATION);

        ctx.save();
        ctx.fillStyle = "rgba(255, 47, 57, 0.96)";
        for (let index = 0; index < dotCount; index += 1) {
            const distance = index === 0 ? 0 : 1.65 * Math.sqrt(index);
            const angle = index * 2.399963229728653;
            const x = center[0] + Math.cos(angle) * distance;
            const y = center[1] + Math.sin(angle) * distance;
            ctx.beginPath();
            ctx.arc(x, y, VISIT_DOT_RADIUS, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    function render(now) {
        animationFrame = null;
        ctx.clearRect(0, 0, width, height);
        const ocean = ctx.createLinearGradient(0, 0, 0, height);
        ocean.addColorStop(0, "#01040a");
        ocean.addColorStop(0.58, "#020b16");
        ocean.addColorStop(1, "#04101d");
        ctx.fillStyle = ocean;
        ctx.fillRect(0, 0, width, height);
        drawStars();
        drawMap();
        points.forEach(drawVisitDots);
    }

    function updateSummary() {
        if (!summary || !totalViews) return;
        const regions = points.length;
        summary.textContent = `全球访问足迹 · ${totalViews.toLocaleString("zh-CN")} 次访问 · ${regions} 个地区`;
        summary.hidden = false;
    }

    function setTooltip(point, x, y) {
        let tooltip = host.querySelector(".map-tooltip");
        if (!point) {
            if (tooltip) tooltip.remove();
            return;
        }
        if (!tooltip) {
            tooltip = document.createElement("div");
            tooltip.className = "map-tooltip";
            host.appendChild(tooltip);
        }
        const place = [point.city, point.country].filter(Boolean).join(" · ") || "未知地区";
        tooltip.textContent = `${place}：${point.views.toLocaleString("zh-CN")} 次访问`;
        tooltip.style.left = `${x}px`;
        tooltip.style.top = `${y}px`;
    }

    function findNearest(x, y) {
        let nearest = null;
        let bestDistance = Infinity;
        points.forEach((point) => {
            const projected = projectPoint(point.longitude, point.latitude);
            if (!projected) return;
            const distance = Math.hypot(projected[0] - x, projected[1] - y);
            if (distance < bestDistance && distance <= clusterRadius(point.views) + 8) {
                bestDistance = distance;
                nearest = point;
            }
        });
        return nearest;
    }

    host.addEventListener("pointermove", (event) => {
        const rect = host.getBoundingClientRect();
        pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        setTooltip(findNearest(pointer.x, pointer.y), pointer.x, pointer.y);
    });
    host.addEventListener("pointerleave", () => {
        pointer = null;
        setTooltip(null);
    });

    async function loadVisits() {
        if (!VISITOR_API_URL) return;
        try {
            const response = await fetch(`${VISITOR_API_URL.replace(/\/$/, "")}/api/visit`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
                mode: "cors",
                credentials: "omit"
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            points = Array.isArray(data.points) ? data.points : [];
            totalViews = Number(data.totalViews) || 0;
            updateSummary();
            requestRender();
        } catch (error) {
            console.warn("访问地图数据暂时不可用：", error);
        }
    }

    const observer = new ResizeObserver(() => resize());
    observer.observe(host);
    resize();
    Promise.all([
        fetch(WORLD_DATA_URL).then((response) => response.json()),
        loadVisits()
    ]).then(([world]) => {
        land = topojson.feature(world, world.objects.countries);
        requestRender();
    }).catch((error) => {
        console.warn("世界地图数据加载失败：", error);
    });
    requestRender();

    document.addEventListener("visibilitychange", () => {
        if (document.hidden && animationFrame) {
            window.cancelAnimationFrame(animationFrame);
            animationFrame = null;
        } else if (!document.hidden && !animationFrame) {
            requestRender();
        }
    });
})();
