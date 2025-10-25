// Assumes API_KEY is defined in scope (preferably from environment on the server)
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export async function chatWithGroq(message) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.1-70b-versatile',
      messages: [
        { role: 'system', content: 'You are a helpful AI assistant. You can have conversations and also generate API workflows when asked.' },
        { role: 'user', content: message }
      ],
      temperature: 0.7
    })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

export async function generateWorkflow(message) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.1-70b-versatile',
      messages: [
        { role: 'system', content: 'Generate API workflow JSON with summary and pipeline_spec' },
        { role: 'user', content: message }
      ],
      temperature: 0.1
    })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}
