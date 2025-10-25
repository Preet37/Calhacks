// executor.js — Final Resilient Runner (ESM version)

import axios from "axios";
import { JSONPath } from "jsonpath-plus";

// --- CRITICAL FIX: Import all necessary helpers from utils.js ---
import { 
    now, sleep, isObj, resolvePathLike, interpolate, applyMap, asRows, 
    t_join_on_index, t_compute_osm_quality, t_compute_score, t_top_n, t_correlation 
} from "./utils.js"; 

// --------------------------- small utils (mock data) ---------------------------
function mockFor(node) {
    if (node.id === "n1_overpass") {
        const names = Array.from({ length: 8 }, (_, i) => `Mock Place ${i + 1}`);
        const lat0 = 37.8715, lon0 = -122.273;
        const lat = names.map((_, i) => lat0 + 0.005 * Math.sin(i));
        const lon = names.map((_, i) => lon0 + 0.005 * Math.cos(i));
        const cuisine = ["mexican", "thai", "pizza", "japanese", "indian", "chinese", "vietnamese", "mediterranean"];
        const opening_hours = ["Mo-Su 11:00-22:00", "", "Mo-Su 10:00-20:00", "Mo-Su 11:30-21:30", "", "", "", ""];
        const outdoor_seating = ["yes", "", "yes", "", "yes", "", "", "yes"];
        const wheelchair = ["yes", "yes", "", "", "yes", "", "", ""];
        const address = names.map((_, i) => `${2000 + i} University Ave`);
        return { name: names, lat, lon, cuisine, opening_hours, outdoor_seating, wheelchair, address };
    }
    if (node.id === "n2_eta") {
        return { eta_seconds: Array.from({ length: 8 }, (_, i) => 240 + 40 * i) };
    }
    if (node.id === "n3_weather") {
        return {
            temp_c: Array.from({ length: 8 }, () => 17 + Math.random() * 3),
            precip: Array.from({ length: 8 }, () => Math.random() * 0.3)
        };
    }
    return {};
}

// --------------------------- HTTP runner ---------------------------
async function runHttpNode(node, scope, useMocks) {
    if (useMocks) {
        await sleep(50);
        return mockFor(node);
    }

    let finalScope = { ...scope, outputs: scope.outputs || {} };
    
    if (node.compose && isObj(node.compose)) {
        const composed = {};
        for (const [k, v] of Object.entries(node.compose)) { composed[k] = interpolate(String(v), finalScope); }
        finalScope = { ...finalScope, compose: composed };
    }
    
    // OSRM fix: Prepend origin to destinations list
    if (node.provider === 'osrm.table' && finalScope.compose?.dest_coords_csv) {
        const originCoords = `${scope.context?._origin?.lon},${scope.context?._origin?.lat}`;
        finalScope.compose.dest_coords_csv = `${originCoords};${finalScope.compose.dest_coords_csv}`;
    }

    const compiled = { url: node.url, params: node.params ? { ...node.params } : undefined, headers: node.headers ? { ...node.headers } : undefined, body: node.body ? { ...node.body } : undefined, };

    compiled.url = interpolate(compiled.url, finalScope);
    
    if (compiled.params) { for (const [k, v] of Object.entries(compiled.params)) { compiled.params[k] = interpolate(String(v), finalScope); } }
    if (compiled.body) { for (const [k, v] of Object.entries(compiled.body)) { compiled.body[k] = interpolate(String(v), finalScope); } }
    
    const method = (node.method || "GET").toUpperCase();
    const timeout = node.timeout_ms || 6000;
    const config = { method, url: compiled.url, headers: compiled.headers, params: compiled.params, timeout, };

    if (method === "POST") {
        if (compiled.headers && /application\/x-www-form-urlencoded/i.test(compiled.headers["Content-Type"] || "")) {
            config.data = new URLSearchParams(compiled.body || {}).toString();
        } else {
            config.data = compiled.body;
        }
    }

    const resp = await axios(config);
    return applyMap(resp.data, node.map);
}

// --------------------------- main executor ---------------------------
export async function executePipeline(spec, ctx = {}) {
    const publish = ctx.publish || (() => {});
    const useMocks = ctx.useMocks === true;
    const outputs = {};
    const runLog = [];
    const errors = [];
    let apiCalls = 0;
    let totalDuration = 0;

    const scope = { outputs, context: { ...ctx.context, ...spec } };

    // Inject compose helper into scope
    scope.join_coords = (lats, lons) => {
        if (!Array.isArray(lats) || !Array.isArray(lons)) return "";
        const pairs = [];
        for (let i = 0; i < Math.min(lats.length, lons.length); i++) {
            pairs.push(`${lons[i]},${lats[i]}`);
        }
        return pairs.join(";");
    };

    for (const node of spec.nodes) {
        const t0 = now();
        publish('node_start', { event: 'node_start', nodeId: node.id, name: node.name });
        let result = null;

        try {
            if (node.type === "http") {
                apiCalls++;

                // Fan-out logic (weather) is assumed correct and resilient
                if (node.fanout && node.fanout.over) {
                    const baseArr = asRows(resolvePathLike(scope, node.fanout.over) || []);
                    const max = Math.min(node.fanout.max || baseArr.length, baseArr.length);
                    const mapping = node.fanout.mapping || {};
                    const jobs = [];

                    for (let i = 0; i < max; i++) {
                        const subScope = { ...scope, ...Object.fromEntries(Object.entries(mapping).map(([k, v]) => [k, baseArr[i]?.[v]])) };
                        jobs.push(runHttpNode(node, subScope, useMocks).catch(e => e));
                        if (!useMocks) await sleep(60); 
                    }
                    
                    const settled = await Promise.allSettled(jobs);
                    const merged = {};
                    for (const s of settled) {
                        if (s.status === 'fulfilled' && !(s.value instanceof Error)) {
                            const r = s.value;
                            for (const [k, val] of Object.entries(r || {})) {
                                if (!merged[k]) merged[k] = [];
                                merged[k].push(Array.isArray(val) ? val[0] : val);
                            }
                        } else {
                            errors.push({ nodeId: node.id, error: `Fanout item failed: ${s.reason?.message || 'unknown'}` });
                        }
                    }
                    result = merged;
                } else {
                    // Standard HTTP call (Overpass, OSRM)
                    result = await runHttpNode(node, scope, useMocks);
                }
            } else if (node.type === "transform") {
                // Transform node
                if (node.fn === "join_on_index") {
                    const left = resolvePathLike({ outputs }, node.args?.left) ?? [];
                    if (!left) throw new Error(`Missing input for ${node.id}`);
                    
                    const rightArrays = (node.args?.rightArrays || []).map((p) => resolvePathLike({ outputs }, p));
                    const rightKeys = node.args?.rightKeys || [];
                    result = t_join_on_index(left, rightArrays, rightKeys);
                }
                else if (node.fn === "compute_osm_quality") {
                    const arr = resolvePathLike({ outputs }, node.args?.from || "outputs.t1_join") ?? [];
                    result = t_compute_osm_quality(arr, node.args?.fields);
                } 
                else if (node.fn === "compute_score") {
                    const arr = resolvePathLike({ outputs }, node.args?.from || "outputs.t_osm_quality") ?? [];
                    result = t_compute_score(arr, node.args);
                } 
                else if (node.fn === "top_n") {
                    const arr = resolvePathLike({ outputs }, node.args?.from || "outputs.t2_score") ?? [];
                    result = t_top_n(arr, node.args);
                } 
                else if (node.fn === "correlation") {
                    let xs = resolvePathLike({ outputs }, node.args?.xFrom);
                    let ys = resolvePathLike({ outputs }, node.args?.yFrom);
                    result = t_correlation(xs, ys);
                }
                else {
                    throw new Error(`Unknown transform fn: ${node.fn}`);
                }
            } else {
                result = null;
            }

            outputs[node.id] = result;
            const dur = now() - t0;
            totalDuration += dur;
            runLog.push({ nodeId: node.id, status: 'ok', attempts: 1, duration_ms: dur });
            publish('node_complete', { nodeId: node.id, status: 'completed', latency_ms: dur });

        } catch (e) {
            const dur = now() - t0;
            totalDuration += dur;
            errors.push({ nodeId: node.id, error: e?.message || String(e) });
            runLog.push({ nodeId: node.id, status: 'error', attempts: 1, duration_ms: dur, error: e?.message });
            publish('node_fail', { nodeId: node.id, status: 'failed', duration_ms: dur, error: e?.message });
            
            outputs[node.id] = null;
        }
    }

    const finalRows = asRows(outputs.t3_top || outputs.t2_score || outputs.t1_join) || [];
    const correlationResult = resolvePathLike({ outputs }, 'outputs.t4_corr') || 0;
    
    outputs.summary = finalRows.length 
        ? `Found ${finalRows.length} restaurants. Quality vs ETA correlation r=${correlationResult.toFixed(2)}.` 
        : 'No results found in the search area.';
    outputs.ranked_list = finalRows;
    outputs.correlation = { x: 'quality', y: 'eta_seconds', pearson_r: correlationResult, n: finalRows.length };

    return { outputs, runLog, errors, metrics: { totalDuration, apiCalls }, apiCalls };
}