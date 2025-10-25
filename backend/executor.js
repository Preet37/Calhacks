// executor.js (emits frontend-compatible SSE events with state)
import axios from 'axios';
import { JSONPath } from 'jsonpath-plus';

// --- Utils ---
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();
const noop = () => {};
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function resolveExpr(scope, expr) { /* ... keep existing ... */
    if (!expr || typeof expr !== 'string') return expr;
    const parts = expr.split('.');
    let cur = scope;
    for (const p of parts) {
        if (cur == null) return undefined;
        cur = cur[p];
    }
    return cur;
}
function resolvePathLike(scope, expr) { /* ... keep existing ... */
    if (typeof expr !== "string") return expr;
    if (expr.startsWith("$.") || expr.startsWith("$[")) {
        // Handle potential errors if scope is not valid JSON for JSONPath
        try {
            return JSONPath({ path: expr, json: scope });
        } catch (e) {
            // console.warn(`JSONPath error for "${expr}": ${e.message}`);
            return undefined; // Or return an empty array/default value
        }
    }
    const parts = expr.split(".");
    let cur = scope;
    for (const p of parts) {
        if (cur == null) return undefined;
        cur = cur[p];
    }
    return cur;
}
function interpolate(template, scope) { /* ... keep existing ... */
    if (!template || typeof template !== "string") return template;

    return template.replace(/\{\{([^}]+)\}\}/g, (_m, code) => {
        const call = code.trim();

        // join_coords(outputs.n1.lat, outputs.n1.lon)
        const joinMatch = call.match(/^join_coords\(([^,]+),\s*([^)]+)\)\s*$/);
        if (joinMatch) {
        const latPath = joinMatch[1].trim();
        const lonPath = joinMatch[2].trim();
        const lats = resolvePathLike(scope, latPath);
        const lons = resolvePathLike(scope, lonPath);
        if (Array.isArray(lats) && Array.isArray(lons)) {
            const pairs = [];
            // OSRM needs origin first if sources=0, then destinations
            let originCoords = '';
            if (scope._origin && scope._origin.lon != null && scope._origin.lat != null) {
                 originCoords = `${scope._origin.lon},${scope._origin.lat}`;
            }
             if (originCoords) pairs.push(originCoords); // Add origin if available

            for (let i = 0; i < Math.min(lats.length, lons.length); i++) {
                // OSRM expects lon,lat order
                if (lons[i] != null && lats[i] != null) { // Check for nulls
                     pairs.push(`${lons[i]},${lats[i]}`);
                }
            }
             // OSRM needs origin coord only once if sources=0 is used in params
            const destCoords = pairs.slice(originCoords ? 1 : 0); // Remove origin if added
            // Ensure we use the origin coord from context if passed directly
             const finalOrigin = originCoords || (scope.context?.origin ? String(scope.context.origin).split(',').reverse().join(',') : ''); // lon,lat
            // Return only destinations if origin is implicit via sources=0
            return destCoords.join(";");
            // If sources param wasn't used, would return: finalOrigin + ';' + destCoords.join(";")

        }
        return "";
        }

        // plain dotted path or JSONPath
        const val = resolvePathLike(scope, call);
        if (val == null) return "";
        return String(val);
    });
}
function applyMap(json, map) { /* ... keep existing ... */
    if (!map || !isObj(map)) return json;
    const out = {};
    for (const [k, jp] of Object.entries(map)) {
        try {
            // Use jsonpath-plus which returns an array
             const result = JSONPath({ path: jp, json: json, wrap: false });
             // If result is undefined or null, keep it as null/undefined, otherwise assign
             out[k] = result === undefined ? null : result;
           } catch (e) {
             console.warn(`  [MAP WARN] JSONPath error for key "${k}" path "${jp}": ${e.message}`);
             out[k] = null; // Assign null on error
           }
    }
    return out;
}
function asRows(input) { /* ... keep existing ... */
    if (Array.isArray(input)) return input; // Already rows
    // Check if input is the columnar output format { key: [val1, val2], key2: [v1, v2] }
    if (isObj(input) && Object.values(input).every(Array.isArray)) {
        const keys = Object.keys(input);
        if (keys.length === 0) return [];
        const firstKey = keys[0];
        const len = input[firstKey].length;
        // Check if all arrays have the same length
        if (!keys.every(k => input[k].length === len)) {
             console.warn('[ASROWS WARN] Columnar input has arrays of different lengths. Truncating to shortest.');
             const minLen = keys.reduce((min, k) => Math.min(min, input[k].length), Infinity);
             const rows = [];
             for (let i = 0; i < minLen; i++) {
                const row = {};
                for (const k of keys) row[k] = input[k][i];
                rows.push(row);
             }
             return rows;
        }

        // All lengths match, proceed
        const rows = [];
        for (let i = 0; i < len; i++) {
            const row = {};
            for (const k of keys) row[k] = input[k][i];
            rows.push(row);
        }
        return rows;
    }
    // If not rows and not columns, return empty array
    console.warn('[ASROWS WARN] Input is neither rows nor valid columns. Returning []. Input:', input);
    return [];
}


// --- Transforms ---
function t_join_on_index(left, rightArrays, rightKeys) { /* ... keep existing (uses asRows) ... */
    const leftRows = asRows(left);
     // Ensure rightArrays are actually arrays
     const validRightArrays = (rightArrays || []).map(arr => Array.isArray(arr) ? arr : []);
    return leftRows.map((row, i) => {
        const extra = {};
        validRightArrays.forEach((arr, idx) => {
            const key = rightKeys?.[idx];
            if (key) { // Only add if key exists
                extra[key] = arr[i]; // Access element by index, handles undefined if array is shorter
            }
        });
        return { ...row, ...extra };
    });
}
function t_compute_osm_quality(arr, fields) { /* ... keep existing (uses asRows) ... */
     const rows = asRows(arr); // Ensure input is rows
     const f = fields || {};
     const yes = (v) => String(v || "").toLowerCase() === "yes";
     return rows.map((row) => {
       let q = 3.5;
       if (row?.[f.cuisine ?? "cuisine"]) q += 0.6;
       if (row?.[f.opening_hours ?? "opening_hours"]) q += 0.4;
       if (yes(row?.[f.outdoor_seating ?? "outdoor_seating"])) q += 0.2;
       if (yes(row?.[f.wheelchair ?? "wheelchair"])) q += 0.2;
       if (q > 5) q = 5;
       return { ...row, quality: q };
     });
}
function t_compute_score(arr, { ratingKey = "quality", etaKey = "eta_seconds", precipKey = "precip" } = {}) { /* ... keep existing (uses asRows) ... */
     const rows = asRows(arr); // Ensure input is rows
     return rows.map((row) => {
       const scaledEta = (Number(row?.[etaKey]) || 0) / 600; // 10 min scale, ensure number
       // Use precipKey (mm), simple penalty: 0.1 per mm, capped at 1.0 penalty
       const precipValue = Number(row?.[precipKey]) || 0; // ensure number
       const rain = Math.min(1.0, precipValue * 0.1); // Adjust penalty logic if needed
       const rating = Number(row?.[ratingKey]) || 0; // ensure number
       // Score is quality minus time penalty minus rain penalty
       return { ...row, score: rating - scaledEta - rain };
     });
}
function t_top_n(arr, { n = 5, by = "score", desc = true } = {}) { /* ... keep existing (uses asRows) ... */
     const rows = asRows(arr); // Ensure input is rows
     const s = [...rows].sort((a, b) => {
         const valA = Number(a?.[by]) || 0; // Ensure numbers for sorting
         const valB = Number(b?.[by]) || 0;
         return desc ? valB - valA : valA - valB;
     });
     return s.slice(0, n);
}
function t_correlation(xs, ys) { /* ... keep existing ... */
    const X = Array.isArray(xs) ? xs.map(Number).filter(n => !isNaN(n)) : []; // Ensure numbers
    const Y = Array.isArray(ys) ? ys.map(Number).filter(n => !isNaN(n)) : []; // Ensure numbers
    const n = Math.min(X.length, Y.length);
    if (n < 2) return 0; // Need at least 2 points for correlation

    const mean = (a) => a.reduce((s, x) => s + x, 0) / n; // Use n based on matched pairs
    const mx = mean(X.slice(0, n));
    const my = mean(Y.slice(0, n));

    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
        const vx = X[i] - mx;
        const vy = Y[i] - my;
        num += vx * vy;
        dx += vx * vx;
        dy += vy * vy;
    }
    const den = Math.sqrt(dx * dy);
    // Avoid division by zero if variance is zero
    return den > 1e-6 ? num / den : 0;
}


// --- HTTP Runner ---
function mockFor(node) { /* ... keep existing ... */
    if (node.id === "n1_overpass") {
        const names = Array.from({ length: 8 }, (_, i) => `Mock Place ${i + 1}`);
        const lat0 = 37.8715, lon0 = -122.2730;
        const lat = names.map((_, i) => lat0 + 0.005 * Math.sin(i));
        const lon = names.map((_, i) => lon0 + 0.005 * Math.cos(i));
        const cuisine = ["mexican","thai","pizza","japanese","indian","chinese","vietnamese","mediterranean"];
        const opening_hours = ["Mo-Su 11:00-22:00","","Mo-Su 10:00-20:00","Mo-Su 11:30-21:30","","","",""];
        const outdoor_seating = ["yes","","yes","","yes","","","yes"];
        const wheelchair = ["yes","yes","","","yes","","",""];
        const address = names.map((_,i)=>`${2000+i} University Ave`);
        return { name: names, lat, lon, cuisine, opening_hours, outdoor_seating, wheelchair, address };
    }
    if (node.id === "n2_eta") {
        return { eta_seconds: Array.from({ length: 8 }, (_, i) => 240 + 40 * i) };
    }
    if (node.id === "n3_weather") {
         // Match the updated spec: temp_c and precip (mm)
        return {
            temp_c: Array.from({ length: 8 }, () => Number((17 + Math.random() * 3).toFixed(1))),
            precip: Array.from({ length: 8 }, () => Number((Math.random() * 1.5).toFixed(1))) // 0 to 1.5 mm
        };
    }
    return {};
}

async function runHttpNode(node, scope, useMocks) {
    const nodeConsoleId = `HTTP ${node.name || node.id}`; // Use friendly name if available
    console.log(`  [${nodeConsoleId}] Running. Mocks: ${useMocks}`);
    if (useMocks) {
        await sleep(50 + Math.random() * 50); // Slightly randomized mock delay
        const mock = mockFor(node);
        console.log(`  [${nodeConsoleId}] Mock data generated.`);
        return { data: mock, attempts: 1, fallbackUsed: false }; // Return structure includes attempts/fallback
    }

    // --- Real call logic ---
    let attempts = 0;
    const maxRetries = node.retry?.times ?? 0;
    const backoff = node.retry?.backoff_ms ?? 100;

    while (attempts <= maxRetries) {
        attempts++;
        try {
            // (Keep existing compose/interpolate logic to build config)
            const compiled = { /* ... */ }; // Build url, params, headers, body using interpolate
              compiled.url = node.url;
              compiled.params= node.params ? { ...node.params } : undefined;
              compiled.headers= node.headers ? { ...node.headers } : undefined;
              compiled.body= node.body ? { ...node.body } : undefined;

              // Expand compose fields FIRST
              if (node.compose && isObj(node.compose)) {
                const tmp = {};
                for (const [k, v] of Object.entries(node.compose)) {
                  // Pass _origin from spec into scope if available
                  const currentScope = { ...scope, _origin: spec._origin, context: scope.context };
                  tmp[k] = interpolate(String(v), currentScope);
                }
                // Update scope for subsequent interpolations
                scope.compose = tmp;
              }

             // Interpolate url, params, headers, body using the potentially updated scope
              const finalScope = { ...scope, context: scope.context }; // Ensure context is passed
              compiled.url = interpolate(compiled.url, finalScope);
              if (compiled.params) {
                for (const [k, v] of Object.entries(compiled.params)) {
                  compiled.params[k] = interpolate(String(v), finalScope);
                }
              }
              if (compiled.headers) {
                 for (const [k, v] of Object.entries(compiled.headers)) {
                   compiled.headers[k] = interpolate(String(v), finalScope);
                 }
              }
              if (compiled.body) {
                 for (const [k, v] of Object.entries(compiled.body)) {
                   compiled.body[k] = interpolate(String(v), finalScope);
                 }
              }


            const method = (node.method || 'GET').toUpperCase();
            const timeout = node.timeout_ms || 9000;
            const config = { method, url: compiled.url, headers: compiled.headers, params: compiled.params, timeout, validateStatus: (s) => s >= 200 && s < 300 };
            if (method === 'POST') { /* ... handle body encoding ... */
                if (compiled.headers && /application\/x-www-form-urlencoded/i.test(compiled.headers["Content-Type"] || "")){
                     const qs = new URLSearchParams(compiled.body || {}).toString();
                     config.data = qs;
                } else {
                     config.data = compiled.body;
                }
            }


            console.log(`  [${nodeConsoleId}] Attempt ${attempts}: ${method} ${config.url}`);
            const resp = await axios(config);
            console.log(`  [${nodeConsoleId}] Attempt ${attempts} successful. Status: ${resp.status}`);
            const mappedData = applyMap(resp.data, node.map);
            return { data: mappedData, attempts, fallbackUsed: false };

        } catch (error) {
            console.warn(`  [${nodeConsoleId}] Attempt ${attempts} FAILED. Error: ${error.message}`);
            if (attempts > maxRetries) {
                // Handle fallback if defined, otherwise re-throw
                if (node.fallback) { // Basic fallback - assumes same structure/map
                    console.warn(`  [${nodeConsoleId}] Retries exhausted. Trying fallback...`);
                    // Simplified: Add proper fallback execution logic if needed
                    // For now, just indicate failure after retries
                     throw new Error(`Node ${node.id} failed after ${attempts} attempts: ${error.message}`);
                } else {
                    throw error; // Re-throw if no fallback
                }
            }
            await sleep(backoff * Math.pow(2, attempts - 1)); // Exponential backoff
        }
    }
     // Should not be reached if maxRetries >= 0, but acts as a final failure point
     throw new Error(`Node ${node.id} failed unexpectedly after all retries.`);
}


// --- Transform Runner ---
function runTransformNode(node, outputs) {
    const nodeConsoleId = `TRANSFORM ${node.name || node.id}`;
    console.log(`  [${nodeConsoleId}] Running function: ${node.fn}`);
    const t0 = now();
    try {
        let result;
        // (Keep existing switch statement for transform functions)
        const fn = node.fn;
        if (fn === 'join_on_index') {
            const left = resolvePathLike({ outputs }, node.args?.left) ?? [];
            const rightArrays = (node.args?.rightArrays || []).map(p => resolvePathLike({ outputs }, p));
            const rightKeys = node.args?.rightKeys || [];
            result = t_join_on_index(left, rightArrays, rightKeys);
        } else if (fn === 'compute_osm_quality') {
            const arr = resolvePathLike({ outputs }, node.args?.from || 'outputs.t1_join') ?? [];
            result = t_compute_osm_quality(arr, node.args?.fields);
        } else if (fn === 'compute_score') {
            const arr = resolvePathLike({ outputs }, node.args?.from || 'outputs.t_osm_quality') ?? [];
            result = t_compute_score(arr, {
                ratingKey: node.args?.ratingKey || 'quality',
                etaKey: node.args?.etaKey || 'eta_seconds',
                precipKey: node.args?.precipKey || 'precip',
            });
        } else if (fn === 'top_n') {
            const arr = resolvePathLike({ outputs }, node.args?.from || 'outputs.t2_score') ?? [];
            result = t_top_n(arr, {
                n: node.args?.n ?? 5,
                by: node.args?.by || 'score',
                desc: node.args?.desc !== false,
            });
        } else if (fn === 'correlation') {
            let xs = resolvePathLike({ outputs }, node.args?.xFrom);
            let ys = resolvePathLike({ outputs }, node.args?.yFrom);
            result = t_correlation(xs, ys);
        } else {
             console.warn(`  [${nodeConsoleId}] Unknown function ${fn}, returning input.`);
             result = resolvePathLike({ outputs }, node.args?.from) ?? null;
        }

        const duration = now() - t0;
        console.log(`  [${nodeConsoleId}] OK. Duration: ${duration}ms`);
        return { data: result, duration }; // Return duration along with data
    } catch (error) {
        const duration = now() - t0;
        console.error(`  [${nodeConsoleId}] FAILED. Duration: ${duration}ms, Error: ${error.message}`);
        throw error; // Re-throw
    }
}


// --- Main Runner ---
export async function executePipeline(spec, ctx = {}) {
  const publish = ctx.publish || noop; // Use publish passed from server.js
  const useMocks = ctx.useMocks ?? false;
  console.log(`[EXECUTOR START] Mocks: ${useMocks}. Nodes: ${spec?.nodes?.length}`);

  const outputs = {};
  const runLog = [];
  const errors = [];
  // Clone spec to allow modifications (adding latency, updating status)
  const nodes = spec.nodes.map(n => ({ ...n, status: 'pending', latency_ms: undefined })); // Ensure all start pending
  const edges = spec.edges.map(e => ({ ...e, status: 'pending' })); // Ensure edges start pending
  const scope = { outputs, context: ctx.context || {}, _origin: spec._origin }; // Pass origin for join_coords

  if (!spec || !Array.isArray(nodes)) {
    throw new Error("executePipeline requires a spec with a nodes array.");
  }

  let apiCalls = 0; // Count actual API calls made

  // Helper to get current state for SSE events
  const getCurrentState = () => ({ nodes, edges });

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const t0 = now();

    // Update node status to running
    node.status = 'running';
    // Update incoming edge statuses (optional, for visual feedback)
    edges.forEach(edge => { if (edge.to === node.id) edge.status = 'running'; });

    publish('node_start', { nodeId: node.id, state: getCurrentState() });
    console.log(`[NODE START ${node.name || node.id}] Type: ${node.type}`);

    try {
      let resultData;
      let attempts = 1;
      let fallbackUsed = false;
      let nodeDuration = 0;

      if (node.type === 'http') {
        apiCalls++;
        if (node.fanout?.over) {
            console.log(`  [FANOUT ${node.name || node.id}] Over: ${node.fanout.over}, Max: ${node.fanout.max}`);
            const baseArr = asRows(resolvePathLike(scope, node.fanout.over) || []);
            const cap = Math.min(node.fanout.max || baseArr.length, baseArr.length);
            const mapping = node.fanout.mapping || {};
            const fanoutResults = []; // Store { data, attempts, fallbackUsed } for each call
            console.log(`  [FANOUT ${node.name || node.id}] Executing ${cap} parallel calls.`);

            const promises = [];
            for (let j = 0; j < cap; j++) {
                const item = baseArr[j];
                const subScope = {
                  ...scope,
                  ...Object.fromEntries(
                    Object.entries(mapping).map(([k, v]) => [k, item?.[v]])
                  ),
                };
                 // Wrap in a promise that includes retry logic and returns the result structure
                promises.push(
                    (async () => {
                        if (!useMocks) await sleep(50 + Math.random() * 50); // Small polite delay only for live
                        return runHttpNode(node, subScope, useMocks); // runHttpNode now handles retries
                    })()
                );
            }
            const settled = await Promise.allSettled(promises);
            console.log(`  [FANOUT ${node.name || node.id}] ${settled.length} calls settled.`);

            // Merge results and track max attempts/fallback usage
            const merged = {};
            let fanoutErrorsCount = 0;
            let maxAttempts = 1;
            let anyFallback = false;

            for (let j = 0; j < settled.length; j++) {
                const s = settled[j];
                if (s.status === 'fulfilled') {
                    const { data: r, attempts: callAttempts, fallbackUsed: callFallback } = s.value;
                    fanoutResults.push({ data: r, attempts: callAttempts, fallbackUsed: callFallback });
                    maxAttempts = Math.max(maxAttempts, callAttempts);
                    if (callFallback) anyFallback = true;

                    // Merge columns
                    for (const [k, val] of Object.entries(r || {})) {
                        if (!merged[k]) merged[k] = new Array(cap).fill(null);
                        // Ensure val is treated correctly (might be scalar or array from map)
                        merged[k][j] = Array.isArray(val) ? val[0] : val;
                    }
                } else {
                     console.error(`  [FANOUT ${node.name || node.id}] Call ${j} failed: ${s.reason?.message}`);
                     errors.push({ node_id: `${node.id}[${j}]`, error: s.reason?.message || String(s.reason) });
                     fanoutErrorsCount++;
                     // Fill corresponding entries with null
                     for (const k of Object.keys(node.map || {})) {
                        if (!merged[k]) merged[k] = new Array(cap).fill(null);
                        merged[k][j] = null;
                     }
                      // Assume max retries were used for failed calls in fanout
                     maxAttempts = Math.max(maxAttempts, (node.retry?.times ?? 0) + 1);
                }
            }
            resultData = merged;
            attempts = maxAttempts; // Use the max attempts from any fanout call
            fallbackUsed = anyFallback;
            nodeDuration = now() - t0; // Duration covers all fanout calls
            console.log(`  [FANOUT ${node.name || node.id}] Merged results. Errors: ${fanoutErrorsCount}. Max Attempts: ${attempts}. Fallback: ${fallbackUsed}`);

        } else {
           // Single HTTP call
          const httpResult = await runHttpNode(node, scope, useMocks);
          resultData = httpResult.data;
          attempts = httpResult.attempts;
          fallbackUsed = httpResult.fallbackUsed;
          nodeDuration = now() - t0;
        }
      } else if (node.type === 'transform') {
        const transformResult = runTransformNode(node, outputs);
        resultData = transformResult.data;
        nodeDuration = transformResult.duration;
        attempts = 1; // Transforms don't retry currently
        fallbackUsed = false;
      } else {
        resultData = null;
        nodeDuration = now() - t0;
      }

      outputs[node.id] = resultData;
      node.status = 'completed';
      node.latency_ms = nodeDuration; // Store latency on the node itself
      // Update outgoing edge statuses
      edges.forEach(edge => { if (edge.from === node.id) edge.status = 'completed'; });

      runLog.push({ node_id: node.id, status: 'ok', attempts, duration_ms: nodeDuration, fallback_used: fallbackUsed });
      publish('node_complete', { nodeId: node.id, status: 'completed', latency_ms: nodeDuration, state: getCurrentState() });
      console.log(`[NODE OK ${node.name || node.id}] Duration: ${nodeDuration}ms. Attempts: ${attempts}. Fallback: ${fallbackUsed}`);

    } catch (e) {
      const duration = now() - t0;
      const errorMsg = e?.message || String(e);

      node.status = 'failed';
      node.latency_ms = duration; // Record duration even on failure
      node.error_message = errorMsg; // Store error message
       // Mark outgoing edges as failed
       edges.forEach(edge => { if (edge.from === node.id) edge.status = 'failed'; });

      errors.push({ node_id: node.id, error: errorMsg });
      // Attempts logic might be complex if error occurs mid-retry, using 1 for now
      runLog.push({ node_id: node.id, status: 'error', attempts: 1, duration_ms: duration, error: errorMsg });
      publish('node_fail', { nodeId: node.id, status: 'failed', duration_ms: duration, error: errorMsg, state: getCurrentState() }); // Use node_fail event
      console.error(`[NODE ERROR ${node.name || node.id}] Duration: ${duration}ms, Error: ${errorMsg}`);
      // Continue execution
    }
  }

  // Final calculations for summary/results
    const finalOutputs = { ...outputs };
    if (outputs.t3_top) finalOutputs.ranked_list = outputs.t3_top;
    if (outputs.t4_corr != null) {
        finalOutputs.correlation = {
            x: 'quality',
            y: 'eta_seconds',
            pearson_r: outputs.t4_corr,
            n: (outputs.t1_join || []).length // Use count from joined data
        };
    }
     // Add count for summary
     finalOutputs.count = (outputs.t1_join || []).length;


  console.log(`[EXECUTOR END] Finished. Errors: ${errors.length}. API Calls: ${apiCalls}`);
  return { outputs: finalOutputs, log: runLog, errors, metrics: { apiCalls } };
}