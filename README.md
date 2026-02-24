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
│   └── data.json           # All instance data (auto-updated)
├── .github/
│   ├── workflows/
│   │   └── update-data.yml # GitHub Actions workflow
│   └── scripts/
│       └── update_data.py  # AWS data fetcher
└── README.md
```

## Auto-Update Setup (GitHub Actions)

The project includes a GitHub Actions workflow that automatically fetches the latest AWS instance data and pricing every Monday at midnight UTC (or manually via workflow dispatch).

### Setup Instructions

1. **Create an AWS IAM User** with read-only permissions:
   - Go to AWS Console → IAM → Users → Create User
   - Attach policies: `AmazonEC2ReadOnlyAccess`, `AmazonRDSReadOnlyAccess`, `AWSPriceListServiceFullAccess`
   - Create access keys (Access Key ID + Secret Access Key)

2. **Add AWS Credentials to GitHub Secrets**:
   - Go to your GitHub repo → Settings → Secrets and variables → Actions
   - Add two secrets:
     - `AWS_ACCESS_KEY_ID`: Your AWS access key ID
     - `AWS_SECRET_ACCESS_KEY`: Your AWS secret access key

3. **Enable GitHub Actions**:
   - Go to Actions tab → Enable workflows
   - The workflow will run automatically every Monday or can be triggered manually

4. **Manual Trigger** (optional):
   - Go to Actions → "Refresh AWS Instance Data" → Run workflow

### Alternative: OIDC Setup (More Secure)

For production, use OIDC instead of access keys:
1. Create an IAM role with the same permissions
2. Configure GitHub as an OIDC provider in AWS
3. Update the workflow to use `role-to-assume` instead of access keys
4. See [AWS docs](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html) for details

