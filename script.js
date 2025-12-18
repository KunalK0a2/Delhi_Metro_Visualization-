
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

function getLineKey(routeLongName) {
  if (!routeLongName) return null;
  return routeLongName.split("_")[0].toUpperCase();
}

 // MAP INITIALIZATION

const map = L.map("map", {
  center: [28.6139, 77.2090],
  zoom: 11,
  zoomControl: true
});

L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  {
    attribution: "&copy; OpenStreetMap &copy; CARTO"
  }
).addTo(map);


 //DRAW METRO LINES

async function drawLines() {
  const routes = await loadCSV("/dmrc_gtfs/routes.txt");
  const trips = await loadCSV("/dmrc_gtfs/trips.txt");
  const shapes = await loadCSV("/dmrc_gtfs/shapes.txt");

  // route_id → line key
  const routeIdToLine = {};
  routes.forEach(r => {
    routeIdToLine[r.route_id] = getLineKey(r.route_long_name);
  });

  // shape_id → route_id
  const shapeToRoute = {};
  trips.forEach(t => {
    if (t.shape_id && !shapeToRoute[t.shape_id]) {
      shapeToRoute[t.shape_id] = t.route_id;
    }
  });

  // group shape points
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
      opacity: 0.95
    }).addTo(map);
  });
}

/*************************
 * DRAW & COLOR STATIONS
 *************************/
async function drawStations() {
  const stops = await loadCSV("/dmrc_gtfs/stops.txt");
  const stopTimes = await loadCSV("/dmrc_gtfs/stop_times.txt");
  const trips = await loadCSV("/dmrc_gtfs/trips.txt");
  const routes = await loadCSV("/dmrc_gtfs/routes.txt");

  // trip_id → route_id
  const tripToRoute = Object.fromEntries(
    trips.map(t => [t.trip_id, t.route_id])
  );

  // route_id → line key
  const routeIdToLine = {};
  routes.forEach(r => {
    routeIdToLine[r.route_id] = getLineKey(r.route_long_name);
  });

  // stop_id → Set of line keys
  const stopLines = {};

  stopTimes.forEach(st => {
    const routeId = tripToRoute[st.trip_id];
    const lineKey = routeIdToLine[routeId];
    if (!lineKey) return;

    if (!stopLines[st.stop_id]) {
      stopLines[st.stop_id] = new Set();
    }
    stopLines[st.stop_id].add(lineKey);
  });

  stops.forEach(stop => {
    const lat = +stop.stop_lat;
    const lon = +stop.stop_lon;
    if (isNaN(lat) || isNaN(lon)) return;

    const linesHere = stopLines[stop.stop_id]
      ? Array.from(stopLines[stop.stop_id])
      : [];

    const color = linesHere.length
      ? LINE_COLORS[linesHere[0]] || "#94a3b8"
      : "#94a3b8";

    L.circleMarker([lat, lon], {
      radius: linesHere.length > 1 ? 7 : 5,
      color,
      fillColor: color,
      fillOpacity: 1
    })
      .addTo(map)
      .bindPopup(
        `<b>${stop.stop_name} ${stop.stop_id}</b><br>${linesHere.join(", ")}`
      );
  });
}

drawLines();
drawStations();

async function buildGraph() {
  const stopTimes = await loadCSV("/dmrc_gtfs/stop_times.txt");
  const trips = await loadCSV("/dmrc_gtfs/trips.txt");

  // trip_id → ordered stops
  const tripStops = {};

  stopTimes.forEach(st => {
    if (!tripStops[st.trip_id]) {
      tripStops[st.trip_id] = [];
    }
    tripStops[st.trip_id].push({
      stop_id: st.stop_id,
      seq: +st.stop_sequence
    });
  });

  // sort each trip by sequence
  Object.values(tripStops).forEach(stops => {
    stops.sort((a, b) => a.seq - b.seq);
  });

  // adjacency list
  const graph = {};

  function addEdge(a, b) {
    if (!graph[a]) graph[a] = [];
    graph[a].push({ to: b, weight: 1 });
  }

  // build graph edges
  Object.values(tripStops).forEach(stops => {
    for (let i = 0; i < stops.length - 1; i++) {
      const from = stops[i].stop_id;
      const to = stops[i + 1].stop_id;

      addEdge(from, to);
      addEdge(to, from); // metro is bidirectional
    }
  });

  return graph;
}

function bfs(graph, start, end) {
  const queue = [start];
  const visited = new Set([start]);
  const parent = {};

  while (queue.length > 0) {
    const current = queue.shift();

    if (current === end) break;

    for (const edge of graph[current] || []) {
      const next = edge.to;

      if (!visited.has(next)) {
        visited.add(next);
        parent[next] = current;
        queue.push(next);
      }
    }
  }

  // Reconstruct path
  const path = [];
  let curr = end;

  while (curr) {
    path.unshift(curr);
    curr = parent[curr];
  }

  return path;
}

async function testBFS(source, target) {
  const graph = await buildGraph();

  // Use real stop_ids from your GTFS
  //const source = '50';   // Rajiv Chowk
  //const target = '57';   // AIIMS

  const path = bfs(graph, source, target);
  console.log("BFS path:", path);
  //console.log("Neighbors of source: ", graph['50'])
}

async function drawBFSPath(){
    const graph = await buildGraph();
    const stops = await loadCSV("/dmrc_gtfs/stops.txt");

    const coords = {};
    stops.forEach(s => {
        coords[s.stop_id] = [+s.stop_lat, +s.stop_lon];
    });

    const source = '1';
    const target = '58';
    
    const path = bfs(graph,source,target);
    const latlngs = path.map(id => coords[id].filter(Boolean));

    L.polyline(latlngs, {
        color: "ffffff",
        weight: 6,
        opacity: 1
    }).addTo(map);
}
drawBFSPath();



