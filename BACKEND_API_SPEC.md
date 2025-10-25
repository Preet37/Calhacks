# Backend API Specification for Neural Cosmos

This document describes the expected JSON format from a Postman Flow backend using Server-Sent Events (SSE) or WebSocket for real-time pipeline execution.

## Connection Method

The backend should stream events using **Server-Sent Events (SSE)** or **WebSocket**:

### SSE Example (Recommended)
```javascript
// Frontend connects to:
const eventSource = new EventSource('/api/pipeline/execute?goal=find_restaurants')

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data)
  handlePipelineEvent(data)
}
```

### WebSocket Example
```javascript
const ws = new WebSocket('ws://api.example.com/pipeline/stream')
ws.onmessage = (event) => {
  const data = JSON.parse(event.data)
  handlePipelineEvent(data)
}
```

---

## Event Stream Format

Each event should be a JSON object with the following structure:

### Base Event Structure
```json
{
  "type": "event_type",
  "timestamp": 1698765432000,
  "message": "Optional human-readable message",
  "nodeId": "optional_node_id",
  "state": { /* current pipeline state */ },
  "health": { /* optional health metrics */ }
}
```

---

## Event Types & Examples

### 1. Planning Phase Events

#### `planning_start`
**When:** AI/Planner begins analyzing the user's request

```json
{
  "type": "planning_start",
  "timestamp": 1698765432000,
  "message": "AI analyzing request..."
}
```

#### `node_discovered`
**When:** AI decides to add a new node to the pipeline DAG

```json
{
  "type": "node_discovered",
  "timestamp": 1698765432100,
  "nodeId": "yelp_search_001",
  "node": {
    "id": "yelp_search_001",
    "name": "Yelp Search",
    "type": "http",
    "status": "pending"
  },
  "state": {
    "nodes": [
      {
        "id": "yelp_search_001",
        "name": "Yelp Search",
        "type": "http",
        "status": "pending"
      }
    ],
    "edges": []
  }
}
```

#### `planning_complete`
**When:** AI finishes planning and the full DAG is ready

```json
{
  "type": "planning_complete",
  "timestamp": 1698765433000,
  "message": "Pipeline graph assembled",
  "state": {
    "nodes": [
      {
        "id": "yelp_search",
        "name": "Yelp Search",
        "type": "http",
        "status": "pending"
      },
      {
        "id": "osrm_table",
        "name": "Google Maps",
        "type": "http",
        "status": "pending"
      },
      {
        "id": "join_results",
        "name": "Join Results",
        "type": "transform",
        "status": "pending"
      }
    ],
    "edges": [
      { "from": "yelp_search", "to": "join_results", "status": "pending" },
      { "from": "osrm_table", "to": "join_results", "status": "pending" }
    ]
  }
}
```

---

### 2. Execution Phase Events

#### `execution_start`
**When:** Pipeline begins executing nodes

```json
{
  "type": "execution_start",
  "timestamp": 1698765433500,
  "message": "Starting pipeline execution..."
}
```

#### `node_start`
**When:** A specific node begins execution

```json
{
  "type": "node_start",
  "timestamp": 1698765433600,
  "nodeId": "yelp_search",
  "state": {
    "nodes": [
      {
        "id": "yelp_search",
        "name": "Yelp Search",
        "type": "http",
        "status": "running"  // Changed from 'pending'
      },
      { "id": "osrm_table", "name": "Google Maps", "type": "http", "status": "pending" }
    ],
    "edges": [
      { "from": "yelp_search", "to": "join_results", "status": "pending" }
    ]
  }
}
```

#### `node_progress` (Optional - can be filtered out)
**When:** Node execution progress update

```json
{
  "type": "node_progress",
  "timestamp": 1698765434000,
  "nodeId": "yelp_search",
  "progress": 50
}
```

#### `node_complete`
**When:** A node finishes successfully

```json
{
  "type": "node_complete",
  "timestamp": 1698765434500,
  "nodeId": "yelp_search",
  "status": "completed",
  "latency_ms": 245,
  "state": {
    "nodes": [
      {
        "id": "yelp_search",
        "name": "Yelp Search",
        "type": "http",
        "status": "completed",
        "latency_ms": 245
      },
      { "id": "osrm_table", "name": "Google Maps", "type": "http", "status": "running" }
    ],
    "edges": [
      { "from": "yelp_search", "to": "join_results", "status": "completed" }
    ]
  }
}
```

---

### 3. Error & Retry Events

#### `node_retry`
**When:** A node fails and is being retried

```json
{
  "type": "node_retry",
  "timestamp": 1698765435000,
  "nodeId": "osrm_table",
  "reason": "Timeout (>3s)",
  "attempt": 2,
  "state": {
    "nodes": [
      {
        "id": "osrm_table",
        "name": "Google Maps",
        "type": "http",
        "status": "retrying",
        "retry_count": 1
      }
    ],
    "edges": []
  }
}
```

#### `fallback_activated`
**When:** System switches to a fallback API/service

```json
{
  "type": "fallback_activated",
  "timestamp": 1698765436000,
  "originalNode": "osrm_table",
  "fallbackNode": "osrm_table_fallback",
  "message": "Switched to backup map service",
  "state": {
    "nodes": [
      {
        "id": "osrm_table",
        "name": "Google Maps",
        "type": "http",
        "status": "failed"
      },
      {
        "id": "osrm_table_fallback",
        "name": "Google Maps (Fallback)",
        "type": "http",
        "status": "running"
      }
    ],
    "edges": [
      { "from": "yelp_search", "to": "osrm_table_fallback", "status": "completed" },
      { "from": "osrm_table_fallback", "to": "join_results", "status": "pending" }
    ]
  }
}
```

---

### 4. Completion Events

#### `pipeline_complete`
**When:** All nodes finish execution (success or partial success)

```json
{
  "type": "pipeline_complete",
  "timestamp": 1698765437000,
  "message": "Pipeline completed successfully",
  "state": {
    "nodes": [
      {
        "id": "yelp_search",
        "name": "Yelp Search",
        "type": "http",
        "status": "completed",
        "latency_ms": 245
      },
      {
        "id": "osrm_table",
        "name": "Google Maps",
        "type": "http",
        "status": "completed",
        "latency_ms": 387
      },
      {
        "id": "join_results",
        "name": "Join Results",
        "type": "transform",
        "status": "completed",
        "latency_ms": 12
      }
    ],
    "edges": [
      { "from": "yelp_search", "to": "join_results", "status": "completed" },
      { "from": "osrm_table", "to": "join_results", "status": "completed" }
    ],
    "correlation": {
      "data": [
        { "rating": 4.8, "eta": 12 },
        { "rating": 4.6, "eta": 8 },
        { "rating": 4.7, "eta": 15 }
      ],
      "insight": "Higher-rated restaurants are typically 3 minutes farther away"
    },
    "summary": "Found 42 restaurants near Berkeley with real-time ETA"
  },
  "health": {
    "run_time_sec": 3.9,
    "avg_latency_ms": 337,
    "fail_rate_24h": 0.03,
    "auto_reroutes": 1,
    "recommendations": [
      "Batch ETA calls to reduce OSRM latency",
      "Consider caching weather data for 15min"
    ]
  }
}
```

---

## Node Object Schema

Each node in the `state.nodes` array should have:

```typescript
{
  id: string,              // Unique identifier (e.g., "yelp_search_001")
  name: string,            // Display name (e.g., "Yelp Search API")
  type: "http" | "transform" | "core",  // Node type
  status: "pending" | "running" | "completed" | "failed" | "retrying",
  latency_ms?: number,     // Only after completion
  retry_count?: number,    // Number of retry attempts
  r?: number,             // Optional: visual radius for D3 (default: 25)
  error_message?: string   // Optional: error details if failed
}
```

## Edge Object Schema

Each edge in the `state.edges` array should have:

```typescript
{
  from: string,   // Source node ID
  to: string,     // Target node ID
  status: "pending" | "completed" | "failed"
}
```

---

## Health Metrics Schema

Optional health/performance data sent with `pipeline_complete`:

```typescript
{
  run_time_sec: number,        // Total execution time
  avg_latency_ms: number,      // Average API latency
  fail_rate_24h: number,       // Failure rate (0.0 to 1.0)
  auto_reroutes: number,       // Number of fallback activations
  recommendations?: string[]    // Optional optimization suggestions
}
```

---

## Minimal Working Example

A complete event stream for a simple pipeline:

```json
// 1. Planning starts
{"type": "planning_start", "timestamp": 1698765432000}

// 2. Nodes discovered
{"type": "node_discovered", "timestamp": 1698765432100, "nodeId": "yelp", "state": {...}}
{"type": "node_discovered", "timestamp": 1698765432200, "nodeId": "maps", "state": {...}}

// 3. Planning complete
{"type": "planning_complete", "timestamp": 1698765433000, "state": {...}}

// 4. Execution begins
{"type": "execution_start", "timestamp": 1698765433500}

// 5. Node execution
{"type": "node_start", "timestamp": 1698765433600, "nodeId": "yelp", "state": {...}}
{"type": "node_complete", "timestamp": 1698765434000, "nodeId": "yelp", "latency_ms": 245, "state": {...}}

{"type": "node_start", "timestamp": 1698765434100, "nodeId": "maps", "state": {...}}
{"type": "node_complete", "timestamp": 1698765434500, "nodeId": "maps", "latency_ms": 387, "state": {...}}

// 6. Pipeline complete
{"type": "pipeline_complete", "timestamp": 1698765435000, "state": {...}, "health": {...}}
```

---

## Integration Notes

### Frontend Event Handling

The frontend filters out noisy events automatically:

**Filtered Events** (set to `null` in `eventMessages.js`):
- `node_discovered` - Too frequent during planning
- `node_progress` - Progress updates are visual noise
- `planning_update` - Intermediate planning states
- `execution_complete` - Redundant with `pipeline_complete`
- `final_state` - Internal bookkeeping

**Displayed Events:**
- `planning_start` → "🧠 Figuring out the best way to do this..."
- `planning_complete` → "✅ Plan is ready! Starting now..."
- `node_start` → "🔍 Looking up nearby restaurants..." (node-specific)
- `node_complete` → "✅ Yelp Search completed"
- `node_retry` → "🔁 Retrying..."
- `fallback_activated` → "🧭 Switched to backup service"
- `pipeline_complete` → "🌟 Workflow complete!"

### Postman Flow Implementation

In your Postman Flow Action:

1. **Accept SSE connection** from frontend
2. **Execute blocks** in DAG order (topological sort)
3. **Emit events** after each significant state change:
   - When planning starts/completes
   - When each node starts/completes
   - On errors/retries
   - When pipeline finishes
4. **Include full state** in each event for graph updates
5. **Calculate metrics** for final health object

---

## Example Postman Flow Structure

```
┌──────────────┐
│   AI Core    │ ← Analyzes request, plans DAG
└──────────────┘
       ↓
┌──────────────┐
│ Yelp Search  │ ← HTTP Block #1
└──────────────┘
       ↓
┌──────────────┐
│  OSRM Maps   │ ← HTTP Block #2 (parallel)
└──────────────┘
       ↓
┌──────────────┐
│ Join Results │ ← Transform Block
└──────────────┘
       ↓
┌──────────────┐
│ Rank & Sort  │ ← Transform Block
└──────────────┘
       ↓
     Output
```

Each block should emit events at key lifecycle points (start, complete, fail).

