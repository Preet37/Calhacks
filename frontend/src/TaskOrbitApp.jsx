import React, { useEffect, useState, useRef, useCallback } from 'react';
import PipelineFlow from './components/PipelineFlow';
import NeuralCosmos from './components/NeuralCosmos';
import ActivitySummaryPanel from './components/ActivitySummaryPanel';
import InsightsPanel from './components/InsightsPanel';
import NarrationPanel from './components/NarrationPanel';
// Removed: import { pipelineStream } from './services/mockPipelineStream'
import { formatEventMessage, extractEmoji } from './utils/eventMessages';
import { calculateRunStats } from './utils/statsCalculator';
import { generateInsight } from './services/insightGenerator';

// TaskOrbitApp: Main application container
export default function TaskOrbitApp() {
    const [data, setData] = useState({ // Initialize with a structure
        summary: 'Ready to start pipeline...',
        pipeline_spec: { nodes: [], edges: [] },
        correlation: { data: [] },
        health: null,
    });
    const [loading, setLoading] = useState(false); // Used only if fetching initial state, not currently used
    const [error, setError] = useState(null);
    const [viewMode, setViewMode] = useState('orbit'); // 'orbit' or 'flow'
    const [displayMode, setDisplayMode] = useState('simple'); // 'simple' or 'advanced'
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamHealth, setStreamHealth] = useState(null); // Health from SSE
    const [lastEvent, setLastEvent] = useState(null);

    // New state for narrative panels
    const [activityLogs, setActivityLogs] = useState([]);
    const [runStats, setRunStats] = useState(null); // Stats calculated client-side on completion
    const [insight, setInsight] = useState(null);

    // Add state for EventSource connection
    const [eventSource, setEventSource] = useState(null);
    // Use a ref to keep track of the current state for event handlers
    const dataRef = useRef(data);
    const activityLogsRef = useRef(activityLogs);

    // Update refs whenever state changes
    useEffect(() => { dataRef.current = data; }, [data]);
    useEffect(() => { activityLogsRef.current = activityLogs; }, [activityLogs]);

    // Define handleStreamEvent using useCallback to prevent re-creation
    const handleStreamEvent = useCallback((event) => {
        // console.log("Handling SSE event:", event); // Debug log
        setLastEvent(event); // Track last event for narration

        // --- Update Pipeline State based on Event ---
        let currentPipelineSpec = dataRef.current?.pipeline_spec || { nodes: [], edges: [] };
        let updatedState = event.state || {}; // Use state from event if available

        // If event is node_start/complete/fail, update the specific node/edges
        if (event.nodeId && (event.type === 'node_start' || event.type === 'node_complete' || event.type === 'node_fail')) {
            const nodes = currentPipelineSpec.nodes.map(n =>
                n.id === event.nodeId
                    ? { ...n, status: event.status || (event.type === 'node_start' ? 'running' : 'unknown'), latency_ms: event.latency_ms }
                    : n
            );
            // Update edge statuses based on node completion/failure
            const edges = currentPipelineSpec.edges.map(e => {
                 if (e.from === event.nodeId && event.type === 'node_complete') return { ...e, status: 'completed'};
                 if (e.from === event.nodeId && event.type === 'node_fail') return { ...e, status: 'failed'};
                 // Optional: mark incoming edges as running when node starts
                 // if (e.to === event.nodeId && event.type === 'node_start') return { ...e, status: 'running'};
                 return e;
            });
            updatedState.nodes = nodes;
            updatedState.edges = edges;
        }

        // Merge event state with current data state if nodes/edges are present
        if (updatedState.nodes || updatedState.edges) {
             setData(prev => ({
                ...prev,
                pipeline_spec: {
                    nodes: updatedState.nodes || prev.pipeline_spec.nodes,
                    edges: updatedState.edges || prev.pipeline_spec.edges,
                },
                // Update correlation and summary if provided in the state
                correlation: updatedState.correlation || prev.correlation,
                summary: updatedState.summary || prev.summary,
            }));
        }


        // --- Update Activity Log ---
        // Find node info even if not directly in event, using the latest spec
        const nodeInfo = updatedState.nodes?.find(n => n.id === event.nodeId) || currentPipelineSpec.nodes.find(n => n.id === event.nodeId);
        const humanMessage = formatEventMessage(event, nodeInfo);

        if (humanMessage !== null) {
            const { emoji, text } = extractEmoji(humanMessage);
            const newLog = {
                emoji,
                message: text,
                apiName: nodeInfo?.name, // Use the friendly name from spec
                timestamp: new Date(event.timestamp || Date.now()).toLocaleTimeString()
            };
            setActivityLogs(prev => [...prev, newLog].slice(-100)); // Add new log
        }

        // --- Update Health Metrics ---
        if (event.health) {
            setStreamHealth(event.health);
        }

        // --- Handle Completion ---
        if ((event.type === 'pipeline_complete' || event.type === 'finished') && (updatedState.nodes || event.state)) {
             console.log("Pipeline complete event received:", event);
             setIsStreaming(false); // Set streaming to false

            // Ensure we use the final state from the event if possible
            const finalState = event.state || { nodes: updatedState.nodes, edges: updatedState.edges };

            if (finalState.nodes) {
                 // Calculate run statistics from the final node states
                 const stats = calculateRunStats(finalState);
                 setRunStats(stats);
                 console.log("Calculated final Run Stats:", stats);

                 // Generate insight using the final state and logs
                 generateInsight(finalState, activityLogsRef.current).then(generatedInsight => {
                    setInsight(generatedInsight);
                 }).catch(err => {
                    console.error('Failed to generate insight:', err);
                    setInsight('Workflow completed.'); // Simple fallback
                 });
            } else {
                 console.warn("Pipeline complete event missing final state for stats/insight generation.");
                 setInsight('Workflow finished.');
            }

            // Update health with final metrics if provided
             if(event.health) setStreamHealth(event.health);

            // Close SSE connection if not already closed
            if (eventSource) {
                 console.log("Closing SSE connection on pipeline completion.");
                 eventSource.close();
                 setEventSource(null);
            }
        }

         // --- Handle Top-Level Error ---
         if (event.type === 'error' ) {
              console.error("Pipeline error event received:", event.error);
              setError(`Pipeline Error: ${event.error || 'Unknown error'}`);
              setIsStreaming(false);
              setRunStats(prev => ({ ...prev, completed: false, failures: (prev?.failures || 0) + 1 })); // Mark as incomplete
              setInsight(`The workflow encountered an error: ${event.error || 'Unknown error'}`);
              if (eventSource) {
                   console.log("Closing SSE connection on pipeline error.");
                   eventSource.close();
                   setEventSource(null);
              }
         }

    }, [eventSource]); // Include eventSource in dependencies

    // Start a new pipeline run by calling the backend
    const startNewRun = async () => {
        // Close any existing SSE connection
        if (eventSource) {
            eventSource.close();
            setEventSource(null);
            console.log("Closed previous EventSource connection.");
        }

        setIsStreaming(true);
        setStreamHealth(null);
        setActivityLogs([]); // Clear logs for new run
        setRunStats(null);
        setInsight(null);
        setData({ // Reset data state
            summary: 'Starting pipeline...',
            pipeline_spec: { nodes: [], edges: [] },
            correlation: { data: [] },
            health: null, // Reset health too
        });
        setError(null); // Clear previous errors

        // Generate a unique ID for this run on the client-side
        const runId = "run_" + Math.random().toString(36).substring(2, 10);
        console.log(`Generated client-side runId: ${runId}`);

        try {
            console.log(`Connecting to SSE for runId: ${runId}...`);
             // --- CONNECT TO SSE STREAM ---
            const newEventSource = new EventSource(`http://localhost:8080/events/${runId}`);
            setEventSource(newEventSource); // Store the active connection immediately

            newEventSource.onopen = () => {
                console.log(`SSE connection opened for runId: ${runId}. Sending POST request...`);

                 // --- Now SEND THE POST REQUEST including the runId ---
                fetch('http://localhost:8080/run', { // Make sure port matches your backend
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        runId: runId, // Send the generated runId
                        goal: "Analyze restaurant proximity and weather; show quality vs ETA.",
                        context: {
                            origin: "37.8715,-122.2730",
                            radius_m: 800,
                            time: "today"
                        },
                        useMocks: false // Force live mode
                    })
                })
                .then(async response => {
                    if (!response.ok) {
                        const errorBody = await response.text();
                         console.error(`Backend /run error response: ${response.status}`, errorBody);
                        throw new Error(`Backend error: ${response.status} ${errorBody}`);
                    }
                    // We don't necessarily need the body if SSE handles completion
                    // const result = await response.json();
                    // console.log("Received response from /run:", result);
                     console.log("POST /run successful, waiting for SSE events...");
                })
                .catch(err => { // Catch fetch errors specifically
                     console.error('Error sending POST /run request:', err);
                     setError(`Failed to start run: ${err.message}`);
                     setIsStreaming(false);
                     newEventSource.close(); // Close SSE if POST fails
                     setEventSource(null);
                });
            };

            newEventSource.onerror = (err) => {
                console.error("EventSource failed:", err);
                // Check if it's a connection refusal
                if (err.target && err.target.readyState === EventSource.CLOSED) {
                    setError(`Could not connect to backend event stream at http://localhost:8080/events/${runId}. Is the backend running?`);
                } else {
                    setError(`SSE connection error for run ${runId}.`);
                }
                setIsStreaming(false);
                newEventSource.close();
                setEventSource(null); // Clear the eventSource state
            };

            // Listen for specific event types from your backend
            // Match these to the 'event:' names in your backend's sseSend calls
             const eventTypes = [
                 'hello', 'planning_start', 'planning_complete', 'execution_start',
                 'node_start', 'node_complete', 'node_fail', // Use node_fail
                 'pipeline_complete', 'error', 'finished', // Use finished
                 'log', 'spec', 'status', 'result', // Add backend's actual event names
             ];

            eventTypes.forEach(type => {
                newEventSource.addEventListener(type, (event) => {
                    try {
                        const eventData = JSON.parse(event.data);
                        // console.log(`Received SSE event (${type}):`, eventData); // Less verbose log
                         handleStreamEvent({ type: type, ...eventData }); // Pass type explicitly

                        // Check for final events to close connection
                        if (type === 'pipeline_complete' || type === 'finished' || type === 'error') {
                             console.log(`Run ${runId} finished via ${type} event. Closing SSE.`);
                             setIsStreaming(false);
                             newEventSource.close();
                             setEventSource(null); // Clear state
                        }
                    } catch (e) {
                        console.error("Error parsing SSE event data:", e, "Raw data:", event.data);
                    }
                });
            });


        } catch (err) { // Catch errors setting up EventSource (unlikely)
            console.error('Error setting up EventSource:', err);
            setError(`Failed to setup event stream: ${err.message}`);
            setIsStreaming(false);
        }
    };


    // Remove or comment out the auto-start useEffect if you want manual start
    // useEffect(() => {
    //    // Auto-start a pipeline run after a brief delay
    //    const timer = setTimeout(() => {
    //      startNewRun();
    //    }, 1500); // Increased delay
    //    return () => clearTimeout(timer);
    // }, []); // Runs only once on mount

     // Remove or comment out fetchData if not using demo.json anymore
     // const fetchData = async () => { /* ... */ };

    // --- RENDER LOGIC --- (Keep the existing render logic for loading, error, and main layout)


    // Error state
    if (error) {
        return (
          <div className="h-screen w-screen flex items-center justify-center bg-background">
            <div className="bg-secondary border border-border rounded-lg p-6 max-w-md text-center">
              <h2 className="text-red-500 text-lg font-medium mb-2">Error</h2>
              <p className="text-muted-foreground text-sm mb-4">{error}</p>
              <button
                onClick={startNewRun} // Make retry button start a new run
                className="bg-foreground text-background px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 transition"
              >
                Retry Run
              </button>
            </div>
          </div>
        )
      }


    // Main layout
    return (
        <div className="h-screen w-screen overflow-hidden bg-background">
            {/* Header */}
            <header className="h-14 border-b border-border flex items-center justify-between px-6">
                {/* ... (keep existing header content: title, toggles, status, button) ... */}
                 <div className="flex items-center gap-3">
                   <div className="flex items-center gap-2">
                     <svg className="w-5 h-5 text-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                       <circle cx="12" cy="12" r="3" strokeWidth="1.5" />
                       <circle cx="12" cy="12" r="8" strokeWidth="1.5" strokeDasharray="2 2" opacity="0.5" />
                     </svg>
                     <h1 className="text-foreground text-sm font-medium">MetaForge</h1> {/* Updated Name */}
                   </div>
                   <span className="text-muted-foreground text-xs">AI Pipeline Visualizer</span>
                 </div>

                 <div className="flex items-center gap-3">
                   {/* View Mode Toggle */}
                   <div className="flex items-center gap-1 bg-secondary border border-border rounded-md p-1">
                     <button
                       onClick={() => setViewMode('orbit')}
                       className={`text-xs px-2.5 py-1 rounded transition ${
                         viewMode === 'orbit'
                           ? 'bg-foreground text-background'
                           : 'text-muted-foreground hover:text-foreground'
                       }`}
                     >
                       Neural
                     </button>
                     <button
                       onClick={() => setViewMode('flow')}
                       className={`text-xs px-2.5 py-1 rounded transition ${
                         viewMode === 'flow'
                           ? 'bg-foreground text-background'
                           : 'text-muted-foreground hover:text-foreground'
                       }`}
                     >
                       Flow
                     </button>
                   </div>

                   {/* Display Mode Toggle */}
                   <div className="flex items-center gap-1 bg-secondary border border-border rounded-md p-1">
                     <button
                       onClick={() => setDisplayMode('simple')}
                       className={`text-xs px-2.5 py-1 rounded transition ${
                         displayMode === 'simple'
                           ? 'bg-foreground text-background'
                           : 'text-muted-foreground hover:text-foreground'
                       }`}
                     >
                       Simple
                     </button>
                     <button
                       onClick={() => setDisplayMode('advanced')}
                       className={`text-xs px-2.5 py-1 rounded transition ${
                         displayMode === 'advanced'
                           ? 'bg-foreground text-background'
                           : 'text-muted-foreground hover:text-foreground'
                       }`}
                     >
                       Advanced
                     </button>
                   </div>

                   <div className="h-4 w-px bg-border" />

                   <div className="flex items-center gap-1.5">
                     <div className={`w-1.5 h-1.5 rounded-full ${isStreaming ? 'bg-green-500 animate-pulse' : 'bg-foreground'}`} />
                     <span className="text-muted-foreground text-[10px]">{isStreaming ? 'Running' : 'Idle'}</span>
                   </div>
                   <button
                     onClick={startNewRun}
                     disabled={isStreaming}
                     className="text-xs bg-foreground text-background px-3 py-1.5 rounded-md hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
                   >
                     {isStreaming ? 'Running...' : 'New Run'}
                   </button>
                 </div>
            </header>

            {/* Main Grid Layout */}
            <div className="h-[calc(100vh-3.5rem)] grid grid-cols-12 grid-rows-12 gap-3 p-4">
                {/* Left Panel */}
                <div className="col-span-3 row-span-12">
                    <ActivitySummaryPanel
                        logs={activityLogs}
                        runStats={runStats}
                        displayMode={displayMode}
                    />
                </div>

                {/* Center */}
                <div className="col-span-6 row-span-12">
                    <div className="bg-secondary/30 border border-border rounded-lg h-full overflow-hidden flex flex-col">
                        {displayMode === 'simple' && viewMode === 'orbit' && (
                            <div className="h-16 flex-shrink-0">
                                <NarrationPanel
                                    currentEvent={lastEvent}
                                    pipelineSpec={data?.pipeline_spec}
                                />
                            </div>
                        )}
                        <div className="flex-1 overflow-hidden">
                             {/* Conditional rendering based on data readiness */}
                             {!data?.pipeline_spec?.nodes?.length && isStreaming && (
                                <div className="h-full flex items-center justify-center">
                                    <div className="text-center">
                                        <div className="w-8 h-8 border-2 border-border border-t-foreground rounded-full animate-spin mx-auto mb-3" />
                                        <p className="text-muted-foreground text-xs">Planning pipeline...</p>
                                    </div>
                                </div>
                             )}
                             {data?.pipeline_spec?.nodes?.length > 0 && (
                                 viewMode === 'orbit' ? (
                                    <NeuralCosmos
                                        pipelineSpec={data?.pipeline_spec}
                                        isStreaming={isStreaming}
                                        displayMode={displayMode}
                                        lastEvent={lastEvent}
                                    />
                                 ) : (
                                    <PipelineFlow pipelineSpec={data?.pipeline_spec} />
                                 )
                             )}
                              {!isStreaming && (!data || !data.pipeline_spec || data.pipeline_spec.nodes.length === 0) && !error && (
                                <div className="h-full flex items-center justify-center">
                                    <p className="text-muted-foreground text-sm italic">Click "New Run" to start</p>
                                </div>
                             )}
                        </div>
                    </div>
                </div>

                {/* Right Panel */}
                <div className="col-span-3 row-span-12">
                    <InsightsPanel
                        insight={insight}
                        correlation={data?.correlation}
                        // Pass combined health/stats: SSE health takes precedence, then final health from data
                        stats={streamHealth || data?.health || runStats } // Pass calculated runStats too
                        displayMode={displayMode}
                    />
                </div>
            </div>
        </div>
    );
}