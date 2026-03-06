# Building InstanceIQ: A Zero-Backend AWS Instance Explorer with Live Pricing and Side-by-Side Comparison

**Level 300 · by devopscaptain**

*Tags: AWS, EC2, RDS, GitHub Actions, Vanilla JS, Static Sites, DevOps Tooling*

---

## The Problem

Every AWS architect has been there: you open the EC2 instance type page, stare at 700+ rows in a table, and try to remember whether `r6g` or `x2idn` is the right call for your in-memory analytics workload. AWS documentation is thorough, but it is optimised for reference, not for decision-making.

The questions engineers actually ask are:

- "What family should I be in for this workload?"
- "Is `m7g.4xlarge` cheaper than `m6a.4xlarge` for the same vCPU/RAM ratio?"
- "Which RDS class supports Aurora PostgreSQL and is under $0.50/hr?"
- "My current instance is `c5.2xlarge` — what is the spec delta to `c6i.2xlarge`?"

I built **InstanceIQ** to answer all of these without opening five browser tabs, running CLI commands, or writing throwaway scripts.

---

## Goals and Constraints

Before writing a line of code I set three hard constraints:

1. **No backend.** No Lambda, no EC2, no container. Zero runtime infrastructure means zero operational cost and zero on-call pages.
2. **No credentials to view.** Every visitor should see the site cold. AWS credentials only appear in CI.
3. **No AI.** Instance suitability guidance is published AWS knowledge — whitepapers, re:Invent talks, the Well-Architected Framework. Encoding it as structured JSON is more auditable and faster than a language model query.

The result is a fully static site: one HTML file, one CSS file, one JS file, one JSON data file. No build step. Hosted free on GitHub Pages.

---

## The $0 Infrastructure Stack

Before getting into any code, let's talk about cost — because the entire production infrastructure for InstanceIQ costs **exactly $0/month**.

Here is the full bill:

| Service | What it does | Cost |
|---|---|---|
| **GitHub Pages** | Hosts and serves the static site globally via CDN | **Free** |
| **GitHub Actions** | Runs the weekly AWS data refresh (Python + boto3) | **Free** (2,000 min/month on free tier) |
| **GitHub repo** | Stores all source code and `data.json` | **Free** |
| **AWS read-only APIs** | `describe_instance_types`, `describe_orderable_db_instance_options`, `get_products` | **Free** (read APIs, no charges) |

No EC2. No Lambda. No S3 bucket. No CloudFront distribution. No RDS. No load balancer. No container registry. No monitoring agent. Nothing to patch, nothing to rotate, nothing to page you at 3am.

### GitHub Pages: More Than Just Static Hosting

GitHub Pages is not just "put your HTML somewhere." It is a full CDN-backed hosting platform built into every public (and private, on paid plans) GitHub repository:

- **Automatic HTTPS** — TLS certificate provisioned and renewed by GitHub, zero configuration.
- **Global CDN** — Fastly CDN serves assets from edge nodes worldwide. Your Tokyo visitor gets the same sub-100ms load as your Virginia visitor.
- **Custom domains** — Point your own domain at it with a single CNAME record. GitHub handles the cert.
- **Instant deploys** — Every `git push` to `main` triggers a Pages rebuild in under 60 seconds.
- **No egress fees** — GitHub does not charge per-GB served. A tool that gets popular costs the same as one with zero traffic.
- **Zero ops** — No Nginx config, no capacity planning, no auto-scaling policy, no health checks.

To enable it: repository → **Settings → Pages → Source → Deploy from branch → `main` → `/` (root)** → Save. That is the entire setup.

```
git push origin main
         │
         ▼
  GitHub detects push
         │
         ▼
  Pages build triggered (~30s)
         │
         ▼
  Fastly CDN cache invalidated
         │
         ▼
  Live globally within 60 seconds
```

### GitHub Actions: Free CI/CD for Your Data Pipeline

The weekly data refresh is a GitHub Actions workflow — a YAML file checked into the repo that GitHub runs on a schedule. The free tier gives every account **2,000 minutes/month** of Actions runtime. Our weekly Python script takes about 3–4 minutes per run, so 52 runs/year × 4 minutes = ~208 minutes/year. That is **10% of the free monthly allowance, used annually**.

```yaml
on:
  schedule:
    - cron: '0 0 * * 1'   # Every Monday at midnight UTC
  workflow_dispatch:        # Also triggerable manually from the Actions tab
```

The workflow:
1. Checks out the repo
2. Assumes an AWS IAM role via OIDC (no stored credentials — covered in the IAM section)
3. Runs `update_data.py` — calls AWS APIs, writes `static/data.json`
4. Commits the updated file and pushes back to `main`
5. GitHub Pages automatically redeploys the site with the new data

The entire feedback loop — from AWS API call to live updated website — is **fully automated and costs nothing**.

### Why This Beats a "Real" Backend for This Use Case

The instinct for a tool like this is to build an API: Lambda + API Gateway + a caching layer. Let's compare:

| Concern | Serverless API | Static + GitHub Pages |
|---|---|---|
| Latency | 50–200ms cold start + network | CDN edge cache, ~10ms |
| Cost | Lambda invocations + API GW + CloudWatch | $0 |
| Ops | IAM, throttling, error rates, cold starts | Nothing |
| Data freshness | Real-time (but AWS instance types change weekly at most) | Weekly refresh — same effective freshness |
| Offline dev | Needs SAM/LocalStack | `python3 -m http.server 8080` |
| Scaling | Auto-scales (with cost) | CDN scales for free |

For data that changes at most once a week, real-time API calls are pure overhead. A static JSON file pre-fetched from a CDN edge node is strictly faster and strictly cheaper.

---

## Architecture Overview

```
┌──────────────────────────────────────────────┐
│   GitHub Actions (runs every Monday, free)    │
│                                               │
│  boto3 → EC2 describe_instance_types          │
│  boto3 → RDS describe_orderable_db_instance   │
│  boto3 → Pricing get_products (EC2 + RDS)     │
│                 │                             │
│         writes static/data.json               │
│         git commit + push to main             │
└───────────────────┬──────────────────────────┘
                    │ push triggers Pages rebuild
┌───────────────────▼──────────────────────────┐
│   GitHub Pages (CDN-backed, free, auto-HTTPS) │
│                                               │
│  index.html  ─── fetch() ──►  data.json       │
│  style.css                                    │
│  app.js                                       │
│                                               │
│  Served globally via Fastly CDN               │
│  TLS managed by GitHub                        │
│  Zero egress cost                             │
└──────────────────────────────────────────────┘
```

The data pipeline runs inside GitHub Actions using OIDC (no long-lived keys stored anywhere). The frontend is pure vanilla JS — no React, no bundler, no `node_modules`. Everything ships as-is.

---

## The Data Pipeline

### Fetching EC2 Instance Types

```python
paginator = ec2.get_paginator('describe_instance_types')
for page in paginator.paginate():
    for inst in page['InstanceTypes']:
        inst_type = inst['InstanceType']
        family    = inst_type.split('.')[0]          # t3, m6g, r7iz, ...
        letter    = ''.join(c for c in family if c.isalpha())  # t, m, r, ...
```

`describe_instance_types` returns every instance in the region — vCPUs, memory, network performance, current generation flag. We key by the letter prefix so `t3`, `t3a`, `t4g` all live under the `t` family.

### Pricing

The AWS Pricing API lives only in `us-east-1`. We filter to On-Demand, Shared tenancy, no pre-installed software, and pull Linux and Windows prices in the same pass:

```python
pages = pricing.get_paginator('get_products').paginate(
    ServiceCode='AmazonEC2',
    Filters=[
        {'Type': 'TERM_MATCH', 'Field': 'location',        'Value': 'US East (N. Virginia)'},
        {'Type': 'TERM_MATCH', 'Field': 'preInstalledSw',  'Value': 'NA'},
        {'Type': 'TERM_MATCH', 'Field': 'tenancy',         'Value': 'Shared'},
        {'Type': 'TERM_MATCH', 'Field': 'capacitystatus',  'Value': 'Used'},
    ]
)
```

Each price document is a nested JSON blob. The USD value lives at `terms.OnDemand[key].priceDimensions[key].pricePerUnit.USD`. We store it as a float keyed by instance type and OS.

### Merging with Static Reasoning

The `data.json` file has two layers:

1. **Static layer** (`ec2Families`, `rdsFamilies`, `rdsEngines`): curated reasoning, icons, category labels, "best for" tags — this never changes automatically.
2. **Dynamic layer** (`ec2Instances`, `rdsInstances`): raw spec and pricing data written by the CI script each week.

The Python script only overwrites the dynamic layer. The reasoning is never overwritten — it is editorial content that a human controls.

```python
for family in data.get('ec2Families', {}).keys():
    if family in ec2_instances_by_family:
        data['ec2Instances'][family] = ec2_instances_by_family[family]
```

---

## The Frontend

### State Management Without a Framework

All mutable state lives in one plain object:

```js
const state = {
    activeTab:    'ec2',
    activeFilter: 'all',
    searchQuery:  '',
    ec2Data:      null,
    rdsData:      null,
    engineData:   null,
    compareItems: new Map(),    // ikey → { itype, label, data }
    instanceLookup: new Map(),  // "ec2:t3.micro" → instance object
};
```

No reactive proxy, no store subscription. When something changes, we call the relevant render function directly. For a tool of this scope that is the right level of complexity.

### Search Performance: Cache at Render Time

A naive search would do `card.textContent.toLowerCase()` on every keystroke. For 700+ rendered cards that causes visible jank.

The fix is to compute a `data-search-text` attribute once per card at render time and never touch the DOM during search:

```js
const searchText = [
    familyName, category, headline, reasoning,
    ...bestFor, ...notFor,
    ...instances.map(i => i.instanceType || i.dbInstanceClass || ''),
].join(' ').toLowerCase();

// stored as: data-search-text="t3 general purpose burstable..."
```

Search then becomes a pure string `includes()` check — microseconds per card.

### Height Animation Without `max-height` Hacks

Animating `height: 0` → `height: auto` is a classic CSS problem. The common answer is `max-height: 9999px` but that causes a visible delay on collapse because the browser animates from the real height down to 9999px first.

The correct approach is to measure the real `scrollHeight` in JS and animate to that:

```js
function toggleInstanceList(btn) {
    const list = btn.nextElementSibling;
    const isExpanded = btn.classList.toggle('expanded');
    list.classList.toggle('expanded', isExpanded);
    list.style.height = isExpanded ? list.scrollHeight + 'px' : '0';
}
```

CSS handles the easing:

```css
.instances-list {
    height: 0;
    overflow: hidden;
    transition: height 400ms cubic-bezier(0.16, 1, 0.3, 1),
                opacity 300ms ease;
}
```

### Horizontal Scroll vs Height Animation: The Two-Layer Fix

Here is a subtle conflict that bites most implementations: if the parent element has `overflow: hidden` (required for the height animation), you cannot also have `overflow-x: auto` on it (required for wide tables on mobile).

The fix is two separate elements with a single responsibility each:

```html
<div class="instances-list">        <!-- overflow: hidden; height animated -->
  <div class="table-scroll">        <!-- overflow-x: auto; handles wide tables -->
    <table class="instances-table"> <!-- min-width: 600px -->
```

`overflow: hidden` on the outer clips the height. `overflow-x: auto` on the inner clips only the horizontal axis and enables the scrollbar. They do not interfere.

---

## The Comparison Feature

This was the most architecturally interesting piece. The requirements:

- Select up to 4 instances from anywhere in the page (different family cards, even different tabs)
- Show a live tray as items are added/removed
- Open a modal with a structured spec table
- Highlight best and worst numeric value per row
- Handle mixed EC2 + RDS selections gracefully

### Identity Keys

Each instance gets a namespaced string key:

```
ec2:t3.micro
ec2:m7g.4xlarge
rds:db.r6g.large
```

The colon-delimited prefix prevents key collisions across types and makes the type trivially extractable.

### Instance Lookup Map

After data loads, we build a flat lookup map so the comparison modal never has to traverse the family hierarchy:

```js
for (const [, fam] of Object.entries(ec2Families)) {
    for (const inst of fam.instances) {
        state.instanceLookup.set(`ec2:${inst.instanceType}`, { itype: 'ec2', ...inst });
    }
}
```

O(1) access by key anywhere in the app.

### Event Delegation for Compare Buttons

The `+` compare buttons are inside dynamically rendered table rows. Rather than attaching individual listeners (which would need to be re-attached on re-render), we use a single delegated listener on the grid container:

```js
els.ec2Grid.addEventListener('click', handleCompareClick);

function handleCompareClick(e) {
    const btn = e.target.closest('.compare-row-btn');
    if (!btn) return;
    toggleCompare(btn.dataset.ikey);
}
```

One listener. Zero memory leaks. Works for rows added at any time.

### Best/Worst Highlighting

The comparison table does one pass over the numeric values per row to find min and max, then marks cells:

```js
function buildCompareRow(label, displayVals, numericVals, higherIsBetter) {
    const validNums = numericVals.filter(v => v !== null && v !== Infinity);
    if (validNums.length < 2) {
        return numericVals.map((_, i) =>
            `<td class="compare-val">${displayVals[i]}</td>`
        ).join('');
    }
    const best  = higherIsBetter ? Math.max(...validNums) : Math.min(...validNums);
    const worst = higherIsBetter ? Math.min(...validNums) : Math.max(...validNums);
    return numericVals.map((val, i) => {
        let cls = 'compare-val';
        if (val === best  && best  !== worst) cls += ' compare-val-best';
        if (val === worst && best  !== worst) cls += ' compare-val-worst';
        return `<td class="${cls}">${displayVals[i]}</td>`;
    }).join('');
}
```

`higherIsBetter: true` for vCPUs and memory. `higherIsBetter: false` for cost. The `best !== worst` guard prevents both highlighting when all values are equal.

---

## Theming: CSS Custom Properties All the Way Down

The entire colour system is expressed as CSS custom properties. Dark mode is the default (`body` has no attribute). Light mode applies overrides via `[data-theme="light"]`:

```css
:root {
    --bg-primary:      #050B16;
    --accent-primary:  #00D4FF;
    --neon-magenta:    #FF0080;
    /* ... */
}

[data-theme="light"] {
    --bg-primary:      #EDF3FF;
    --accent-primary:  #0077CC;
    /* ... */
}
```

The toggle writes to `localStorage` and sets `document.documentElement.setAttribute('data-theme', 'light')`. Every component picks up the change instantly — no JS rerenders, no class toggling on individual elements.

Per-card accent colours (used for hover glows) are set as inline custom properties:

```js
`<div class="family-card" style="--card-accent: ${color}">`
```

CSS references them:

```css
.family-card:hover {
    border-color: var(--card-accent);
    box-shadow: 0 0 24px rgba(var(--card-accent-rgb), 0.18);
}
```

---

## IAM Permissions (Least Privilege)

The GitHub Actions role needs exactly three AWS managed policies:

```
AmazonEC2ReadOnlyAccess
AmazonRDSReadOnlyAccess
AWSPriceListServiceFullAccess
```

No write access to EC2 or RDS. No IAM permissions. The only write action the workflow takes is a `git push` back to the repo — that happens over HTTPS using `GITHUB_TOKEN`, which GitHub provides automatically.

OIDC trust policy (replace `ACCOUNT_ID`, `OWNER`, `REPO`):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:OWNER/REPO:ref:refs/heads/main"
      }
    }
  }]
}
```

No access keys. No rotation. The token is ephemeral and scoped to the specific repo and branch.

---

## Key Takeaways

**1. Static sites are underrated for internal tooling.**
A GitHub Pages deployment with a weekly GitHub Actions job costs $0, requires no on-call rotation, and has better uptime than most self-hosted tools.

**2. Separate dynamic data from curated content.**
The two-layer `data.json` pattern (CI owns the numbers, humans own the reasoning) keeps automated updates safe — the script can never overwrite editorial content.

**3. Pick the right level of complexity.**
This is ~1200 lines of vanilla JS. No framework was needed. Every architectural pattern here (state object, event delegation, render functions, CSS custom properties) is native to the platform and will work in any browser for the next decade without a dependency update.

**4. The two-layer overflow pattern is reusable.**
Anywhere you need a height-animated collapsible container that also contains horizontally scrollable content, the `overflow: hidden` parent + `overflow-x: auto` inner child pattern applies.

**5. OIDC for GitHub Actions is table-stakes.**
If you are still using long-lived IAM access keys in GitHub Secrets, migrate to OIDC. The setup is a one-time 15-minute task and eliminates an entire category of credential exposure risk.

---

## What's Next

- **Savings Plans / Reserved pricing** columns in the comparison table
- **Region selector** — switch pricing baseline from us-east-1 to any region
- **Shareable comparison URLs** — encode selected instances in the URL hash so you can share a comparison link
- **Export to CSV** — download the comparison table for a spreadsheet

---

*InstanceIQ is open source. Source code and the full GitHub Actions workflow are in the repo. Contributions welcome.*
