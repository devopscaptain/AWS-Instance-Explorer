# InstanceIQ — EC2 & RDS Advisor

> **by [devopscaptain](https://github.com/devopscaptain)**

A fully static web app that lets you explore every AWS EC2 and RDS instance type, understand which workloads each is suited for, compare instances side-by-side, and see live on-demand pricing — all without a backend or AWS credentials.

Live site → GitHub Pages · Data refreshed weekly via GitHub Actions from AWS APIs.

-----

## Features

| Feature | Details |
|---|---|
| EC2 families | All families with Best For / Not Ideal For guidance and per-family reasoning |
| RDS families | All DB instance classes with supported engine matrix and pricing |
| Database engines | Deep-dive cards for MySQL, PostgreSQL, Aurora, Oracle, SQL Server, MariaDB, and more |
| **Side-by-side comparison** | Select up to 4 EC2 or RDS instances, compare specs and costs with best/worst highlighting |
| Live pricing | On-demand Linux, Windows (EC2) and MySQL Single-AZ (RDS) — US East-1 baseline |
| Auto-refresh | GitHub Actions workflow runs every Monday, commits updated `data.json` |
| Search | Full-text search across instance types, families, categories, and use cases |
| Category filters | General Purpose, Compute Optimized, Memory Optimized, Storage Optimized, Accelerated Computing, HPC |
| Dark + Light theme | Cyberpunk neon dark default, clean light mode, persisted via `localStorage` |
| Responsive | Works on mobile through ultrawide; 2-column grid collapses to 1-column below 1100px |
| Accessible | ARIA roles/labels on tabs, chips, toggles; `prefers-reduced-motion` respected |
| Zero dependencies | Vanilla HTML, CSS, JS — no frameworks, no build step, no runtime server |

---

## How the Comparison Feature Works

1. Expand any instance family card and click the **`+`** button on any row.
2. A sticky tray slides up from the bottom showing your selections (up to 4).
3. Hit **Compare →** to open a full-screen modal with a side-by-side spec table.
4. **Green ↑** = best value for that row. **Red** = worst value.
5. EC2 and RDS instances can be mixed — they render as two separate tables.
6. Press `Escape` or click outside the modal to dismiss.

---

## Quick Start (Local)

The app loads `data.json` via `fetch()` — it must be served over HTTP, not opened as a `file://` URL.

```bash
# Option 1 — Python (no install needed)
python3 -m http.server 8080
# open http://localhost:8080

# Option 2 — Node
npx serve .
```

For production, push to GitHub and enable Pages under Settings → Pages → Deploy from `main`.

---

## Project Structure

```
├── index.html                      # Main page — nav, hero, tabs, compare tray, compare modal
├── static/
│   ├── css/style.css               # Design system — dark/light tokens, all component styles
│   ├── js/app.js                   # All frontend logic — render, search, filter, compare
│   └── data.json                   # Instance data (auto-updated by CI every Monday)
├── .github/
│   ├── workflows/
│   │   └── update-data.yml         # GitHub Actions — runs weekly, commits updated data.json
│   └── scripts/
│       └── update_data.py          # Fetches EC2/RDS types and pricing from AWS APIs via boto3
└── README.md
```

---

## Why No AI? Why No AWS Keys to View?

Instance type suitability is **public, well-documented AWS knowledge** — published in AWS docs, whitepapers, and re:Invent talks. The reasoning in `data.json` is baked in as static text, not generated at runtime.

AWS credentials are only needed by the GitHub Actions workflow that writes the weekly data refresh. Visitors never need credentials.

---

## Auto-Update Setup (GitHub Actions)

The workflow fetches EC2 instance types, RDS instance classes, and on-demand pricing via `boto3`, then commits the refreshed `data.json` back to the repo. It runs every Monday at midnight UTC and can be triggered manually from the Actions tab.

### Option A: OIDC Role (Recommended — no long-lived keys)

1. **Create an IAM role** with these managed policies:
   - `AmazonEC2ReadOnlyAccess`
   - `AmazonRDSReadOnlyAccess`
   - `AWSPriceListServiceFullAccess`

2. **Add GitHub as an OIDC provider** in your AWS account and set the role trust policy to allow your repo (`repo:<owner>/<repo>:ref:refs/heads/main`). See the [AWS OIDC guide](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html).

3. **Add the role ARN to GitHub Secrets** → `AWS_ROLE_ARN`

4. **Uncomment** the `role-to-assume` line in `update-data.yml` and remove the access key lines.

### Option B: Access Keys (Simpler)

1. Create an IAM user with the same three policies above.
2. Generate access keys (IAM → Users → Security credentials → Create access key).
3. Add both to GitHub Secrets: `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

### Manual Trigger

Actions tab → "Refresh AWS Instance Data" → Run workflow.
