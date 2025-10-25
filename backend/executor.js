// executor.js (Corrected: Passes spec down to runHttpNode)
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
        try { return JSONPath({ path: expr, json: scope }); } catch (e) { return undefined; }
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
        const joinMatch = call.match(/^join_coords\(([^,]+),\s*([^)]+)\)\s*$/);
        if (joinMatch) {
            const latPath = joinMatch[1].trim();
            const lonPath = joinMatch[2].trim();
            const lats = resolvePathLike(scope, latPath);
            const lons = resolvePathLike(scope, lonPath);
            if (Array.isArray(lats) && Array.isArray(lons)) {
                const pairs = [];
                // OSRM needs origin first for sources=0, then destinations
                let originCoords = '';
                // Use _origin if available in the top-level scope passed down
                if (scope._origin && scope._origin.lon != null && scope._origin.lat != null) {
                     originCoords = `${scope._origin.lon},${scope._origin.lat}`;
                } else if (scope.context?.origin) { // Fallback to context if _origin isn't there
                     const [lat, lon] = String(scope.context.origin).split(',');
                     if(lat && lon) originCoords = `${lon.trim()},${lat.trim()}`;
                }

                if (originCoords) pairs.push(originCoords); // Add origin

                for (let i = 0; i < Math.min(lats.length, lons.length); i++) {
                    if (lons[i] != null && lats[i] != null) {
                        pairs.push(`${lons[i]},${lats[i]}`); // lon,lat
                    }
                }
                 // If sources=0 is used, OSRM expects "origin;dest1;dest2..." OR just "dest1;dest2..." if origin isn't needed explicitly?
                 // Let's stick to the structure that includes origin, as OSRM table service handles it.
                 // The `sources=0` param tells OSRM to use the *first* coordinate as the source.
                return pairs.join(";");
            }
            return "";
        }
        const val = resolvePathLike(scope, call);
        return val == null ? "" : String(val);
    });
}
function applyMap(json, map) { /* ... keep existing ... */
    if (!map || !isObj(map)) return json;
    const out = {};
    for (const [k, jp] of Object.entries(map)) {
        try {
            const result = JSONPath({ path: jp, json: json, wrap: false });
            out[k] = result === undefined ? null : result;
        } catch (e) {
            out[k] = null;
        }
    }
    return out;
}
function asRows(input) { /* ... keep existing ... */
    if (Array.isArray(input)) return input;
    if (isObj(input) && Object.values(input).every(Array.isArray)) {
        const keys = Object.keys(input);
        if (keys.length === 0) return [];
        const firstKey = keys[0];
        const len = input[firstKey].length;
        if (!keys.every(k => input[k].length === len)) {
             const minLen = keys.reduce((min, k) => Math.min(min, input[k].length), Infinity);
             const rows = [];
             for (let i = 0; i < minLen; i++) {
                const row = {};
                for (const k of keys) row[k] = input[k][i];
                rows.push(row);
             }
             return rows;
        }
        const rows = [];
        for (let i = 0; i < len; i++) {
            const row = {};
            for (const k of keys) row[k] = input[k][i];
            rows.push(row);
        }
        return rows;
    }
    return [];
}


// --- Transforms ---
function t_join_on_index(left, rightArrays, rightKeys) { /* ... keep existing ... */
    const leftRows = asRows(left);
    const validRightArrays = (rightArrays || []).map(arr => Array.isArray(arr) ? arr : []);
    return leftRows.map((row, i) => {
        const extra = {};
        validRightArrays.forEach((arr, idx) => {
            const key = rightKeys?.[idx];
            if (key) { extra[key] = arr[i]; }
        });
        return { ...row, ...extra };
    });
}
function t_compute_osm_quality(arr, fields) { /* ... keep existing ... */
     const rows = asRows(arr);
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
function t_compute_score(arr, { ratingKey = "quality", etaKey = "eta_seconds", precipKey = "precip" } = {}) { /* ... keep existing ... */
     const rows = asRows(arr);
     return rows.map((row) => {
       const scaledEta = (Number(row?.[etaKey]) || 0) / 600;
       const precipValue = Number(row?.[precipKey]) || 0;
       const rain = Math.min(1.0, precipValue * 0.1);
       const rating = Number(row?.[ratingKey]) || 0;
       return { ...row, score: rating - scaledEta - rain };
     });
}
function t_top_n(arr, { n = 5, by = "score", desc = true } = {}) { /* ... keep existing ... */
     const rows = asRows(arr);
     const s = [...rows].sort((a, b) => {
         const valA = Number(a?.[by]) || 0;
         const valB = Number(b?.[by]) || 0;
         return desc ? valB - valA : valA - valB;
     });
     return s.slice(0, n);
}
function t_correlation(xs, ys) { /* ... keep existing ... */
    const X = Array.isArray(xs) ? xs.map(Number).filter(n => !isNaN(n)) : [];
    const Y = Array.isArray(ys) ? ys.map(Number).filter(n => !isNaN(n)) : [];
    const n = Math.min(X.length, Y.length);
    if (n < 2) return 0;
    const mean = (a) => a.reduce((s, x) => s + x, 0) / n;
    const mx = mean(X.slice(0, n));
    const my = mean(Y.slice(0, n));
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
        const vx = (X[i] ?? 0) - mx;
        const vy = (Y[i] ?? 0) - my;
        num += vx * vy;
        dx += vx * vx;
        dy += vy * vy;
    }
    const den = Math.sqrt(dx * dy);
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
        return {
            temp_c: Array.from({ length: 8 }, () => Number((17 + Math.random() * 3).toFixed(1))),
            precip: Array.from({ length: 8 }, () => Number((Math.random() * 1.5).toFixed(1)))
        };
    }
    return {};
}

// **MODIFIED**: Added 'spec' parameter here
async function runHttpNode(node, scope, useMocks, spec) {
    const nodeConsoleId = `HTTP ${node.name || node.id}`;
    // console.log(`  [${nodeConsoleId}] Running. Mocks: ${useMocks}`); // Less verbose log
    if (useMocks) {
        await sleep(50 + Math.random() * 50);
        const mock = mockFor(node);
        // console.log(`  [${nodeConsoleId}] Mock data generated.`);
        return { data: mock, attempts: 1, fallbackUsed: false };
    }

    // --- Real call logic ---
    let attempts = 0;
    const maxRetries = node.retry?.times ?? 0;
    const backoff = node.retry?.backoff_ms ?? 100;

    while (attempts <= maxRetries) {
        attempts++;
        try {
            // Pass down _origin from the spec if available
            const currentScope = { ...scope, _origin: spec?._origin, context: scope.context }; // Include _origin here

            const compiled = { /* ... build url, params, headers, body using interpolate and currentScope ... */ };
                compiled.url = node.url;
                compiled.params= node.params ? { ...node.params } : undefined;
                compiled.headers= node.headers ? { ...node.headers } : undefined;
                compiled.body= node.body ? { ...node.body } : undefined;

                // Expand compose fields FIRST
                if (node.compose && isObj(node.compose)) {
                    const tmp = {};
                    for (const [k, v] of Object.entries(node.compose)) {
                         // Use currentScope which includes _origin
                        tmp[k] = interpolate(String(v), currentScope);
                    }
                     // Update scope ONLY for subsequent interpolations within this node run
                    currentScope.compose = tmp;
                }

                // Interpolate url, params, headers, body using the potentially updated currentScope
                compiled.url = interpolate(compiled.url, currentScope);
                if (compiled.params) {
                    for (const [k, v] of Object.entries(compiled.params)) {
                        compiled.params[k] = interpolate(String(v), currentScope);
                    }
                }
                // Interpolate headers (important for Auth like Bearer {{TOKEN}})
                 if (compiled.headers) {
                     for (const [k, v] of Object.entries(compiled.headers)) {
                        // Interpolate against full scope including process.env for secrets
                         compiled.headers[k] = interpolate(String(v), { ...currentScope, ...process.env });
                     }
                 }
                if (compiled.body) {
                    for (const [k, v] of Object.entries(compiled.body)) {
                        compiled.body[k] = interpolate(String(v), currentScope);
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

            // console.log(`  [${nodeConsoleId}] Attempt ${attempts}: ${method} ${config.url}`); // Less verbose
            const resp = await axios(config);
            // console.log(`  [${nodeConsoleId}] Attempt ${attempts} successful. Status: ${resp.status}`); // Less verbose
            const mappedData = applyMap(resp.data, node.map);
            return { data: mappedData, attempts, fallbackUsed: false };

        } catch (error) {
            console.warn(`  [${nodeConsoleId}] Attempt ${attempts} FAILED. Error: ${error.message}`);
            if (attempts > maxRetries) {
                if (node.fallback) {
                    // TODO: Implement fallback logic if needed for demo
                    console.warn(`  [${nodeConsoleId}] Retries exhausted. Fallback not implemented.`);
                     throw new Error(`Node ${node.id} failed after ${attempts} attempts: ${error.message}`);
                } else {
                    throw error;
                }
            }
            await sleep(backoff * Math.pow(2, attempts - 1));
        }
    }
     throw new Error(`Node ${node.id} failed unexpectedly after all retries.`);
}

// --- Transform Runner ---
function runTransformNode(node, outputs) {
    const nodeConsoleId = `TRANSFORM ${node.name || node.id}`;
    // console.log(`  [${nodeConsoleId}] Running function: ${node.fn}`); // Less verbose
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
        // console.log(`  [${nodeConsoleId}] OK. Duration: ${duration}ms`); // Less verbose
        return { data: result, duration };
    } catch (error) {
        const duration = now() - t0;
        console.error(`  [${nodeConsoleId}] FAILED. Duration: ${duration}ms, Error: ${error.message}`);
        throw error;
    }
}


// --- Main Runner ---
// **MODIFIED**: Accepts 'spec' as the first argument
export async function executePipeline(spec, ctx = {}) {
    const publish = ctx.publish || noop;
    const useMocks = ctx.useMocks ?? false;
    console.log(`[EXECUTOR START] Mocks: ${useMocks}. Nodes: ${spec?.nodes?.length}`);

    const outputs = {};
    const runLog = [];
    const errors = [];
    // Clone spec nodes/edges for mutation
    const nodes = spec.nodes.map(n => ({ ...n, status: 'pending', latency_ms: undefined }));
    const edges = spec.edges.map(e => ({ ...e, status: 'pending' }));
    // Pass spec._origin down for interpolation context
    const scope = { outputs, context: ctx.context || {}, _origin: spec._origin };

    if (!spec || !Array.isArray(nodes)) {
        throw new Error("executePipeline requires a spec with a nodes array.");
    }

    let apiCalls = 0;
    const getCurrentState = () => ({ nodes, edges });

    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const t0 = now();

        node.status = 'running';
        edges.forEach(edge => { if (edge.to === node.id) edge.status = 'running'; });

        publish('node_start', { nodeId: node.id, state: getCurrentState() });
        // console.log(`[NODE START ${node.name || node.id}]`); // Less verbose

        try {
            let resultData;
            let attempts = 1;
            let fallbackUsed = false;
            let nodeDuration = 0;

            if (node.type === 'http') {
                apiCalls++;
                if (node.fanout?.over) {
                    // ... (keep existing fanout logic, ensure it passes spec down) ...
                     // console.log(`  [FANOUT ${node.name || node.id}] Over: ${node.fanout.over}, Max: ${node.fanout.max}`); // Less verbose
                     const baseArr = asRows(resolvePathLike(scope, node.fanout.over) || []);
                     const cap = Math.min(node.fanout.max || baseArr.length, baseArr.length);
                     const mapping = node.fanout.mapping || {};
                     const fanoutResults = [];
                     // console.log(`  [FANOUT ${node.name || node.id}] Executing ${cap} parallel calls.`); // Less verbose

                     const promises = [];
                     for (let j = 0; j < cap; j++) {
                         const item = baseArr[j];
                         const subScope = { /* ... build subScope ... */ };
                            subScope.outputs = scope.outputs; // Pass existing outputs
                            subScope.context = scope.context; // Pass context
                            subScope._origin = scope._origin; // Pass origin
                            // Add mapped fanout variables
                            for (const [key, sourceKey] of Object.entries(mapping)) {
                                subScope[key] = item?.[sourceKey];
                            }

                         promises.push(
                             (async () => {
                                 if (!useMocks) await sleep(50 + Math.random() * 50);
                                 // **MODIFIED**: Pass spec down
                                 return runHttpNode(node, subScope, useMocks, spec);
                             })()
                         );
                     }
                     const settled = await Promise.allSettled(promises);
                     // console.log(`  [FANOUT ${node.name || node.id}] ${settled.length} calls settled.`); // Less verbose

                     // Merge results
                     const merged = {};
                     let fanoutErrorsCount = 0;
                     let maxAttempts = 1;
                     let anyFallback = false;
                     // ... (keep existing merge logic) ...
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
                                  merged[k][j] = Array.isArray(val) ? val[0] : val; // Handle mapper returning array
                              }
                          } else {
                               console.error(`  [FANOUT ${node.name || node.id}] Call ${j} failed: ${s.reason?.message}`);
                               errors.push({ node_id: `${node.id}[${j}]`, error: s.reason?.message || String(s.reason) });
                               fanoutErrorsCount++;
                               maxAttempts = Math.max(maxAttempts, (node.retry?.times ?? 0) + 1);
                               // Fill corresponding entries with null
                               for (const k of Object.keys(node.map || {})) {
                                  if (!merged[k]) merged[k] = new Array(cap).fill(null);
                                  merged[k][j] = null;
                               }
                          }
                      }
                     resultData = merged;
                     attempts = maxAttempts;
                     fallbackUsed = anyFallback;
                     nodeDuration = now() - t0;
                     // console.log(`  [FANOUT ${node.name || node.id}] Merged. Errors: ${fanoutErrorsCount}. Max Attempts: ${attempts}. Fallback: ${fallbackUsed}`); // Less verbose


                } else {
                    // Single HTTP call
                    // **MODIFIED**: Pass spec down
                    const httpResult = await runHttpNode(node, scope, useMocks, spec);
                    resultData = httpResult.data;
                    attempts = httpResult.attempts;
                    fallbackUsed = httpResult.fallbackUsed;
                    nodeDuration = now() - t0;
                }
            } else if (node.type === 'transform') {
                const transformResult = runTransformNode(node, outputs);
                resultData = transformResult.data;
                nodeDuration = transformResult.duration;
                attempts = 1;
                fallbackUsed = false;
            } else {
                resultData = null;
                nodeDuration = now() - t0;
            }

            outputs[node.id] = resultData;
            node.status = 'completed';
            node.latency_ms = nodeDuration;
            edges.forEach(edge => { if (edge.from === node.id) edge.status = 'completed'; });

            runLog.push({ node_id: node.id, status: 'ok', attempts, duration_ms: nodeDuration, fallback_used: fallbackUsed });
            // Use 'node_complete' event name
            publish('node_complete', { nodeId: node.id, status: 'completed', latency_ms: nodeDuration, state: getCurrentState() });
            // console.log(`[NODE OK ${node.name || node.id}] Duration: ${nodeDuration}ms.`); // Less verbose

        } catch (e) {
            const duration = now() - t0;
            const errorMsg = e?.message || String(e);
            node.status = 'failed';
            node.latency_ms = duration;
            node.error_message = errorMsg;
            edges.forEach(edge => { if (edge.from === node.id) edge.status = 'failed'; });
            errors.push({ node_id: node.id, error: errorMsg });
            runLog.push({ node_id: node.id, status: 'error', attempts: 1, duration_ms: duration, error: errorMsg });
            // Use 'node_fail' event name
            publish('node_fail', { nodeId: node.id, status: 'failed', duration_ms: duration, error: errorMsg, state: getCurrentState() });
            console.error(`[NODE ERROR ${node.name || node.id}] Error: ${errorMsg}`);
        }
    }

    // Final outputs
    const finalOutputs = { ...outputs };
    finalOutputs.ranked_list = outputs.t3_top || [];
    finalOutputs.correlation = {
        x: 'quality', y: 'eta_seconds',
        pearson_r: outputs.t4_corr ?? 0,
        n: (outputs.t1_join || []).length
    };
    finalOutputs.count = (outputs.t1_join || []).length;

    console.log(`[EXECUTOR END] Finished. Errors: ${errors.length}. API Calls: ${apiCalls}`);
    return { outputs: finalOutputs, log: runLog, errors, metrics: { apiCalls } };
}