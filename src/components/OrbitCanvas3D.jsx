import React, { useRef, useState, useMemo, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Text, Trail } from '@react-three/drei'
import * as THREE from 'three'

// Status color mapping (constellation theme)
const STATUS_COLORS = {
  success: '#3b82f6',    // Blue
  waiting: '#eab308',    // Yellow
  failed: '#ef4444',     // Red
  transform: '#a855f7',  // Purple
  default: '#ffffff'     // White
}

// Performance-based color palette (latency → color)
const getPerformanceColor = (latency_ms, type) => {
  // Cool colors for good performance (low latency)
  const coolColors = [
    '#3b82f6', // Blue
    '#06b6d4', // Cyan
    '#8b5cf6', // Violet
    '#6366f1', // Indigo
    '#0ea5e9', // Sky
    '#14b8a6', // Teal
  ]

  // Warm colors for bad performance (high latency)
  const warmColors = [
    '#f59e0b', // Amber
    '#f97316', // Orange
    '#ef4444', // Red
    '#dc2626', // Dark red
    '#fb923c', // Light orange
    '#ea580c', // Orange-red
  ]

  // Transform nodes get purple spectrum
  if (type === 'transform') {
    return [
      '#a855f7', // Purple
      '#c084fc', // Light purple
      '#9333ea', // Dark purple
      '#d946ef', // Fuchsia
      '#e879f9', // Light fuchsia
    ][Math.floor(Math.random() * 5)]
  }

  // Latency threshold for color selection
  if (latency_ms < 200) {
    // Excellent - cool colors
    return coolColors[Math.floor(Math.random() * coolColors.length)]
  } else if (latency_ms < 300) {
    // Good - mix of cool
    return coolColors[Math.floor(Math.random() * 3)]
  } else if (latency_ms < 400) {
    // Medium - transitional
    return ['#10b981', '#14b8a6', '#06b6d4'][Math.floor(Math.random() * 3)] // Greens/teals
  } else {
    // Slow - warm colors
    return warmColors[Math.floor(Math.random() * warmColors.length)]
  }
}

// PulsingParticle: Data packet moving along edge
function PulsingParticle({ start, end, duration = 2000, status }) {
  const particleRef = useRef()
  const [progress, setProgress] = useState(0)

  useFrame((state, delta) => {
    if (particleRef.current) {
      const newProgress = (progress + delta * (1000 / duration)) % 1
      setProgress(newProgress)

      // Lerp between start and end
      particleRef.current.position.x = THREE.MathUtils.lerp(start[0], end[0], newProgress)
      particleRef.current.position.y = THREE.MathUtils.lerp(start[1], end[1], newProgress)
      particleRef.current.position.z = THREE.MathUtils.lerp(start[2], end[2], newProgress)

      // Pulse opacity
      const opacity = Math.sin(newProgress * Math.PI) * 0.8 + 0.2
      particleRef.current.material.opacity = opacity
    }
  })

  const color = status === 'completed' ? STATUS_COLORS.success : STATUS_COLORS.waiting

  return (
    <mesh ref={particleRef}>
      <sphereGeometry args={[0.08, 8, 8]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.8}
      />
    </mesh>
  )
}

// ShootingStar: Log entry as shooting star
function ShootingStar({ index, message, onComplete }) {
  const starRef = useRef()
  const [life, setLife] = useState(0)
  const trajectory = useMemo(() => ({
    start: [Math.random() * 10 - 5, 8, Math.random() * 10 - 5],
    end: [Math.random() * 10 - 5, -2, Math.random() * 10 - 5],
    speed: 0.3 + Math.random() * 0.2
  }), [])

  useFrame((state, delta) => {
    if (starRef.current && life < 1) {
      const newLife = Math.min(life + delta * trajectory.speed, 1)
      setLife(newLife)

      // Position
      starRef.current.position.x = THREE.MathUtils.lerp(trajectory.start[0], trajectory.end[0], newLife)
      starRef.current.position.y = THREE.MathUtils.lerp(trajectory.start[1], trajectory.end[1], newLife)
      starRef.current.position.z = THREE.MathUtils.lerp(trajectory.start[2], trajectory.end[2], newLife)

      // Fade out
      starRef.current.material.opacity = 1 - newLife

      if (newLife >= 1 && onComplete) {
        onComplete(index)
      }
    }
  })

  return (
    <Trail
      width={0.5}
      length={6}
      color={STATUS_COLORS.success}
      attenuation={(t) => t * t}
    >
      <mesh ref={starRef}>
        <sphereGeometry args={[0.05, 8, 8]} />
        <meshBasicMaterial
          color={STATUS_COLORS.success}
          transparent
          opacity={1}
        />
      </mesh>
    </Trail>
  )
}

// OrbitNode: Enhanced with status colors and glow
function OrbitNode({ node, orbitRadius, speed, onHover, onClick, frozen, status = 'default' }) {
  const meshRef = useRef()
  const glowRef = useRef()
  const angle = useRef(Math.random() * Math.PI * 2)

  // Get performance-based color
  const nodeColor = useMemo(
    () => getPerformanceColor(node.latency_ms || 150, node.type),
    [node.latency_ms, node.type]
  )

  useFrame((state, delta) => {
    if (!frozen && meshRef.current) {
      // Much slower rotation speed - inversely proportional to latency
      // Lower latency = faster orbit (but still slow)
      const latencyFactor = node.latency_ms ? (500 / node.latency_ms) : 1
      const baseSpeed = speed * latencyFactor * 0.08  // Reduced from 0.3 to 0.08
      angle.current += delta * baseSpeed

      meshRef.current.position.x = Math.cos(angle.current) * orbitRadius
      meshRef.current.position.z = Math.sin(angle.current) * orbitRadius
    }

    // Pulsing glow effect
    if (glowRef.current) {
      const pulse = Math.sin(state.clock.elapsedTime * 2) * 0.1 + 0.9
      glowRef.current.scale.setScalar(pulse)
    }
  })

  const handlePointerOver = (e) => {
    e.stopPropagation()
    document.body.style.cursor = 'pointer'
    onHover({
      show: true,
      name: node.name,
      type: node.type,
      latency: node.latency_ms || 0,
      status: status,
      x: e.clientX,
      y: e.clientY
    })
  }

  const handlePointerOut = () => {
    document.body.style.cursor = 'default'
    onHover({ show: false })
  }

  return (
    <group ref={meshRef}>
      {/* Outer glow halo - reduced size */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.5, 16, 16]} />
        <meshBasicMaterial
          color={nodeColor}
          transparent
          opacity={0.1}
        />
      </mesh>

      {/* Middle glow - reduced */}
      <mesh>
        <sphereGeometry args={[0.4, 16, 16]} />
        <meshStandardMaterial
          color={nodeColor}
          transparent
          opacity={0.15}
          emissive={nodeColor}
          emissiveIntensity={0.3}
        />
      </mesh>

      {/* Main node sphere */}
      <mesh
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onClick={(e) => {
          e.stopPropagation()
          onClick(node.id)
        }}
      >
        <sphereGeometry args={[0.3, 32, 32]} />
        <meshStandardMaterial
          color={nodeColor}
          metalness={0.6}
          roughness={0.3}
          emissive={nodeColor}
          emissiveIntensity={0.8}
        />
      </mesh>

      {/* Node label - moved higher and larger */}
      <Text
        position={[0, 0.8, 0]}
        fontSize={0.2}
        color={STATUS_COLORS.default}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.03}
        outlineColor="#0a0a0a"
      >
        {node.name}
      </Text>

      {/* Node type label below */}
      <Text
        position={[0, -0.6, 0]}
        fontSize={0.12}
        color={nodeColor}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.02}
        outlineColor="#0a0a0a"
      >
        {node.type === 'http' ? 'API' : 'Transform'}
      </Text>
    </group>
  )
}

// OrbitRing: Subtle orbit path
function OrbitRing({ radius }) {
  const points = useMemo(() => {
    const pts = []
    for (let i = 0; i <= 64; i++) {
      const angle = (i / 64) * Math.PI * 2
      pts.push(new THREE.Vector3(
        Math.cos(angle) * radius,
        0,
        Math.sin(angle) * radius
      ))
    }
    return pts
  }, [radius])

  return (
    <line>
      <bufferGeometry attach="geometry" setFromPoints={points} />
      <lineBasicMaterial
        color="hsl(240, 3.7%, 15.9%)"
        transparent
        opacity={0.2}
      />
    </line>
  )
}

// ConnectionLine: Animated pulsing line
function ConnectionLine({ fromPos, toPos, status, animated = true }) {
  const lineRef = useRef()

  useFrame((state) => {
    if (lineRef.current && animated) {
      // Pulse effect
      const pulse = Math.sin(state.clock.elapsedTime * 3) * 0.2 + 0.5
      lineRef.current.material.opacity = pulse
    }
  })

  const color = status === 'completed'
    ? STATUS_COLORS.success
    : STATUS_COLORS.failed

  return (
    <>
      <line ref={lineRef}>
        <bufferGeometry attach="geometry" setFromPoints={[
          new THREE.Vector3(...fromPos),
          new THREE.Vector3(...toPos)
        ]} />
        <lineBasicMaterial
          color={color}
          transparent
          opacity={0.4}
          linewidth={2}
        />
      </line>
      {/* Animated particle if completed */}
      {status === 'completed' && animated && (
        <PulsingParticle start={fromPos} end={toPos} status={status} duration={2000} />
      )}
    </>
  )
}

// CenterCore: Enhanced AI Planner with radiant pulse
function CenterCore() {
  const meshRef = useRef()
  const outerGlowRef = useRef()

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += 0.002
    }
    if (outerGlowRef.current) {
      // Breathing effect
      const pulse = Math.sin(state.clock.elapsedTime * 0.8) * 0.2 + 1.2
      outerGlowRef.current.scale.setScalar(pulse)
    }
  })

  return (
    <group>
      {/* Outer radiant glow */}
      <mesh ref={outerGlowRef}>
        <sphereGeometry args={[1.5, 32, 32]} />
        <meshBasicMaterial
          color={STATUS_COLORS.success}
          transparent
          opacity={0.08}
        />
      </mesh>

      {/* Core glow */}
      <mesh>
        <sphereGeometry args={[1.2, 32, 32]} />
        <meshStandardMaterial
          color="hsl(0, 0%, 98%)"
          transparent
          opacity={0.1}
          emissive="hsl(210, 100%, 60%)"
          emissiveIntensity={0.3}
        />
      </mesh>

      {/* Main core */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.8, 32, 32]} />
        <meshStandardMaterial
          color="hsl(240, 10%, 3.9%)"
          metalness={0.9}
          roughness={0.1}
          emissive="hsl(210, 100%, 60%)"
          emissiveIntensity={0.6}
        />
      </mesh>

      {/* Inner bright core */}
      <mesh>
        <sphereGeometry args={[0.5, 16, 16]} />
        <meshStandardMaterial
          color={STATUS_COLORS.success}
          emissive={STATUS_COLORS.success}
          emissiveIntensity={2}
        />
      </mesh>

      {/* Label */}
      <Text
        position={[0, 1.4, 0]}
        fontSize={0.22}
        color={STATUS_COLORS.default}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.02}
        outlineColor="hsl(240, 10%, 3.9%)"
      >
        AI Planner
      </Text>
    </group>
  )
}

// Scene: Main 3D constellation
function Scene({ pipelineSpec, onNodeHover, onNodeClick, frozenNodes, logs }) {
  const nodePositions = useRef({})
  const [shootingStars, setShootingStars] = useState([])

  // Add shooting stars for new logs
  useEffect(() => {
    if (logs && logs.length > 0) {
      const latest = logs[logs.length - 1]
      setShootingStars(prev => [...prev, { id: Date.now(), message: latest }])
    }
  }, [logs])

  const removeShootingStar = (id) => {
    setShootingStars(prev => prev.filter(star => star.id !== id))
  }

  const orbitRadii = {
    http: 3,
    transform: 5
  }

  // Update node positions
  const updateNodePositions = () => {
    if (!pipelineSpec) return

    pipelineSpec.nodes.forEach(node => {
      const orbitRadius = orbitRadii[node.type] || 3
      const angle = nodePositions.current[node.id]?.angle || Math.random() * Math.PI * 2

      if (!nodePositions.current[node.id]) {
        nodePositions.current[node.id] = { angle }
      }

      nodePositions.current[node.id].position = [
        Math.cos(angle) * orbitRadius,
        0,
        Math.sin(angle) * orbitRadius
      ]
    })
  }

  updateNodePositions()

  return (
    <>
      {/* Cosmic lighting */}
      <ambientLight intensity={0.2} />
      <pointLight position={[0, 0, 0]} intensity={1.5} color={STATUS_COLORS.success} />
      <pointLight position={[10, 10, 10]} intensity={0.3} color={STATUS_COLORS.default} />
      <pointLight position={[-10, -10, -10]} intensity={0.2} color={STATUS_COLORS.transform} />

      {/* Center core */}
      <CenterCore />

      {/* Orbit rings */}
      {Object.values(orbitRadii).map((radius, i) => (
        <OrbitRing key={i} radius={radius} />
      ))}

      {/* Nodes */}
      {pipelineSpec?.nodes.map(node => (
        <OrbitNode
          key={node.id}
          node={node}
          orbitRadius={orbitRadii[node.type] || 3}
          speed={node.type === 'http' ? 0.8 : 0.5}  // Reduced from 1.2/0.8 to 0.8/0.5
          onHover={onNodeHover}
          onClick={onNodeClick}
          frozen={frozenNodes.includes(node.id)}
          status="success"
        />
      ))}

      {/* Connection lines with particles */}
      {pipelineSpec?.edges.map((edge, i) => {
        const fromPos = nodePositions.current[edge.from]?.position || [0, 0, 0]
        const toPos = nodePositions.current[edge.to]?.position || [0, 0, 0]

        return (
          <ConnectionLine
            key={i}
            fromPos={fromPos}
            toPos={toPos}
            status={edge.status}
            animated={true}
          />
        )
      })}

      {/* Shooting stars (logs) */}
      {shootingStars.map((star, i) => (
        <ShootingStar
          key={star.id}
          index={star.id}
          message={star.message}
          onComplete={removeShootingStar}
        />
      ))}

      {/* Camera controls */}
      <OrbitControls
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        minDistance={5}
        maxDistance={20}
        maxPolarAngle={Math.PI / 2}
      />
    </>
  )
}

// Main component
export default function OrbitCanvas3D({ pipelineSpec, logs }) {
  const [tooltip, setTooltip] = useState({ show: false })
  const [frozenNodes, setFrozenNodes] = useState([])

  const handleNodeClick = (nodeId) => {
    setFrozenNodes(prev =>
      prev.includes(nodeId)
        ? prev.filter(id => id !== nodeId)
        : [...prev, nodeId]
    )
  }

  return (
    <div className="relative w-full h-full">
      <Canvas
        camera={{ position: [10, 10, 10], fov: 50 }}
        gl={{ alpha: true, antialias: true }}
      >
        {/* Cosmic background gradient */}
        <color attach="background" args={['#0a0a0a']} />
        <fog attach="fog" args={['#0a0a0a', 10, 30]} />

        <Scene
          pipelineSpec={pipelineSpec}
          onNodeHover={setTooltip}
          onNodeClick={handleNodeClick}
          frozenNodes={frozenNodes}
          logs={logs}
        />
      </Canvas>

      {/* Enhanced tooltip */}
      {tooltip.show && (
        <div
          className="fixed bg-background/95 backdrop-blur-sm border border-border text-xs p-3 rounded-lg pointer-events-none z-50 shadow-2xl"
          style={{ left: tooltip.x + 10, top: tooltip.y - 10 }}
        >
          <div className="font-semibold text-foreground mb-1">{tooltip.name}</div>
          <div className="text-muted-foreground text-[10px] space-y-0.5">
            <div>Type: {tooltip.type}</div>
            <div>Latency: {tooltip.latency}ms</div>
            {tooltip.status && (
              <div className="flex items-center gap-1.5 mt-1">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: STATUS_COLORS[tooltip.status] }}
                />
                <span className="capitalize">{tooltip.status}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
