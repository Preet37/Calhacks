import React from 'react'
import { motion } from 'framer-motion'

// HealthPanel: Minimal system health display
export default function HealthPanel({ health }) {
  if (!health) return null

  const metrics = [
    {
      label: 'Runtime',
      value: `${health.run_time_sec}s`,
      description: 'Total execution time'
    },
    {
      label: 'Avg Latency',
      value: `${health.avg_latency_ms}ms`,
      description: 'Mean response time'
    },
    {
      label: 'Fail Rate',
      value: `${(health.fail_rate_24h * 100).toFixed(1)}%`,
      description: 'Last 24 hours',
      status: health.fail_rate_24h < 0.05 ? 'good' : 'warning'
    },
    {
      label: 'Reroutes',
      value: health.auto_reroutes,
      description: 'Auto adjustments'
    }
  ]

  return (
    <div className="bg-secondary/50 border border-border rounded-lg p-5 h-full flex flex-col card-hover">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-foreground text-xs font-medium tracking-wide">System Health</h2>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 bg-foreground rounded-full" />
          <span className="text-muted-foreground text-[10px]">Operational</span>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        {metrics.map((metric, index) => (
          <motion.div
            key={metric.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05, ease: 'easeOut' }}
            className="bg-background/50 rounded-lg p-3 border border-border"
          >
            <div className="text-muted-foreground text-[10px] mb-1.5">
              {metric.label}
            </div>
            <div className="text-foreground text-xl font-medium mb-1">
              {metric.value}
            </div>
            <div className="text-muted-foreground text-[9px]">
              {metric.description}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Recommendations */}
      {health.recommendations && health.recommendations.length > 0 && (
        <div className="flex-1 pt-4 border-t border-border">
          <h3 className="text-foreground text-[10px] font-medium mb-3 tracking-wide">Insights</h3>
          <div className="space-y-2">
            {health.recommendations.map((rec, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + index * 0.08, ease: 'easeOut' }}
                className="text-muted-foreground text-xs leading-relaxed pl-3 border-l-2 border-border"
              >
                {rec}
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
