import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

// Get performance-based color
const getPerformanceColor = (latency_ms, type) => {
  const coolColors = ['#3b82f6', '#06b6d4', '#8b5cf6', '#6366f1', '#0ea5e9', '#14b8a6']
  const warmColors = ['#f59e0b', '#f97316', '#ef4444', '#dc2626', '#fb923c', '#ea580c']
  const purpleColors = ['#a855f7', '#c084fc', '#9333ea', '#d946ef', '#e879f9']

  if (type === 'transform') {
    return purpleColors[Math.floor(Math.random() * purpleColors.length)]
  }

  if (latency_ms < 200) return coolColors[Math.floor(Math.random() * coolColors.length)]
  if (latency_ms < 300) return coolColors[Math.floor(Math.random() * 3)]
  if (latency_ms < 400) return ['#10b981', '#14b8a6', '#06b6d4'][Math.floor(Math.random() * 3)]
  return warmColors[Math.floor(Math.random() * warmColors.length)]
}

// OrbitingNode component
function OrbitingNode({ node, radius, speed, centerX, centerY, onHover, onClick, frozen }) {
  const color = getPerformanceColor(node.latency_ms || 150, node.type)

  // Calculate animation duration based on speed and latency
  const latencyFactor = node.latency_ms ? (500 / node.latency_ms) : 1
  const duration = (50 / (speed * latencyFactor)) // seconds for one full orbit

  const startAngle = Math.random() * 360

  return (
    <g
      style={{ cursor: 'pointer' }}
      onMouseEnter={(e) => onHover({ show: true, node, x: e.clientX, y: e.clientY })}
      onMouseLeave={() => onHover({ show: false })}
      onClick={() => onClick(node.id)}
    >
      <g transform={`translate(${centerX}, ${centerY})`}>
        {/* Use animateTransform for smooth orbit without state updates */}
        <g>
          {!frozen && (
            <animateTransform
              attributeName="transform"
              attributeType="XML"
              type="rotate"
              from={`${startAngle} 0 0`}
              to={`${startAngle + 360} 0 0`}
              dur={`${duration}s`}
              repeatCount="indefinite"
            />
          )}
          {frozen && (
            <animateTransform
              attributeName="transform"
              attributeType="XML"
              type="rotate"
              from={`${startAngle} 0 0`}
              to={`${startAngle} 0 0`}
              dur="0.1s"
              repeatCount="1"
            />
          )}

          <g transform={`translate(${radius}, 0)`}>
            {/* Glow effect */}
            <circle
              r="20"
              fill={color}
              opacity="0.1"
            />
            <circle
              r="14"
              fill={color}
              opacity="0.2"
            />

            {/* Main node */}
            <circle
              r="10"
              fill={color}
              stroke={color}
              strokeWidth="2"
              opacity="0.9"
              filter="url(#glow)"
            />

            {/* Text group with counter-rotation to keep upright */}
            <g>
              {!frozen && (
                <animateTransform
                  attributeName="transform"
                  attributeType="XML"
                  type="rotate"
                  from={`${-startAngle} 0 0`}
                  to={`${-startAngle - 360} 0 0`}
                  dur={`${duration}s`}
                  repeatCount="indefinite"
                />
              )}

              {/* Node label */}
              <text
                y="-18"
                textAnchor="middle"
                fill="hsl(0, 0%, 98%)"
                fontSize="11"
                fontWeight="500"
                style={{ pointerEvents: 'none' }}
              >
                {node.name}
              </text>

              {/* Type label */}
              <text
                y="28"
                textAnchor="middle"
                fill={color}
                fontSize="9"
                opacity="0.8"
                style={{ pointerEvents: 'none' }}
              >
                {node.type === 'http' ? 'API' : 'Transform'}
              </text>
            </g>
          </g>
        </g>
      </g>
    </g>
  )
}

// ConnectionLine component
function ConnectionLine({ fromNode, toNode, status, nodePositions, centerX, centerY }) {
  const from = nodePositions[fromNode.id]
  const to = nodePositions[toNode.id]

  if (!from || !to) return null

  const color = status === 'completed' ? '#10b981' : '#ef4444'

  return (
    <g opacity="0.4">
      <motion.line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke={color}
        strokeWidth="1.5"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.5 }}
      />

      {/* Animated particle */}
      {status === 'completed' && (
        <motion.circle
          r="3"
          fill={color}
          initial={{ offsetDistance: '0%' }}
          animate={{ offsetDistance: '100%' }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
        >
          <animateMotion dur="2s" repeatCount="indefinite">
            <mpath xlinkHref={`#path-${fromNode.id}-${toNode.id}`} />
          </animateMotion>
        </motion.circle>
      )}

      {/* Hidden path for animation */}
      <path
        id={`path-${fromNode.id}-${toNode.id}`}
        d={`M ${from.x} ${from.y} L ${to.x} ${to.y}`}
        fill="none"
        stroke="none"
      />
    </g>
  )
}

// Main 2D Orbit Canvas
export default function OrbitCanvas2D({ pipelineSpec, logs }) {
  const [tooltip, setTooltip] = useState({ show: false })
  const [frozenNodes, setFrozenNodes] = useState([])
  const [nodePositions, setNodePositions] = useState({})

  const width = 800
  const height = 600
  const centerX = width / 2
  const centerY = height / 2

  // Calculate node positions for connections
  useEffect(() => {
    if (!pipelineSpec) return

    const orbitRadii = { http: 150, transform: 250 }
    const positions = {}

    pipelineSpec.nodes.forEach(node => {
      const radius = orbitRadii[node.type] || 150
      // We'll update these in real-time, but set initial position
      positions[node.id] = { x: centerX, y: centerY, radius }
    })

    setNodePositions(positions)
  }, [pipelineSpec, centerX, centerY])

  const handleNodeClick = (nodeId) => {
    setFrozenNodes(prev =>
      prev.includes(nodeId) ? prev.filter(id => id !== nodeId) : [...prev, nodeId]
    )
  }

  const orbitRadii = {
    http: 150,
    transform: 250
  }

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-gradient-to-br from-background via-secondary/20 to-background">
      <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`}>
        {/* Definitions */}
        <defs>
          {/* Glow filter */}
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Radial gradient for center */}
          <radialGradient id="centerGlow">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
            <stop offset="50%" stopColor="#3b82f6" stopOpacity="0.1" />
            <stop offset="100%" stopColor="transparent" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Orbit rings */}
        {Object.values(orbitRadii).map((radius, i) => (
          <circle
            key={i}
            cx={centerX}
            cy={centerY}
            r={radius}
            fill="none"
            stroke="hsl(240, 3.7%, 15.9%)"
            strokeWidth="1"
            opacity="0.3"
          />
        ))}

        {/* Center AI Planner */}
        <g>
          {/* Outer glow */}
          <circle
            cx={centerX}
            cy={centerY}
            r="60"
            fill="url(#centerGlow)"
          />

          {/* Pulsing ring */}
          <motion.circle
            cx={centerX}
            cy={centerY}
            r="45"
            fill="none"
            stroke="#3b82f6"
            strokeWidth="1"
            opacity="0.3"
            animate={{ r: [40, 50, 40] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          />

          {/* Core */}
          <circle
            cx={centerX}
            cy={centerY}
            r="35"
            fill="hsl(240, 10%, 3.9%)"
            stroke="#3b82f6"
            strokeWidth="2"
            filter="url(#glow)"
          />

          {/* Inner bright core */}
          <circle
            cx={centerX}
            cy={centerY}
            r="20"
            fill="#3b82f6"
            opacity="0.8"
          />

          {/* Label */}
          <text
            x={centerX}
            y={centerY - 50}
            textAnchor="middle"
            fill="hsl(0, 0%, 98%)"
            fontSize="14"
            fontWeight="600"
          >
            AI Planner
          </text>
        </g>

        {/* Connection lines */}
        {pipelineSpec?.edges.map((edge, i) => {
          const fromNode = pipelineSpec.nodes.find(n => n.id === edge.from)
          const toNode = pipelineSpec.nodes.find(n => n.id === edge.to)
          if (!fromNode || !toNode) return null

          return (
            <ConnectionLine
              key={i}
              fromNode={fromNode}
              toNode={toNode}
              status={edge.status}
              nodePositions={nodePositions}
              centerX={centerX}
              centerY={centerY}
            />
          )
        })}

        {/* Orbiting nodes */}
        {pipelineSpec?.nodes.map(node => (
          <OrbitingNode
            key={node.id}
            node={node}
            radius={orbitRadii[node.type] || 150}
            speed={node.type === 'http' ? 0.5 : 0.3}  // Reduced from 0.8/0.5 to 0.5/0.3
            centerX={centerX}
            centerY={centerY}
            onHover={setTooltip}
            onClick={handleNodeClick}
            frozen={frozenNodes.includes(node.id)}
          />
        ))}
      </svg>

      {/* Tooltip */}
      {tooltip.show && tooltip.node && (
        <div
          className="fixed bg-secondary border border-border text-xs p-2.5 rounded-md pointer-events-none z-50 shadow-lg"
          style={{ left: tooltip.x + 10, top: tooltip.y - 10 }}
        >
          <div className="font-medium text-foreground mb-1">{tooltip.node.name}</div>
          <div className="text-muted-foreground text-[10px] space-y-0.5">
            <div>Type: {tooltip.node.type}</div>
            <div>Latency: {tooltip.node.latency_ms || 0}ms</div>
          </div>
        </div>
      )}

      {/* Performance legend */}
      <div className="absolute bottom-4 right-4 bg-secondary/80 backdrop-blur border border-border rounded-lg p-3 text-xs">
        <div className="font-medium text-foreground mb-2">Performance</div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-blue-500" />
            <span className="text-muted-foreground">Fast (&lt;200ms)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-emerald-500" />
            <span className="text-muted-foreground">Good (200-400ms)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-amber-500" />
            <span className="text-muted-foreground">Slow (&gt;400ms)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-purple-500" />
            <span className="text-muted-foreground">Transform</span>
          </div>
        </div>
      </div>
    </div>
  )
}
