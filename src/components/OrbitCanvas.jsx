import React, { useRef, useState, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Text } from '@react-three/drei'
import * as THREE from 'three'

// OrbitNode: Individual 3D node that orbits around center
function OrbitNode({ node, orbitRadius, speed, onHover, onClick, frozen }) {
  const meshRef = useRef()
  const angle = useRef(Math.random() * Math.PI * 2)

  useFrame((state, delta) => {
    if (!frozen && meshRef.current) {
      // Rotation speed based on latency (faster = lower latency)
      const baseSpeed = speed * (node.latency_ms ? 1 / (node.latency_ms / 100) : 1)
      angle.current += delta * baseSpeed * 0.3

      meshRef.current.position.x = Math.cos(angle.current) * orbitRadius
      meshRef.current.position.z = Math.sin(angle.current) * orbitRadius
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
      {/* Outer hover ring */}
      <mesh>
        <sphereGeometry args={[0.5, 16, 16]} />
        <meshStandardMaterial
          color={node.color}
          transparent
          opacity={0.1}
          emissive={node.color}
          emissiveIntensity={0.2}
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
          color={node.color}
          metalness={0.3}
          roughness={0.4}
          emissive={node.color}
          emissiveIntensity={0.5}
        />
      </mesh>

      {/* Node label */}
      <Text
        position={[0, 0.6, 0]}
        fontSize={0.15}
        color="hsl(0, 0%, 98%)"
        anchorX="center"
        anchorY="middle"
      >
        {node.type === 'http' ? 'API' : 'T'}
      </Text>
    </group>
  )
}

// OrbitRing: Visual orbit path
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

  const lineGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    return geometry
  }, [points])

  return (
    <line geometry={lineGeometry}>
      <lineBasicMaterial
        color="hsl(240, 3.7%, 15.9%)"
        transparent
        opacity={0.3}
      />
    </line>
  )
}

// ConnectionLine: Line between connected nodes
function ConnectionLine({ fromPos, toPos, status }) {
  const points = useMemo(() => [
    new THREE.Vector3(fromPos[0], fromPos[1], fromPos[2]),
    new THREE.Vector3(toPos[0], toPos[1], toPos[2])
  ], [fromPos, toPos])

  const color = status === 'completed'
    ? 'hsl(142, 76%, 36%)'  // Green
    : 'hsl(0, 84%, 60%)'     // Red

  return (
    <line>
      <bufferGeometry attach="geometry" setFromPoints={points} />
      <lineBasicMaterial
        color={color}
        transparent
        opacity={0.3}
        linewidth={2}
      />
    </line>
  )
}

// CenterCore: AI Planner at the center
function CenterCore() {
  const meshRef = useRef()

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += 0.001
    }
  })

  return (
    <group ref={meshRef}>
      {/* Outer glow sphere */}
      <mesh>
        <sphereGeometry args={[1.2, 32, 32]} />
        <meshStandardMaterial
          color="hsl(0, 0%, 98%)"
          transparent
          opacity={0.05}
          emissive="hsl(0, 0%, 98%)"
          emissiveIntensity={0.1}
        />
      </mesh>

      {/* Core sphere */}
      <mesh>
        <sphereGeometry args={[0.8, 32, 32]} />
        <meshStandardMaterial
          color="hsl(240, 10%, 3.9%)"
          metalness={0.8}
          roughness={0.2}
          emissive="hsl(0, 0%, 98%)"
          emissiveIntensity={0.3}
        />
      </mesh>

      {/* Inner core */}
      <mesh>
        <sphereGeometry args={[0.6, 16, 16]} />
        <meshStandardMaterial
          color="hsl(0, 0%, 98%)"
          emissive="hsl(0, 0%, 98%)"
          emissiveIntensity={1}
        />
      </mesh>

      {/* Label */}
      <Text
        position={[0, 1.2, 0]}
        fontSize={0.2}
        color="hsl(0, 0%, 98%)"
        anchorX="center"
        anchorY="middle"
      >
        AI Planner
      </Text>
    </group>
  )
}

// Scene: Main 3D scene container
function Scene({ pipelineSpec, onNodeHover, onNodeClick, frozenNodes }) {
  const nodePositions = useRef({})

  // Calculate orbit radii
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
      {/* Lighting */}
      <ambientLight intensity={0.3} />
      <pointLight position={[10, 10, 10]} intensity={0.5} />
      <pointLight position={[-10, -10, -10]} intensity={0.3} />

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
          speed={node.type === 'http' ? 1.2 : 0.8}
          onHover={onNodeHover}
          onClick={onNodeClick}
          frozen={frozenNodes.includes(node.id)}
        />
      ))}

      {/* Connection lines */}
      {pipelineSpec?.edges.map((edge, i) => {
        const fromNode = pipelineSpec.nodes.find(n => n.id === edge.from)
        const toNode = pipelineSpec.nodes.find(n => n.id === edge.to)

        if (!fromNode || !toNode) return null

        const fromPos = nodePositions.current[edge.from]?.position || [0, 0, 0]
        const toPos = nodePositions.current[edge.to]?.position || [0, 0, 0]

        return (
          <ConnectionLine
            key={i}
            fromPos={fromPos}
            toPos={toPos}
            status={edge.status}
          />
        )
      })}

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

// Main OrbitCanvas component
export default function OrbitCanvas({ pipelineSpec }) {
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
        camera={{ position: [8, 8, 8], fov: 50 }}
        gl={{ alpha: true, antialias: true }}
      >
        <color attach="background" args={['hsl(240, 10%, 3.9%)']} />
        <Scene
          pipelineSpec={pipelineSpec}
          onNodeHover={setTooltip}
          onNodeClick={handleNodeClick}
          frozenNodes={frozenNodes}
        />
      </Canvas>

      {/* Tooltip */}
      {tooltip.show && (
        <div
          className="fixed bg-secondary border border-border text-xs p-2.5 rounded-md pointer-events-none z-50 shadow-lg"
          style={{ left: tooltip.x + 10, top: tooltip.y - 10 }}
        >
          <div className="font-medium text-foreground">{tooltip.name}</div>
          <div className="text-muted-foreground text-[10px] mt-0.5">
            {tooltip.type} • {tooltip.latency}ms
          </div>
        </div>
      )}
    </div>
  )
}
