import React, { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// LogPanel: Minimal streaming log display
export default function LogPanel({ logs }) {
  const [displayedLogs, setDisplayedLogs] = useState([])
  const logEndRef = useRef(null)

  // Simulate streaming logs one by one
  useEffect(() => {
    if (!logs || logs.length === 0) {
      setDisplayedLogs([])
      return
    }

    // Show all logs immediately if there are many new ones
    if (logs.length > displayedLogs.length + 10) {
      setDisplayedLogs(logs)
      return
    }

    // Stream new logs one by one
    const newLogs = logs.slice(displayedLogs.length)
    if (newLogs.length === 0) return

    let index = 0
    const interval = setInterval(() => {
      if (index < newLogs.length) {
        setDisplayedLogs(prev => {
          const nextLog = newLogs[index]
          return nextLog ? [...prev, nextLog] : prev
        })
        index++
      } else {
        clearInterval(interval)
      }
    }, 150) // Add new log entry every 150ms

    return () => clearInterval(interval)
  }, [logs])

  // Auto-scroll to bottom when new logs appear
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [displayedLogs])

  return (
    <div className="bg-secondary/50 border border-border rounded-lg p-5 h-full flex flex-col card-hover">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-foreground text-xs font-medium tracking-wide">Log Stream</h2>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 bg-foreground rounded-full animate-pulse" />
          <span className="text-muted-foreground text-[10px]">
            {displayedLogs.length}/{logs?.length || 0}
          </span>
        </div>
      </div>

      {/* Log container with scrolling */}
      <div className="flex-1 overflow-y-auto font-mono text-xs space-y-1">
        <AnimatePresence>
          {displayedLogs.filter(log => log !== undefined && log !== null).map((log, index) => {
            // Handle both string logs and object logs
            const logText = typeof log === 'string' ? log : (log.message || 'Unknown event')
            const logLevel = typeof log === 'object' ? log.level : 'info'
            const timestamp = typeof log === 'object' ? log.timestamp : ''

            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="text-muted-foreground flex gap-2 py-0.5"
              >
                <span className={`select-none shrink-0 ${
                  logLevel === 'error' ? 'text-red-400' : 'text-foreground/40'
                }`}>›</span>
                {timestamp && (
                  <span className="text-foreground/30 text-[10px] shrink-0">{timestamp}</span>
                )}
                <span className={`leading-relaxed ${
                  logLevel === 'error' ? 'text-red-400' : ''
                }`}>{logText}</span>
              </motion.div>
            )
          })}
        </AnimatePresence>
        <div ref={logEndRef} />
      </div>
    </div>
  )
}
