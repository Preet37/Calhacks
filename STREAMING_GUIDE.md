# TaskOrbit Streaming Simulator

## What We Built

A **mock Postman Flow simulator** that generates realistic real-time pipeline execution events. This allows you to develop the full streaming visualization experience before your backend is ready.

## Key Features

### 🎬 Real-Time Pipeline Execution
- **Planning Phase**: AI Core "thinks" and reveals nodes gradually
- **Execution Phase**: Nodes transition through states (pending → running → completed/failed)
- **Dynamic Updates**: Graph updates in real-time as events stream in

### 🎨 Visual States

#### Node States
- **Pending** (Gray): Nodes waiting to execute
  - Dim opacity (50%)
  - Gray stroke and glow
  - "○ Pending" label

- **Running** (Emerald Green): Active execution
  - Bright emerald stroke (thicker)
  - Fast pulsing animation (600ms)
  - Expanded glow radius
  - "⟳ Running" label

- **Completed** (Performance-based colors):
  - Blue: <200ms (fast)
  - Emerald: 200-300ms (good)
  - Amber: 300-400ms (medium)
  - Red: >400ms (slow)
  - Shows latency badge

- **Failed** (Red):
  - Red stroke and glow
  - "✕ Failed" label

### 🔄 Simulated Events

The mock stream emits these event types:

```javascript
// Planning events
'planning_start'      // AI begins analyzing
'node_discovered'     // New node appears in graph
'planning_complete'   // DAG fully assembled

// Execution events
'execution_start'     // Pipeline begins running
'node_start'          // Node starts executing
'node_progress'       // Progress updates (33%, 66%, 100%)
'node_complete'       // Node finishes
'node_retry'          // Timeout/error - retrying
'fallback_activated'  // Fallback route created
'execution_complete'  // All nodes finished

// Completion events
'pipeline_complete'   // Final metrics calculated
'final_state'         // Complete snapshot
```

## How to Use

### Starting a New Pipeline

Click the **"New Run"** button in the header to start a simulated pipeline execution.

### What Happens:

1. **Planning (2-3 seconds)**
   - AI Core pulses
   - Nodes appear one by one
   - Edges form between nodes

2. **Execution (5-10 seconds)**
   - Nodes light up as they run (emerald green)
   - Fast pulsing on active nodes
   - Particles flow along edges
   - 10% chance of retry/fallback

3. **Completion**
   - All nodes return to steady state
   - Health metrics updated
   - Logs show full execution history

## Integration with Real Backend

When your Postman/ChainForge backend is ready, you'll need to:

### 1. Replace Mock Stream with Real WebSocket/SSE

```javascript
// Current mock:
import { pipelineStream } from './services/mockPipelineStream'

// Future real implementation:
import { realPipelineStream } from './services/postmanStream'
```

### 2. Event Contract

Your backend should emit events matching this structure:

```javascript
{
  type: 'node_start' | 'node_complete' | etc,
  timestamp: number,
  nodeId?: string,
  status?: 'pending' | 'running' | 'completed' | 'failed',
  latency_ms?: number,
  state?: {
    nodes: [...],
    edges: [...]
  },
  health?: {
    success_rate: number,
    avg_latency_ms: number,
    ...
  }
}
```

### 3. Endpoint Structure

```
POST /api/pipeline/start
  Body: { goal: string }
  Returns: { run_id: string }

GET /api/pipeline/stream/:run_id
  Returns: SSE stream of events

GET /api/pipeline/status/:run_id
  Returns: Current state snapshot
```

## Mock Pipeline Templates

The simulator includes 3 pipeline templates:

### 1. GitHub → Notion
- GitHub Search
- OpenAI Summary
- Format Content
- Notion Create

### 2. Maps + Weather
- Geocoding API
- Weather API (parallel)
- Maps API (parallel)
- Merge Data

### 3. Default (Yelp + Maps + Weather)
- Yelp Search
- Google Maps
- Weather API
- Join Results
- Rank & Filter

## File Structure

```
src/
├── services/
│   └── mockPipelineStream.js   # Mock event generator
├── components/
│   └── NeuralCosmos.jsx         # Graph visualization (handles streaming)
└── TaskOrbitApp.jsx             # Main app (subscribes to events)
```

## Visual Enhancements Implemented

✅ **Centered node text** - Using `dominant-baseline="middle"`
✅ **Status-based colors** - Different colors for pending/running/completed/failed
✅ **Dynamic pulse animation** - Faster pulses for running nodes
✅ **Status indicators** - Icons and labels show current state
✅ **Live status badge** - Header shows "Running" with green pulse
✅ **Real-time logs** - Log panel updates with streaming events
✅ **Health metrics** - Updated when pipeline completes

## Next Steps

To complete the full vision from your spec:

1. **Shockwave effect on AI Core** - Add visual burst on fallback events
2. **Past galaxies** - Faded background showing previous runs
3. **Replay system** - Store runs in Supabase and replay animations
4. **Payload size scaling** - Make nodes larger based on data volume
5. **Real backend integration** - Connect to actual Postman Flow API

---

**Current Status**: Fully functional mock streaming system ready for development. When backend is ready, swap in real endpoints matching the event contract above.
