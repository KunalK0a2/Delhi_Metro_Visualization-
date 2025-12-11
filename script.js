async function loadGTFS(filename) {
    const response = await fetch(filename);
    const text = await response.text();
    const rows = text.trim().split("\n").map(r => r.split(","));
    const headers = rows[0];
    return rows.slice(1).map(row => {
        let obj = {};
        row.forEach((value, i) => obj[headers[i]] = value);
        return obj;
    });
}

function buildEdges(stopTimes, tripToRoute, routeColor) {
    const trips = {};
    stopTimes.forEach(s => {
        if (!trips[s.trip_id]) trips[s.trip_id] = [];
        trips[s.trip_id].push(s);
    });

    let edges = [];
    Object.entries(trips).forEach(([trip_id, st]) => {
        st.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
        const color = routeColor[tripToRoute[trip_id]] || "#888";
        for (let i = 0; i < st.length - 1; i++) {
            edges.push({
                from: st[i].stop_id,
                to: st[i + 1].stop_id,
                color: color
            });
        }
    });

    // Remove duplicate edges but keep first occurrence color
    const edgeMap = new Map();
    edges.forEach(e => {
        const key = [e.from, e.to].sort().join("-");
        if (!edgeMap.has(key)) edgeMap.set(key, e.color);
    });

    return Array.from(edgeMap.entries()).map(([k, color]) => {
        const [from, to] = k.split("-");
        return { from, to, color };
    });
}

(async function() {
    const stops = await loadGTFS("./dmrc_gtfs/stops.txt");
    const stopTimes = await loadGTFS("./dmrc_gtfs/stop_times.txt");
    const trips = await loadGTFS("./dmrc_gtfs/trips.txt");
    const routes = await loadGTFS("./dmrc_gtfs/routes.txt");

    // Map trip_id -> route_id
    const tripToRoute = {};
    trips.forEach(t => tripToRoute[t.trip_id] = t.route_id);

    // Extract line color from route name
    function getLineColor(route) {
        const name = (route.route_short_name || route.route_long_name || "").toUpperCase();
        if (name.startsWith("B")) return "#0000FF";       // Blue
        if (name.startsWith("R")) return "#FF0000";       // Red
        if (name.startsWith("Y")) return "#FFFF00";       // Yellow
        if (name.startsWith("G")) return "#00FF00";       // Green
        if (name.startsWith("M")) return "#FF00FF";       // Magenta
        if (name.startsWith("V")) return "#8A2BE2";       // Violet
        if (name.startsWith("A")) return "#00FFFF";       // Aqua
        if (name.startsWith("O")) return "#FFA500";       // Orange
        if (name.startsWith("P")) return "#FFC0CB";       // Pink
        if (name.startsWith("R_SP")) return "#A52A2A";    // Rapid Metro (brown)
        if (name.startsWith("G_DD")) return "#808080";    // Gray
        return "#888"; // fallback gray
    }

    const routeColor = {};
    routes.forEach(r => {
        routeColor[r.route_id] = getLineColor(r);
    });

    const stopMap = {};
    stops.forEach(s => stopMap[s.stop_id] = s);

    const edges = buildEdges(stopTimes, tripToRoute, routeColor);

    const width = 900;
    const height = 700;

    const mapDiv = d3.select("#map")
        .style("width", width + "px")
        .style("height", height + "px");

    const canvas = mapDiv.append("canvas")
        .attr("width", width)
        .attr("height", height)
        .node();

    const context = canvas.getContext("2d");

    const projection = d3.geoMercator()
        .center([77.23, 28.61])
        .scale(100000)
        .translate([width / 2, height / 2]);

    // Dark background
    context.fillStyle = "#111";
    context.fillRect(0, 0, width, height);

    // Draw edges
    edges.forEach(e => {
        const A = stopMap[e.from];
        const B = stopMap[e.to];
        context.strokeStyle = e.color;
        context.lineWidth = 3;
        context.beginPath();
        const [x1, y1] = projection([+A.stop_lon, +A.stop_lat]);
        const [x2, y2] = projection([+B.stop_lon, +B.stop_lat]);
        context.moveTo(x1, y1);
        context.lineTo(x2, y2);
        context.stroke();
    });

    // Draw stops
    stops.forEach(s => {
        const [x, y] = projection([+s.stop_lon, +s.stop_lat]);
        context.fillStyle = "white";
        context.strokeStyle = "#333";
        context.lineWidth = 1;
        context.beginPath();
        context.arc(x, y, 5, 0, Math.PI * 2);
        context.fill();
        context.stroke();
    });

    // Tooltip
    const tooltip = d3.select("#tooltip");
    d3.select(canvas).on("mousemove", (event) => {
        const [mx, my] = d3.pointer(event);
        let found = null;
        for (let s of stops) {
            const [x, y] = projection([+s.stop_lon, +s.stop_lat]);
            if ((mx - x) ** 2 + (my - y) ** 2 < 10 ** 2) {
                found = s;
                break;
            }
        }
        if (found) {
            tooltip.style("opacity", 1)
                   .html(found.stop_name)
                   .style("left", (event.pageX + 10) + "px")
                   .style("top", (event.pageY + 10) + "px");
        } else {
            tooltip.style("opacity", 0);
        }
    });

})();