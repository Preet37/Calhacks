import React, { useEffect, useState } from 'react'
import PipelineFlow from './components/PipelineFlow'
import NeuralCosmos from './components/NeuralCosmos'
import ActivitySummaryPanel from './components/ActivitySummaryPanel'
import InsightsPanel from './components/InsightsPanel'
import NarrationPanel from './components/NarrationPanel'
import { pipelineStream } from './services/mockPipelineStream'
import { formatEventMessage, extractEmoji } from './utils/eventMessages'
import { calculateRunStats } from './utils/statsCalculator'
import { generateInsight } from './services/insightGenerator'

// TaskOrbitApp: Main application container
export default function TaskOrbitApp() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [viewMode, setViewMode] = useState('orbit') // 'orbit' or 'flow'
  const [displayMode, setDisplayMode] = useState('simple') // 'simple' or 'advanced'
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamHealth, setStreamHealth] = useState(null)
  const [lastEvent, setLastEvent] = useState(null)
  
  // New state for narrative panels
  const [activityLogs, setActivityLogs] = useState([])
  const [runStats, setRunStats] = useState(null)
  const [insight, setInsight] = useState(null)

  // Subscribe to pipeline events
  useEffect(() => {
    const unsubscribe = pipelineStream.subscribe((event) => {
      handleStreamEvent(event)
    })

    return () => unsubscribe()
  }, [])

  const handleStreamEvent = (event) => {
    // Track last event for narration
    setLastEvent(event)
    
    // Convert event to human-friendly message for activity log
    const node = event.state?.nodes?.find(n => n.id === event.nodeId)
    const humanMessage = formatEventMessage(event, node)
    
    // Only add to activity logs if message is not null (filter out noisy events)
    if (humanMessage !== null) {
      const { emoji, text } = extractEmoji(humanMessage)
      
      setActivityLogs(prev => [...prev, {
        emoji,
        message: text,
        apiName: node?.name,
        timestamp: new Date(event.timestamp).toLocaleTimeString()
      }].slice(-100)) // Keep last 100 activity logs
    }

    // Update pipeline state
    if (event.state) {
      setData(prev => ({
        ...prev,
        pipeline_spec: {
          nodes: event.state.nodes.filter(n => n.type !== 'core'),
          edges: event.state.edges
        },
        correlation: event.state.correlation,
        summary: event.state.summary
      }))
    }

    // Update health metrics
    if (event.health) {
      setStreamHealth(event.health)
    }

    // Handle completion - calculate stats and generate insight
    if (event.type === 'pipeline_complete' && event.state) {
      setIsStreaming(false)
      
      // Calculate run statistics
      const stats = calculateRunStats(event.state)
      setRunStats(stats)
      
      // Generate insight (with LLM or template)
      generateInsight(event.state, activityLogs).then(generatedInsight => {
        setInsight(generatedInsight)
      }).catch(err => {
        console.error('Failed to generate insight:', err)
        setInsight('Workflow completed successfully')
      })
    }
  }

  // Start a new pipeline run
  const startNewRun = async () => {
    setIsStreaming(true)
    setStreamHealth(null)
    setActivityLogs([])
    setRunStats(null)
    setInsight(null)
    setData({
      summary: 'Pipeline executing...',
      pipeline_spec: { nodes: [], edges: [] },
      correlation: { data: [] }
    })

    await pipelineStream.startPipeline('Find trending AI repos and summarize')
  }

  // Initialize with empty state
  useEffect(() => {
    setData({
      summary: 'Ready to start pipeline...',
      pipeline_spec: { nodes: [], edges: [] },
      correlation: { data: [] }
    })

    // Auto-start a pipeline run after a brief delay
    setTimeout(() => {
      startNewRun()
    }, 500)
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const response = await fetch('/demo.json')
      if (!response.ok) throw new Error('Failed to fetch data')
      const json = await response.json()
      setData(json)
      setError(null)
    } catch (err) {
      setError(err.message)
      console.error('Error fetching data:', err)
    } finally {
      setLoading(false)
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-border border-t-foreground rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground text-sm">Loading pipeline...</p>
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="bg-secondary border border-border rounded-lg p-6 max-w-md">
          <h2 className="text-foreground text-base font-medium mb-2">Failed to load data</h2>
          <p className="text-muted-foreground text-sm mb-4">{error}</p>
          <button
            onClick={fetchData}
            className="bg-foreground text-background px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 transition"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  // Show minimal loading if data hasn't initialized yet
  if (!data) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-border border-t-foreground rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground text-sm">Initializing...</p>
        </div>
      </div>
    )
  }

  // Main layout
  return (
    <div className="h-screen w-screen overflow-hidden bg-background">
      {/* Minimal Header */}
      <header className="h-14 border-b border-border flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <circle cx="12" cy="12" r="3" strokeWidth="1.5" />
              <circle cx="12" cy="12" r="8" strokeWidth="1.5" strokeDasharray="2 2" opacity="0.5" />
            </svg>
            <h1 className="text-foreground text-sm font-medium">TaskOrbit</h1>
          </div>
          <span className="text-muted-foreground text-xs">Pipeline Visualizer</span>
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
        {/* Left Panel: Activity + Summary */}
        <div className="col-span-3 row-span-12">
          <ActivitySummaryPanel
            logs={activityLogs}
            runStats={runStats}
            displayMode={displayMode}
          />
        </div>

        {/* Center: Visualization */}
        <div className="col-span-6 row-span-12">
          <div className="bg-secondary/30 border border-border rounded-lg h-full overflow-hidden flex flex-col">
            {/* Narration Panel - Only in Simple mode */}
            {displayMode === 'simple' && viewMode === 'orbit' && (
              <div className="h-16 flex-shrink-0">
                <NarrationPanel 
                  currentEvent={lastEvent} 
                  pipelineSpec={data?.pipeline_spec}
                />
              </div>
            )}
            
            {/* Visualization */}
            <div className="flex-1 overflow-hidden">
              {viewMode === 'orbit' ? (
                <NeuralCosmos
                  pipelineSpec={data?.pipeline_spec}
                  isStreaming={isStreaming}
                  displayMode={displayMode}
                  lastEvent={lastEvent}
                />
              ) : (
                <PipelineFlow pipelineSpec={data?.pipeline_spec} />
              )}
            </div>
          </div>
        </div>

        {/* Right Panel: Insights */}
        <div className="col-span-3 row-span-12">
          <InsightsPanel
            insight={insight}
            correlation={data?.correlation}
            stats={streamHealth || data?.health}
            displayMode={displayMode}
          />
        </div>
      </div>

    </div>
  )
}
