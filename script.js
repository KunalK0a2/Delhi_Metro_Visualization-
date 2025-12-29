/***********************
 * CSV LOADER
 ***********************/
async function loadCSV(path) {
  const text = await fetch(path).then(r => r.text());
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",");

  return lines.slice(1).map(line => {
    const values = [];
    let current = "";
    let inQuotes = false;

    for (let char of line) {
      if (char === '"') inQuotes = !inQuotes;
      else if (char === "," && !inQuotes) {
        values.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current);

    return Object.fromEntries(
      headers.map((h, i) => [h, values[i]?.replace(/"/g, "")])
    );
  });
}

/***********************
 * LINE COLORS
 ***********************/
const LINE_COLORS = {
  BLUE: "#2563eb",
  YELLOW: "#facc15",
  RED: "#ef4444",
  GREEN: "#22c55e",
  VIOLET: "#8b5cf6",
  PINK: "#ec4899",
  MAGENTA: "#d946ef",
  AQUA: "#06b6d4",
  ORANGE: "#f97316",
  "ORANGE/AIRPORT": "#f97316",
  RAPID: "#84cc16",
  GRAY: "#9ca3af"
};

function getLineKey(name) {
  if (!name) return null;
  return name.split("_")[0].toUpperCase();
}

/***********************
 * MAP INITIALIZATION
 ***********************/
const map = L.map("map", {
  center: [28.6139, 77.2090],
  zoom: 11
});

L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  { attribution: "&copy; OpenStreetMap &copy; CARTO" }
).addTo(map);

/***********************
 * GLOBAL STATE
 ***********************/
let selectedSource = null;
let selectedTarget = null;
let routeLayer = null;

/***********************
 * DRAW METRO LINES
 ***********************/
async function drawLines() {
  const routes = await loadCSV("/dmrc_gtfs/routes.txt");
  const trips = await loadCSV("/dmrc_gtfs/trips.txt");
  const shapes = await loadCSV("/dmrc_gtfs/shapes.txt");

  const routeIdToLine = {};
  routes.forEach(r => {
    routeIdToLine[r.route_id] = getLineKey(r.route_long_name);
  });

  const shapeToRoute = {};
  trips.forEach(t => {
    if (t.shape_id && !shapeToRoute[t.shape_id]) {
      shapeToRoute[t.shape_id] = t.route_id;
    }
  });

  const shapeGroups = {};
  shapes.forEach(p => {
    if (!shapeGroups[p.shape_id]) shapeGroups[p.shape_id] = [];
    shapeGroups[p.shape_id].push({
      lat: +p.shape_pt_lat,
      lon: +p.shape_pt_lon,
      seq: +p.shape_pt_sequence
    });
  });

  Object.entries(shapeGroups).forEach(([shapeId, points]) => {
    points.sort((a, b) => a.seq - b.seq);
    const latlngs = points.map(p => [p.lat, p.lon]);

    const routeId = shapeToRoute[shapeId];
    const lineKey = routeIdToLine[routeId];
    const color = LINE_COLORS[lineKey] || "#64748b";

    L.polyline(latlngs, {
      color,
      weight: 4,
      opacity: 0.9
    }).addTo(map);
  });
}

/***********************
 * DRAW STATIONS (CLICKABLE)
 ***********************/
async function drawStations() {
  const stops = await loadCSV("/dmrc_gtfs/stops.txt");
  const stopTimes = await loadCSV("/dmrc_gtfs/stop_times.txt");
  const trips = await loadCSV("/dmrc_gtfs/trips.txt");
  const routes = await loadCSV("/dmrc_gtfs/routes.txt");

  const tripToRoute = Object.fromEntries(
    trips.map(t => [t.trip_id, t.route_id])
  );

  const routeIdToLine = {};
  routes.forEach(r => {
    routeIdToLine[r.route_id] = getLineKey(r.route_long_name);
  });

  const stopLines = {};
  stopTimes.forEach(st => {
    const routeId = tripToRoute[st.trip_id];
    const lineKey = routeIdToLine[routeId];
    if (!lineKey) return;

    if (!stopLines[st.stop_id]) stopLines[st.stop_id] = new Set();
    stopLines[st.stop_id].add(lineKey);
  });

  stops.forEach(stop => {
    const lat = +stop.stop_lat;
    const lon = +stop.stop_lon;
    if (isNaN(lat) || isNaN(lon)) return;

    const linesHere = stopLines[stop.stop_id]
      ? Array.from(stopLines[stop.stop_id])
      : [];

    const baseColor = linesHere.length
      ? LINE_COLORS[linesHere[0]] || "#94a3b8"
      : "#94a3b8";

    const marker = L.circleMarker([lat, lon], {
      radius: linesHere.length > 1 ? 7 : 5,
      color: baseColor,
      fillColor: baseColor,
      fillOpacity: 1
    }).addTo(map);

    marker.bindPopup(
      `<b>${stop.stop_name}</b><br>${linesHere.join(", ")}`
    );

    marker.on("click", async () => {
      if (!selectedSource) {
        selectedSource = stop.stop_id;
        marker.setStyle({ color: "#22c55e", fillColor: "#22c55e" });
      } else if (!selectedTarget) {
        selectedTarget = stop.stop_id;
        marker.setStyle({ color: "#ef4444", fillColor: "#ef4444" });
        await drawShortestPath(selectedSource, selectedTarget);
      }
    });
  });
}

/***********************
 * BUILD GRAPH
 ***********************/
async function buildGraph() {
  const stopTimes = await loadCSV("/dmrc_gtfs/stop_times.txt");

  const tripStops = {};
  stopTimes.forEach(st => {
    if (!tripStops[st.trip_id]) tripStops[st.trip_id] = [];
    tripStops[st.trip_id].push({
      stop_id: st.stop_id,
      seq: +st.stop_sequence
    });
  });

  Object.values(tripStops).forEach(s =>
    s.sort((a, b) => a.seq - b.seq)
  );

  const graph = {};

  function addEdge(a, b) {
    if (!graph[a]) graph[a] = [];
    graph[a].push(b);
  }

  Object.values(tripStops).forEach(stops => {
    for (let i = 0; i < stops.length - 1; i++) {
      addEdge(stops[i].stop_id, stops[i + 1].stop_id);
      addEdge(stops[i + 1].stop_id, stops[i].stop_id);
    }
  });

  return graph;
}

/***********************
 * BFS SHORTEST PATH
 ***********************/
function bfs(graph, start, end) {
  const queue = [start];
  const visited = new Set([start]);
  const parent = {};

  while (queue.length) {
    const cur = queue.shift();
    if (cur === end) break;

    for (const next of graph[cur] || []) {
      if (!visited.has(next)) {
        visited.add(next);
        parent[next] = cur;
        queue.push(next);
      }
    }
  }

  const path = [];
  let curr = end;
  while (curr) {
    path.unshift(curr);
    curr = parent[curr];
  }

  return path;
}

/***********************
 * DRAW SHORTEST ROUTE
 ***********************/
async function drawShortestPath(source, target) {
  const graph = await buildGraph();
  const stops = await loadCSV("/dmrc_gtfs/stops.txt");

  const coords = {};
  stops.forEach(s => {
    coords[s.stop_id] = [+s.stop_lat, +s.stop_lon];
  });

  const path = bfs(graph, source, target);
  if (!path.length) return;

  const latlngs = path.map(id => coords[id]).filter(Boolean);

  if (routeLayer) map.removeLayer(routeLayer);

  routeLayer = L.polyline(latlngs, {
    color: "#ffffff",
    weight: 6,
    opacity: 1
  }).addTo(map);

  map.fitBounds(routeLayer.getBounds());
}

/***********************
 * RESET ON RIGHT CLICK
 ***********************/
map.on("contextmenu", () => {
  selectedSource = null;
  selectedTarget = null;
  if (routeLayer) map.removeLayer(routeLayer);
  routeLayer = null;
});

/***********************
 * INIT
 ***********************/
drawLines();
drawStations();

