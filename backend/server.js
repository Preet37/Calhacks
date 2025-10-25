// server.js (emits frontend-compatible SSE events with state)
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
// IMPORTANT: Dynamic import AFTER dotenv.config()
dotenv.config();
const { executePipeline } = await import('./executor.js');
const { plan } = await import('./planner.js');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const ENV_USE_MOCKS = String(process.env.USE_MOCKS || 'false').toLowerCase() === 'true';

console.log(`[SERVER START] Initial USE_MOCKS from env: ${ENV_USE_MOCKS}`);
console.log(`[DEBUG] Planner imported: ${typeof plan === 'function'}`);
console.log(`[DEBUG] Executor imported: ${typeof executePipeline === 'function'}`);

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// --- SSE infra ---
const sseClients = new Map();
function emit(runId, event, data) {
    const listeners = sseClients.get(runId);
    if (!listeners || listeners.size === 0) return;
    // Ensure data includes a timestamp if not present
    const eventData = { timestamp: Date.now(), ...data };
    const payload = JSON.stringify(eventData);
    const frame = `event: ${event}\ndata: ${payload}\n\n`;
    // console.log(`[SSE ${runId}] Emitting event: ${event}`); // Verbose SSE logging
    for (const res of listeners) {
        try { res.write(frame); } catch { /* ignore */ }
    }
}
function addClient(runId, res) {
    if (!sseClients.has(runId)) sseClients.set(runId, new Set());
    sseClients.get(runId).add(res);
     console.log(`[SSE ${runId}] Client connected. Total: ${sseClients.get(runId)?.size}`);
}
function removeClient(runId, res) {
    const set = sseClients.get(runId);
    if (!set) return;
    set.delete(res);
     console.log(`[SSE ${runId}] Client disconnected. Remaining: ${set.size}`);
    if (set.size === 0) sseClients.delete(runId);
}
function randomId(len = 8) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
}
function reqOnClose(res, cb) { /* ... keep existing ... */
    const req = res.req;
    const done = () => {
      res.removeListener('close', done);
      req?.removeListener?.('aborted', done);
      cb();
    };
    res.on('close', done);
    req?.on?.('aborted', done);
}


// --- Routes ---
app.get('/', (_req, res) => {
  res.json({ ok: true, mocks: ENV_USE_MOCKS, sse_channels: [...sseClients.keys()] });
});

app.get('/events/:id', (req, res) => {
    const runId = req.params.id;
    console.log(`[SSE ${runId}] Incoming connection request.`);
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const ping = setInterval(() => {
        try { res.write(':\n\n'); } catch { clearInterval(ping); removeClient(runId, res); }
    }, 20000);
    addClient(runId, res);
    // Send hello *after* adding client
    emit(runId, 'hello', { runId, t: Date.now() });
    reqOnClose(res, () => { clearInterval(ping); removeClient(runId, res); });
});


app.post('/run', async (req, res) => {
    const startedAt = Date.now();
    const runId = (req.query.rid || req.body?.runId || `run_${randomId(8)}`).toString();
    const useMocksForRun = typeof req.body?.useMocks === 'boolean' ? req.body.useMocks : ENV_USE_MOCKS;
    const goal = req.body?.goal || '';
    const context = req.body?.context || {};
    const outputsWanted = Array.isArray(req.body?.outputs) ? req.body.outputs : ['summary', 'ranked_list', 'correlation', 'pipeline_spec', 'health'];

    console.log(`\n--- [RUN ${runId}] Request received ---`);
    console.log(`[RUN ${runId}] Params: runId=${runId}, useMocks=${useMocksForRun}, goal=${goal ? goal.substring(0, 30)+'...' : '(empty)'}`);
    // Emit planning_start using the correct name
    emit(runId, 'planning_start', { runId, goal, useMocks: useMocksForRun });

    try {
        // 1) Plan
        console.log(`[RUN ${runId}] Calling planner...`);
        const spec = await plan({ goal, context, useMocks: useMocksForRun });
        console.log(`[RUN ${runId}] Planner returned. Spec valid: ${spec && Array.isArray(spec.nodes)}`);
        if (!spec || !Array.isArray(spec.nodes) || spec.nodes.length === 0) {
            throw new Error('planner produced an empty or invalid spec');
        }
        console.log(`[RUN ${runId}] Planning complete. Spec has ${spec.nodes.length} nodes.`);
        // Emit planning_complete with the initial state (all nodes/edges pending)
        emit(runId, 'planning_complete', { runId, state: { nodes: spec.nodes, edges: spec.edges } });

        // 2) Execute
        console.log(`[RUN ${runId}] Calling executor... Mocks: ${useMocksForRun}`);
        // Emit execution_start
        emit(runId, 'execution_start', { runId });
        // Use 'publish' as the callback name if executor expects it
        const onEvent = (event, data) => emit(runId, event, data);

        const { outputs = {}, log = [], errors = [], metrics = {} } = await executePipeline(spec, {
            publish: onEvent, // Pass the emitter using the 'publish' key
            useMocks: useMocksForRun
        });
        console.log(`[RUN ${runId}] Executor finished. Errors: ${errors.length}. API Calls: ${metrics.apiCalls ?? log.filter(l => l.status === 'ok' || l.status === 'error').length}`); // More robust api call count
        const duration = Date.now() - startedAt;

        // 3) Compose response
        const ranked = Array.isArray(outputs.ranked_list) ? outputs.ranked_list : [];
        const corr = outputs.correlation || { x: 'quality', y: 'eta_seconds', pearson_r: 0, n: 0 };
        const count = outputs.count ?? 0; // Use count from executor if available
        const summary = ranked.length > 0
            ? `Found ${count} restaurants. Quality vs ETA correlation r=${Number(corr.pearson_r).toFixed(2)}. Showing top ${ranked.length}.`
            : 'No results.';

        // Calculate final health metrics
        const run_time_sec = duration / 1000;
        const successfulNodeLatencies = log.filter(l => l.status === 'ok' && l.duration_ms != null).map(l => l.duration_ms);
        const avg_latency_ms = successfulNodeLatencies.length > 0
            ? Math.round(successfulNodeLatencies.reduce((a, b) => a + b, 0) / successfulNodeLatencies.length)
            : 0;

        const health = {
            run_time_sec: Number(run_time_sec.toFixed(1)), // Use run_time_sec
            avg_latency_ms, // Use avg_latency_ms
            fail_rate_24h: 0, // Placeholder - implement if needed
            auto_reroutes: log.filter(l => l.fallback_used).length, // Count fallbacks used
            recommendations: spec?.hints || [],
        };

        const resp = {
            status: 'ok',
            runId,
            summary,
            results: {
                ranked_list: ranked.map(r => ({ // Ensure consistent fields
                    name: r?.name ?? '(unknown)',
                    quality: Number(r?.quality ?? 0),
                    eta_min: r?.eta_seconds != null ? Math.round((r.eta_seconds / 60) * 10) / 10 : null,
                    temp_c: r?.temp_c ?? null,
                    precip: r?.precip ?? null,
                    score: Number(r?.score ?? 0),
                    address: r?.address ?? null
                })),
                correlation: corr,
                metrics: { // Use frontend expected names
                   total_duration_ms: duration,
                   api_calls: metrics.apiCalls ?? log.filter(l => l.status === 'ok' || l.status === 'error').length
                 }
            },
            pipeline_spec: spec, // Include the spec as planned
            log: { run: log || [], decision: spec?._decision || [] }, // Keep decision log
            errors,
            health, // Use calculated health object
        };

        console.log(`[RUN ${runId}] Sending final response. Summary: ${summary.substring(0, 50)}...`);
        // Emit pipeline_complete with final state and health
        // Need to construct final state from executor log
         const finalNodes = spec.nodes.map(n => {
             const runInfo = log.find(l => l.node_id === n.id);
             return {
                 ...n,
                 status: runInfo ? (runInfo.status === 'ok' ? 'completed' : 'failed') : 'pending', // map ok->completed, error->failed
                 latency_ms: runInfo?.duration_ms,
                 error_message: errors.find(e => e.node_id === n.id)?.error
             };
         });
          const finalEdges = spec.edges.map(e => {
              const sourceNodeFinal = finalNodes.find(n => n.id === e.from);
              // Edge status is 'completed' if source node completed, 'failed' if source failed, else 'pending'
              let edgeStatus = 'pending';
              if (sourceNodeFinal?.status === 'completed') edgeStatus = 'completed';
              if (sourceNodeFinal?.status === 'failed') edgeStatus = 'failed';
              return { ...e, status: edgeStatus };
          });


        emit(runId, 'pipeline_complete', { runId, state: { nodes: finalNodes, edges: finalEdges, summary: summary, correlation: corr }, health });
        return res.json(resp);

    } catch (err) {
        const errorMsg = err?.message || String(err);
        console.error(`--- [RUN ${runId}] FAILED ---`);
        console.error(`Error: ${errorMsg}`);
        console.error(err.stack);
        emit(runId, 'error', { runId, error: errorMsg }); // Emit generic error
        emit(runId, 'pipeline_complete', { runId, status: 'error', error: errorMsg }); // Also signal completion failure
        return res.status(500).json({ status: 'error', runId, errors: [{ error: errorMsg }] });
    }
});

// --- Start ---
app.listen(PORT, () => {
    console.log(`MetaForge backend on http://localhost:${PORT} (mocks=${ENV_USE_MOCKS})`);
    console.log(`[DEBUG] Server flags: PLAN_ONLY=${process.env.PLAN_ONLY}, DRY_RUN=${process.env.DRY_RUN}, EXECUTE_DISABLED=${process.env.EXECUTE_DISABLED}`);
});