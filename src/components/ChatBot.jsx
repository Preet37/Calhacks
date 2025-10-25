import React, { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ChatBot: ChatGPT-like interface for workflow generation
export default function ChatBot({ onWorkflowGenerated }) {
  const [messages, setMessages] = useState([
    {
      id: 1,
      type: 'assistant',
      content: 'Hi! I can help you create API workflows. Describe what you want to build and I\'ll generate the JSON configuration for you.',
      timestamp: new Date()
    }
  ])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const generateWorkflow = async (userMessage) => {
    // Simulate AI processing - in real implementation, this would call an AI service
    const workflowExamples = {
      'yelp': {
        summary: 'Find restaurants and get reviews',
        pipeline_spec: {
          nodes: [
            {
              id: 'n1_yelp',
              type: 'http',
              name: 'Yelp Search',
              color: '#ffb347',
              latency_ms: 245,
              endpoint: 'https://api.yelp.com/v3/businesses/search',
              method: 'GET'
            },
            {
              id: 'n2_reviews',
              type: 'http', 
              name: 'Get Reviews',
              color: '#ff6b6b',
              latency_ms: 180,
              endpoint: 'https://api.yelp.com/v3/businesses/{id}/reviews',
              method: 'GET'
            }
          ],
          edges: [
            { from: 'n1_yelp', to: 'n2_reviews', status: 'completed' }
          ]
        }
      },
      'weather': {
        summary: 'Get weather data and forecasts',
        pipeline_spec: {
          nodes: [
            {
              id: 'n1_weather',
              type: 'http',
              name: 'Current Weather',
              color: '#4ecdc4',
              latency_ms: 120,
              endpoint: 'https://api.openweathermap.org/data/2.5/weather',
              method: 'GET'
            },
            {
              id: 'n2_forecast',
              type: 'http',
              name: 'Weather Forecast', 
              color: '#45b7d1',
              latency_ms: 150,
              endpoint: 'https://api.openweathermap.org/data/2.5/forecast',
              method: 'GET'
            }
          ],
          edges: [
            { from: 'n1_weather', to: 'n2_forecast', status: 'completed' }
          ]
        }
      }
    }

    // Simple keyword matching for demo
    const lowerMessage = userMessage.toLowerCase()
    let workflow = null

    if (lowerMessage.includes('yelp') || lowerMessage.includes('restaurant') || lowerMessage.includes('food')) {
      workflow = workflowExamples.yelp
    } else if (lowerMessage.includes('weather') || lowerMessage.includes('forecast')) {
      workflow = workflowExamples.weather
    } else {
      // Default workflow
      workflow = {
        summary: 'Custom API workflow',
        pipeline_spec: {
          nodes: [
            {
              id: 'n1_custom',
              type: 'http',
              name: 'Custom API',
              color: '#9b59b6',
              latency_ms: 200,
              endpoint: 'https://api.example.com/endpoint',
              method: 'GET'
            }
          ],
          edges: []
        }
      }
    }

    return workflow
  }

  const handleSend = async () => {
    if (!input.trim() || isTyping) return

    const userMessage = {
      id: Date.now(),
      type: 'user',
      content: input.trim(),
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsTyping(true)

    // Simulate AI thinking time
    setTimeout(async () => {
      try {
        const workflow = await generateWorkflow(userMessage.content)
        
        const assistantMessage = {
          id: Date.now() + 1,
          type: 'assistant',
          content: `I've generated a workflow for you! Here's the JSON configuration:`,
          timestamp: new Date(),
          workflow: workflow
        }

        setMessages(prev => [...prev, assistantMessage])
        
        // Call the callback to update the main app
        if (onWorkflowGenerated) {
          onWorkflowGenerated(workflow)
        }
      } catch (error) {
        const errorMessage = {
          id: Date.now() + 1,
          type: 'assistant',
          content: 'Sorry, I encountered an error generating the workflow. Please try again.',
          timestamp: new Date()
        }
        setMessages(prev => [...prev, errorMessage])
      } finally {
        setIsTyping(false)
      }
    }, 1500)
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="bg-secondary/50 border border-border rounded-lg h-full flex flex-col card-hover">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <h2 className="text-foreground text-xs font-medium tracking-wide">AI Workflow Assistant</h2>
        </div>
        <div className="text-muted-foreground text-[10px]">GPT-4</div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <AnimatePresence>
          {messages.map((message) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`max-w-[80%] ${message.type === 'user' ? 'order-2' : 'order-1'}`}>
                <div className={`rounded-lg p-3 text-xs ${
                  message.type === 'user' 
                    ? 'bg-foreground text-background' 
                    : 'bg-background/50 text-foreground border border-border'
                }`}>
                  <div className="whitespace-pre-wrap">{message.content}</div>
                  
                  {/* Workflow JSON */}
                  {message.workflow && (
                    <div className="mt-3 pt-3 border-t border-border/50">
                      <div className="text-[10px] text-muted-foreground mb-2">Generated Workflow:</div>
                      <pre className="text-[9px] bg-background/30 p-2 rounded border overflow-x-auto">
                        {JSON.stringify(message.workflow, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
                <div className={`text-[9px] text-muted-foreground mt-1 ${
                  message.type === 'user' ? 'text-right' : 'text-left'
                }`}>
                  {message.timestamp.toLocaleTimeString()}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Typing indicator */}
        {isTyping && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-start"
          >
            <div className="bg-background/50 border border-border rounded-lg p-3">
              <div className="flex items-center gap-1">
                <div className="flex gap-1">
                  <div className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-[10px] text-muted-foreground ml-2">Generating workflow...</span>
              </div>
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-border">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Describe your API workflow..."
            className="flex-1 bg-background/50 border border-border rounded-md px-3 py-2 text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
            disabled={isTyping}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isTyping}
            className="bg-foreground text-background px-3 py-2 rounded-md text-xs font-medium hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
