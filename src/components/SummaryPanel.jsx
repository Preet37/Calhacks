import React from 'react'
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

// SummaryPanel: Minimal summary with correlation chart
export default function SummaryPanel({ summary, correlation }) {
  return (
    <div className="bg-secondary/50 border border-border rounded-lg p-5 card-hover">
      {/* Summary Text */}
      <div className="mb-5">
        <h2 className="text-foreground text-xs font-medium mb-3 tracking-wide">Summary</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">{summary}</p>
      </div>

      {/* Correlation Chart */}
      {correlation && correlation.data && (
        <div className="mt-5 pt-5 border-t border-border">
          <h3 className="text-foreground text-xs font-medium mb-3 tracking-wide">Correlation</h3>
          <ResponsiveContainer width="100%" height={140}>
            <ScatterChart margin={{ top: 5, right: 5, bottom: 5, left: -15 }}>
              <CartesianGrid strokeDasharray="2 2" stroke="hsl(240 3.7% 15.9%)" opacity={0.5} />
              <XAxis
                type="number"
                dataKey="rating"
                name="Rating"
                domain={[4, 5]}
                tick={{ fill: 'hsl(240 5% 64.9%)', fontSize: 9, fontFamily: 'Inter' }}
                stroke="hsl(240 3.7% 15.9%)"
                tickLine={false}
              />
              <YAxis
                type="number"
                dataKey="eta"
                name="ETA"
                tick={{ fill: 'hsl(240 5% 64.9%)', fontSize: 9, fontFamily: 'Inter' }}
                stroke="hsl(240 3.7% 15.9%)"
                tickLine={false}
              />
              <Tooltip
                cursor={{ strokeDasharray: '2 2' }}
                contentStyle={{
                  backgroundColor: 'hsl(240 3.7% 15.9%)',
                  border: '1px solid hsl(240 3.7% 15.9%)',
                  borderRadius: '6px',
                  fontSize: '10px',
                  fontFamily: 'Inter',
                  color: 'hsl(0 0% 98%)'
                }}
              />
              <Scatter
                data={correlation.data}
                fill="hsl(0 0% 98%)"
                opacity={0.7}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
