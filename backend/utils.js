// backend/utils.js - Final Complete Helper File

import { JSONPath } from "jsonpath-plus";

// --- Base Helpers ---
export const now = () => Date.now();
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

// --- Resolvers ---
export function resolvePathLike(scope, expr) {
    if (typeof expr !== "string") return expr;
    if (expr.startsWith("$.") || expr.startsWith("$[")) {
        return JSONPath({ path: expr, json: scope });
    }
    const parts = expr.split(".");
    let cur = scope;
    for (const p of parts) {
        if (cur == null) return undefined;
        cur = cur[p];
    }
    return cur;
}

// --- CRITICAL TEMPLATE INTERPOLATOR ---
export function interpolate(template, scope) {
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
                for (let i = 0; i < Math.min(lats.length, lons.length); i++) {
                    pairs.push(`${lons[i]},${lats[i]}`);
                }
                return pairs.join(";");
            }
            return "";
        }
        const val = resolvePathLike(scope, call);
        if (val == null) return "";
        return String(val);
    });
}

// --- Data Structure Helpers ---
export function applyMap(json, map) {
    if (!map || !isObj(map)) return json;
    const out = {};
    for (const [k, jp] of Object.entries(map)) {
        try {
            out[k] = JSONPath({ path: jp, json });
        } catch (_e) {
            out[k] = [];
        }
    }
    return out;
}

export function asRows(input) {
    if (Array.isArray(input)) return input;
    if (isObj(input)) {
        const keys = Object.keys(input);
        const len = keys.reduce(
            (m, k) => Math.max(m, Array.isArray(input[k]) ? input[k].length : 0), 0
        );
        const rows = [];
        for (let i = 0; i < len; i++) {
            const row = {};
            for (const k of keys) row[k] = Array.isArray(input[k]) ? input[k][i] : undefined;
            rows.push(row);
        }
        return rows;
    }
    return [];
}

// --- Transform Functions (Full list) ---
export function t_join_on_index(left, rightArrays, rightKeys) {
    const leftRows = asRows(left);
    return leftRows.map((row, i) => {
        const extra = {};
        (rightArrays || []).forEach((arr, idx) => {
            extra[rightKeys?.[idx]] = Array.isArray(arr) ? arr[i] : undefined;
        });
        return { ...row, ...extra };
    });
}

export function t_compute_osm_quality(arr, fields) {
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

export function t_compute_score(arr, { ratingKey = "quality", etaKey = "eta_seconds", precipKey = "precip" } = {}) {
    const rows = asRows(arr);
    return rows.map((row) => {
        const scaledEta = (row?.[etaKey] ?? 0) / 600; 
        const rain = (row?.[precipKey] ?? 0) * 0.3;
        return { ...row, score: (row?.[ratingKey] ?? 0) - scaledEta - rain };
    });
}

export function t_top_n(arr, { n = 5, by = "score", desc = true } = {}) {
    const rows = asRows(arr);
    const s = [...rows].sort((a, b) =>
        desc ? (b[by] ?? 0) - (a[by] ?? 0) : (a[by] ?? 0) - (b[by] ?? 0)
    );
    return s.slice(0, n);
}

export function t_correlation(xs, ys) {
    const X = Array.isArray(xs) ? xs : [];
    const Y = Array.isArray(ys) ? ys : [];
    const n = Math.min(X.length, Y.length);
    if (!n) return 0;
    const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
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
    return den ? num / den : 0;
}