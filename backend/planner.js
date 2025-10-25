// planner.js — returns a concrete pipeline_spec the executor understands
import dotenv from 'dotenv';
dotenv.config();

/**
 * Build a minimal, reliable spec for:
 * - Overpass (OSM) -> restaurants near origin
 * - OSRM Table     -> ETA from origin to each restaurant
 * - Open-Meteo     -> current temp + precipitation per restaurant (fanout, capped)
 * - Transforms     -> join, compute OSM-based "quality", overall score, top_n, correlation
 *
 * Adds user-friendly 'name' fields for the frontend.
 *
 * @param {{goal?: string, context?: any, useMocks?: boolean}} params
 * @returns {Promise<object>} pipeline_spec
 */
export async function plan({ goal = '', context = {}, useMocks = false } = {}) {
  // 1) Validate/normalize context
  const originStr = (context.origin || '').toString().trim();
  const radius_m = Number.isFinite(Number(context.radius_m)) ? Number(context.radius_m) : 800; // Keep 800m default

  if (!originStr || !originStr.includes(',')) {
    console.warn('[PLANNER] Warning: context.origin "lat,lon" missing or invalid. Using default.');
    // Default to Berkeley if origin is bad, prevent error
    context.origin = '37.8715,-122.2730';
  }
  const [latStr, lonStr] = context.origin.split(',').map(s => s.trim());
  const lat = Number(latStr);
  const lon = Number(lonStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
     console.error(`[PLANNER] Error: Invalid context.origin coordinates: ${context.origin}`);
     throw new Error('planner: invalid context.origin coordinates');
  }


  const OVERPASS_URL = 'https://overpass.kumi.systems/api/interpreter';
  const WEATHER_FANOUT_MAX = 12;

  // 2) Compose the Overpass QL
  const overpassData = [
    '[out:json][timeout:25];',
    `node["amenity"="restaurant"](around:${radius_m},${lat},${lon});`,
    'out;'
  ].join('\n');

  // 3) Build a concrete pipeline spec
  const spec = {
    nodes: [
      // ---- N1: Overpass (OSM) ----
      {
        id: 'n1_overpass',
        name: 'Find Restaurants (OSM)', // User-friendly name
        type: 'http',
        provider: 'overpass.interpreter',
        method: 'POST',
        url: OVERPASS_URL,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: { data: overpassData },
        map: {
          name: '$.elements[*].tags.name',
          lat: '$.elements[*].lat',
          lon: '$.elements[*].lon',
          cuisine: '$.elements[*].tags.cuisine',
          opening_hours: '$.elements[*].tags.opening_hours',
          outdoor_seating: '$.elements[*].tags.outdoor_seating',
          wheelchair: '$.elements[*].tags.wheelchair',
          address: "$.elements[*].tags['addr:street']",
        },
        retry: { times: 2, backoff_ms: 300 },
        timeout_ms: 9000,
        status: 'pending' // Initial status
      },
      // ---- N2: OSRM Table (ETA) ----
      {
        id: 'n2_eta',
        name: 'Calculate ETA (OSRM)', // User-friendly name
        type: 'http',
        provider: 'osrm.table',
        method: 'GET',
        url: 'https://router.project-osrm.org/table/v1/driving/{{compose.dest_coords_csv}}',
        params: { sources: '0' },
        compose: {
          dest_coords_csv: '{{join_coords(outputs.n1_overpass.lat, outputs.n1_overpass.lon)}}',
        },
        map: { eta_seconds: '$.durations[0][*]' },
        retry: { times: 2, backoff_ms: 300 },
        timeout_ms: 4000,
        status: 'pending' // Initial status
      },
      // ---- N3: Open-Meteo (fanout) ----
      {
        id: 'n3_weather',
        name: 'Get Weather', // User-friendly name
        type: 'http',
        provider: 'open_meteo.forecast',
        method: 'GET',
        url: 'https://api.open-meteo.com/v1/forecast',
        params: {
          latitude: '{{lat}}',
          longitude: '{{lon}}',
          current: 'temperature_2m,precipitation'
        },
        fanout: {
          over: 'outputs.n1_overpass',
          max: WEATHER_FANOUT_MAX,
          mapping: { lat: 'lat', lon: 'lon' }
        },
        map: {
          temp_c: '$.current.temperature_2m',
          precip: '$.current.precipitation'
        },
        retry: { times: 1, backoff_ms: 200 },
        timeout_ms: 2500,
        status: 'pending' // Initial status
      },
      // ---- T1: Join arrays ----
      {
        id: 't1_join',
        name: 'Combine Data', // User-friendly name
        type: 'transform',
        fn: 'join_on_index',
        args: {
          left: 'outputs.n1_overpass',
          rightArrays: [
            'outputs.n2_eta.eta_seconds',
            'outputs.n3_weather.precip',
            'outputs.n3_weather.temp_c',
          ],
          rightKeys: ['eta_seconds', 'precip', 'temp_c'],
        },
        status: 'pending' // Initial status
      },
      // ---- T_QUALITY: Compute heuristic OSM quality ----
      {
        id: 't_osm_quality',
        name: 'Assess Quality', // User-friendly name
        type: 'transform',
        fn: 'compute_osm_quality',
        args: {
          from: 'outputs.t1_join',
          fields: { /* ... */ },
        },
        status: 'pending' // Initial status
      },
      // ---- T2: Compute combined score ----
      {
        id: 't2_score',
        name: 'Calculate Score', // User-friendly name
        type: 'transform',
        fn: 'compute_score',
        args: {
          from: 'outputs.t_osm_quality',
          // ... other args
        },
        status: 'pending' // Initial status
      },
      // ---- T3: Top N ----
      {
        id: 't3_top',
        name: 'Rank Top 5', // User-friendly name
        type: 'transform',
        fn: 'top_n',
        args: {
          from: 'outputs.t2_score',
          n: 5, /* ... */
        },
        status: 'pending' // Initial status
      },
      // ---- T4: Correlation ----
      {
        id: 't4_corr',
        name: 'Analyze Correlation', // User-friendly name
        type: 'transform',
        fn: 'correlation',
        args: { /* ... */ },
        status: 'pending' // Initial status
      },
    ],
    // --- EDGES --- Define dependencies for visualization
    edges: [
        { from: 'n1_overpass', to: 'n2_eta', status: 'pending' }, // ETA depends on Overpass lat/lon
        { from: 'n1_overpass', to: 'n3_weather', status: 'pending' }, // Weather depends on Overpass lat/lon
        { from: 'n1_overpass', to: 't1_join', status: 'pending' },
        { from: 'n2_eta', to: 't1_join', status: 'pending' },
        { from: 'n3_weather', to: 't1_join', status: 'pending' },
        { from: 't1_join', to: 't_osm_quality', status: 'pending' },
        { from: 't_osm_quality', to: 't2_score', status: 'pending' },
        { from: 't_osm_quality', to: 't4_corr', status: 'pending' }, // Correlation needs quality
        { from: 'n2_eta', to: 't4_corr', status: 'pending' }, // Correlation needs ETA
        { from: 't2_score', to: 't3_top', status: 'pending' },
    ],
    limits: { max_items: 50 },
    observability: { emit_sse: true },
    hints: [
      useMocks ? 'Running with mock data.' : 'Overpass mirror + smaller radius for speed.',
    ],
    _decision: [ /* ... decision log ... */ ],
    _origin: { lat, lon },
  };

  // Assign args to transforms that were simplified above
   spec.nodes.find(n => n.id === 't_osm_quality').args.fields = { cuisine: 'cuisine', opening_hours: 'opening_hours', outdoor_seating: 'outdoor_seating', wheelchair: 'wheelchair' };
   spec.nodes.find(n => n.id === 't2_score').args = { from: 'outputs.t_osm_quality', ratingKey: 'quality', etaKey: 'eta_seconds', precipKey: 'precip' };
   spec.nodes.find(n => n.id === 't4_corr').args = { xFrom: 'outputs.t_osm_quality.quality[*]', yFrom: 'outputs.n2_eta.eta_seconds' };

   // Add the decision log
    spec._decision = [
      'Use Overpass (OSM) to list restaurants within radius.',
      'Use OSRM Table for ETA (free, fast).',
      'Use Open-Meteo for current precipitation (mm) + temperature.',
      "Compute 'quality' from OSM tags, then score = quality - scaled(ETA) - rain_penalty."
    ];


  return spec;
}