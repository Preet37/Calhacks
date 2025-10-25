# MetaForge Backend (Mini)

Agent that **plans and executes** multi-API workflows for free:
- Places: OpenStreetMap **Overpass**
- ETA: **OSRM** Table
- Weather: **Open-Meteo**
- Live viz: **SSE** events for AutoGraph

## Quick Start

```bash
npm i
cp .env.example .env
# For real free APIs, set in .env:
#   USE_MOCKS=false
npm run dev
