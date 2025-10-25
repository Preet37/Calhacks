// server.js — MetaForge mini backend with deterministic runId + SSE

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { plan } from './planner.js';
import { executePipeline } from './executor.js';
// CRITICAL FIX: Import base utils used in server logging/timing
import { now } from './utils.js'; 

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const USE_MOCKS = (process.env.USE_MOCKS || 'false').toLowerCase() === 'true';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ---------------------- SSE infra ----------------------
const sseClients = new Map();
const HEARTBEAT_MS = 15000;

function emit(runId, event, data) {
    const clients = sseClients.get(runId);
    if (!clients) return;

    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    const frame = `event: ${event}\ndata: ${payload}\n\n`;
    for (const res of clients) {
        try { res.write(frame); } catch { clients.delete(res); }
    }
}

function addClient(runId, res) {
    if (!sseClients.has(runId)) sseClients.set(runId, new Set());
    sseClients.get(runId).add(res);
}

function removeClient(runId, res) {
    const set = sseClients.get(runId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) sseClients.delete(runId);
}

function randomId(len = 8) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let out = '';
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

// ---------------------- Routes ----------------------
app.get('/events/:runId', (req, res) => {
    const runId = req.params.runId;
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    res.write(`event: hello\ndata: ${JSON.stringify({ runId, t: Date.now() })}\n\n`);
    const ping = setInterval(() => res.write(':\n\n'), HEARTBEAT_MS);

    addClient(runId, res);
    req.on('close', () => {
        clearInterval(ping);
        removeClient(runId, res);
    });
});

app.post('/run', async (req, res) => {
    const startedAt = now(); // Use now() defined in utils.js
    const runId = (req.query.rid || req.body?.runId || `run_${randomId(8)}`).toString();
    const useMocks = req.body?.useMocks !== undefined ? req.body.useMocks : USE_MOCKS;

    const goal = req.body?.goal || 'Analyze restaurants near me.';
    const context = req.body?.context || {};

    emit(runId, 'status', { phase: 'accepted', runId, goal, useMocks });

    try {
        // 1) PLAN
        emit(runId, 'status', { phase: 'planning' });
        const spec = await plan({ goal, context, useMocks });

        if (!spec || !Array.isArray(spec.nodes) || spec.nodes.length === 0) {
            throw new Error('planner produced an empty or invalid spec');
        }

        emit(runId, 'planned', { runId, spec });

        // 2) EXECUTE
        emit(runId, 'status', { phase: 'executing', useMocks });

        const onEvent = (data) => emit(runId, data.event, data);

        const { outputs, runLog, errors, metrics, apiCalls } = await executePipeline(spec, {
            context: req.body,
            useMocks,
            publish: onEvent,
        });

        const duration = now() - startedAt;

        // 3) COMPOSE RESPONSE
        const response = {
            status: 'ok',
            runId,
            summary: outputs.summary || 'Pipeline completed.',
            results: {
                ranked_list: outputs.ranked_list || [],
                correlation: outputs.correlation || { x: 'quality', y: 'eta_seconds', pearson_r: 0, n: 0 },
                metrics: { total_duration_ms: duration, api_calls: apiCalls },
            },
            pipeline_spec: spec,
            log: { run: runLog, decision: spec._decision || [] },
            errors,
            health: {
                fail_rate_24h: errors.length ? 0.1 : 0,
                auto_reroutes: 0,
                recommendations: spec.hints || [],
            },
        };

        // 4) Finish stream and send HTTP response
        emit(runId, 'status', { phase: 'finished', duration_ms: duration, errors: errors.length });
        res.json(response);

    } catch (err) {
        const msg = err?.message || 'Unknown error';
        emit(runId, 'status', { phase: 'failed', error: msg });
        console.error(`[RUN ${runId}] FAILED --- ${msg}`, err);
        res.status(500).json({ status: 'error', runId, errors: [{ error: msg }] });
    }
});

app.get('/', (_req, res) => {
    res.json({ ok: true, mocks: USE_MOCKS, sse_channels: [...sseClients.keys()] });
});

app.listen(PORT, () => {
    console.log(`MetaForge backend running on http://localhost:${PORT} (mocks=${USE_MOCKS})`);
});