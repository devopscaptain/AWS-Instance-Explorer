# AWS Instance Explorer 🚀

A beautiful, animated web app showing all AWS EC2 & RDS instance types with workload suitability reasoning.

**Zero dependencies. Zero AWS keys. Zero backend. Just open `index.html`.**

## Quick Start

```bash
open index.html
```

Or push to GitHub → **Settings → Pages → main branch** → live site.

## Features

- 🎨 Premium dark UI with glassmorphism & animations
- ⚡ 181 EC2 instance types across 16 families
- 🗄️ 54 RDS instance classes across 4 families  
- 🛢️ 7 database engines with reasoning
- 🧠 "Best For" / "Not Ideal For" guidance per family
- 🔍 Search & filter by category
- 📱 Fully responsive

## Why No AI? Why No AWS Keys?

Instance type suitability is **public, well-documented AWS knowledge** — not a secret behind an API wall. Every spec, every use case is published in AWS documentation. We baked it all into a static `data.json`. No server, no credentials, no API calls needed.

## Project Structure

```
├── index.html              # Main page
├── static/
│   ├── css/style.css       # Design system
│   ├── js/app.js           # Frontend logic
│   └── data.json           # All instance data (static)
└── README.md
```
