// planner.js — Reliable Fallback (Guaranteed to run without LLM)

function parseLatLon(originStr) {
    const parts = String(originStr).split(',').map(s => s.trim());
    const lat = Number(parts[0]);
    const lon = Number(parts[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(lon)) return { lat, lon };
    return { lat: 37.8715, lon: -122.2730 }; // Default to Berkeley
}

function buildDefaultSpec({ origin, radius_m, useMocks }) {
    const radius = Number(radius_m || 800);
    const overpassQL = `[out:json][timeout:25];\nnode["amenity"="restaurant"](around:${radius},${origin.lat},${origin.lon});\nout;`;

    const decision = [
        "Planner is using the RELIABLE FALLBACK (LLM planning disabled/failed).",
        "Querying Overpass (OSM) for local amenities.",
        "Calculating ETA via OSRM, then merging weather/quality data."
    ];

    return {
        nodes: [
            // [N1] Find Restaurants (OSM)
            { id: 'n1_overpass', name: 'Find Restaurants (OSM)', type: 'http', provider: 'overpass.interpreter', method: 'POST', url: 'https://overpass.kumi.systems/api/interpreter', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: { data: overpassQL }, map: { name: '$.elements[*].tags.name', lat: '$.elements[*].lat', lon: '$.elements[*].lon', cuisine: '$.elements[*].tags.cuisine', opening_hours: '$.elements[*].tags.opening_hours', outdoor_seating: '$.elements[*].tags.outdoor_seating', wheelchair: '$.elements[*].tags.wheelchair', address: "$.elements[*].tags['addr:street']" }, retry: { times: 2, backoff_ms: 300 }, timeout_ms: 9000 },
            
            // [N2] Calculate ETA (OSRM)
            { id: 'n2_eta', name: 'Calculate ETA (OSRM)', type: 'http', provider: 'osrm.table', method: 'GET', url: 'https://router.project-osrm.org/table/v1/driving/{{compose.dest_coords_csv}}', params: { sources: '0' }, compose: { dest_coords_csv: '{{join_coords(outputs.n1_overpass.lat, outputs.n1_overpass.lon)}}' }, map: { eta_seconds: '$.durations[0][*]' }, retry: { times: 2, backoff_ms: 300 }, timeout_ms: 4000 },
            
            // [N3] Get Weather (Open-Meteo)
            { id: 'n3_weather', name: 'Get Weather', type: 'http', provider: 'open_meteo.forecast', method: 'GET', url: 'https://api.open-meteo.com/v1/forecast', params: { latitude: '{{lat}}', longitude: '{{lon}}', current: 'temperature_2m,precipitation' }, fanout: { over: 'outputs.n1_overpass', max: 12, mapping: { lat: 'lat', lon: 'lon' } }, map: { temp_c: '$.current.temperature_2m', precip: '$.current.precipitation' }, retry: { times: 1, backoff_ms: 200 }, timeout_ms: 2500 },
            
            // [T1] Combine Data
            { id: 't1_join', name: 'Combine Data', type: 'transform', fn: 'join_on_index', args: { left: 'outputs.n1_overpass', rightArrays: ['outputs.n2_eta.eta_seconds', 'outputs.n3_weather.precip', 'outputs.n3_weather.temp_c'], rightKeys: ['eta_seconds', 'precip', 'temp_c'] } },
            
            // [T_Q] Assess Quality
            { id: 't_osm_quality', name: 'Assess Quality', type: 'transform', fn: 'compute_osm_quality', args: { from: 'outputs.t1_join', fields: { cuisine: 'cuisine', opening_hours: 'opening_hours', outdoor_seating: 'outdoor_seating', wheelchair: 'wheelchair' } } },
            
            // [T2] Calculate Score
            { id: 't2_score', name: 'Calculate Score', type: 'transform', fn: 'compute_score', args: { from: 'outputs.t_osm_quality', ratingKey: 'quality', etaKey: 'eta_seconds', precipKey: 'precip' } },
            
            // [T3] Rank Top 5
            { id: 't3_top', name: 'Rank Top 5', type: 'transform', fn: 'top_n', args: { from: 'outputs.t2_score', n: 5, by: 'score', desc: true } },
            
            // [T4] Correlation
            { id: 't4_corr', name: 'Analyze Correlation', type: 'transform', fn: 'correlation', args: { xFrom: 'outputs.t_osm_quality.quality[*]', yFrom: 'outputs.n2_eta.eta_seconds' } },
        ],
        limits: { max_items: 50 },
        observability: { emit_sse: true },
        hints: [ useMocks ? 'Running with mock data.' : 'All-free stack. Execution speed optimized by reducing fanout.' ],
        _decision: decision,
        _origin: origin,
    };
    return spec;
}

export async function plan({ goal = '', context = {}, useMocks = false } = {}) {
    const origin = parseLatLon(context.origin || '37.8715,-122.2730');
    const radius_m = Number.isFinite(Number(context.radius_m)) ? Number(context.radius_m) : 800;
    
    return buildDefaultSpec({ origin, radius_m, useMocks });
}