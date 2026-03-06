# AWS Instance Explorer

A fully static web app showing all AWS EC2 & RDS instance types with workload suitability reasoning. No backend, no AWS credentials needed to view it.

## Quick Start

Because the app loads data via `fetch()`, it must be served over HTTP — opening `index.html` directly as a `file://` URL will not work.

**Option 1 — Python (built-in, no install needed):**
```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

**Option 2 — GitHub Pages:**
Push to GitHub → Settings → Pages → Deploy from `main` branch → live site.

## Features

- Premium dark UI with glassmorphism and animations
- EC2 and RDS instance families with "Best For / Not Ideal For" guidance per family
- Instance counts and pricing auto-refreshed weekly from AWS APIs via GitHub Actions
- Search across instance types, categories, and use cases
- Filter by category (General Purpose, Compute Optimized, Memory Optimized, etc.)
- Fully responsive
- Respects `prefers-reduced-motion` — no animations on low-motion devices

## Why No AI? Why No AWS Keys to View?

Instance type suitability is **public, well-documented AWS knowledge** — not a secret behind an API wall. Every spec and use case is published in AWS documentation. It is baked into a static `data.json`. No server, no credentials, no API calls needed to view the site.

AWS credentials are only needed by the GitHub Actions workflow that refreshes `data.json` once a week.

## Project Structure

```
├── index.html                      # Main page
├── static/
│   ├── css/style.css               # Design system and all styles
│   ├── js/app.js                   # Frontend logic
│   └── data.json                   # Instance data (auto-updated by CI)
├── .github/
│   ├── workflows/
│   │   └── update-data.yml         # Runs every Monday to refresh data
│   └── scripts/
│       └── update_data.py          # Fetches EC2/RDS data from AWS APIs
└── README.md
```

## Auto-Update Setup (GitHub Actions)

The workflow in `.github/workflows/update-data.yml` runs every Monday at midnight UTC. It fetches the latest EC2 instance types, RDS instance classes, and on-demand pricing from AWS, then commits the updated `data.json` back to the repo. It can also be triggered manually from the Actions tab.

### Option A: OIDC Role (Recommended — no long-lived credentials)

1. **Create an IAM role** in AWS with these permissions:
   - `AmazonEC2ReadOnlyAccess`
   - `AmazonRDSReadOnlyAccess`
   - `AWSPriceListServiceFullAccess`

2. **Add GitHub as an OIDC provider** in your AWS account and configure the role's trust policy to allow your repo. See the [AWS OIDC guide](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html) for details.

3. **Add the role ARN to GitHub Secrets**:
   - Go to your repo → Settings → Secrets and variables → Actions
   - Add secret: `AWS_ROLE_ARN`

4. **Update the workflow** — uncomment the `role-to-assume` line and remove the access key lines in `update-data.yml`.

### Option B: Access Keys (Simpler setup)

1. **Create an IAM user** with these policies attached:
   - `AmazonEC2ReadOnlyAccess`
   - `AmazonRDSReadOnlyAccess`
   - `AWSPriceListServiceFullAccess`

2. **Generate access keys** for the user (IAM → Users → Security credentials → Create access key).

3. **Add both keys to GitHub Secrets**:
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`

### Manual Trigger

Go to Actions → "Refresh AWS Instance Data" → Run workflow.
