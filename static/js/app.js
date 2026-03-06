/**
 * AWS Instance Explorer — Fully Static Frontend
 *
 * Loads all EC2 & RDS data from a static JSON file.
 * NO backend needed. NO AWS credentials needed.
 * Reasoning is based on AWS best practices — NO AI used.
 *
 * Can be hosted on GitHub Pages or any static file server.
 */

// ─── State ───────────────────────────────────────────────────
const state = {
    activeTab: 'ec2',
    activeFilter: 'all',
    searchQuery: '',
    ec2Data: null,
    rdsData: null,
    engineData: null,
    compareItems: new Map(),      // key → { itype, label, data }
    instanceLookup: new Map(),    // "ec2:t3.micro" / "rds:db.r6g.large" → instance
    activeRegion: 'us-east-1',
    ec2RegionalPrices: {},        // inst_type → { region → { linux, windows } }
    rdsRegionalPrices: {},        // db_class  → { region → price }
    supportedRegions: ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'],
};

const MAX_COMPARE = 4;

const REGION_LABELS = {
    'us-east-1':      'US East (N. Virginia)',
    'us-west-2':      'US West (Oregon)',
    'eu-west-1':      'EU (Ireland)',
    'ap-southeast-1': 'AP (Singapore)',
};

const CATEGORY_FILTER_MAP = {
    'general': 'General Purpose',
    'compute': 'Compute Optimized',
    'memory': 'Memory Optimized',
    'storage': 'Storage Optimized',
    'accelerated': 'Accelerated Computing',
    'hpc': 'HPC Optimized',
};

// ─── DOM References ──────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {
    bgParticles: $('#bgParticles'),
    mainNav: $('#mainNav'),
    searchInput: $('#searchInput'),
    filterChips: $('#filterChips'),
    loadingState: $('#loadingState'),
    errorState: $('#errorState'),
    errorMessage: $('#errorMessage'),
    ec2Content: $('#ec2Content'),
    rdsContent: $('#rdsContent'),
    enginesContent: $('#enginesContent'),
    ec2Grid: $('#ec2FamiliesGrid'),
    rdsGrid: $('#rdsFamiliesGrid'),
    enginesGrid: $('#enginesGrid'),
    statEc2Count: $('#statEc2Count'),
    statEc2Families: $('#statEc2Families'),
    statRdsCount: $('#statRdsCount'),
    statRdsEngines: $('#statRdsEngines'),
};

// ─── Initialize ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

function init() {
    applyStoredTheme();
    createParticles();
    setupNavScrollEffect();
    setupTabs();
    setupFilters();
    setupSearch();
    setupThemeToggle();
    setupCompare();
    setupRegionSelector();
    loadStaticData();
}

// ─── Theme ───────────────────────────────────────────────────
function applyStoredTheme() {
    const stored = localStorage.getItem('iq-theme');
    if (stored === 'light') document.documentElement.setAttribute('data-theme', 'light');
}

function setupThemeToggle() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        if (isLight) {
            document.documentElement.removeAttribute('data-theme');
            localStorage.setItem('iq-theme', 'dark');
        } else {
            document.documentElement.setAttribute('data-theme', 'light');
            localStorage.setItem('iq-theme', 'light');
        }
    });
}

// ─── Background Particles ────────────────────────────────────
function createParticles() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Cyberpunk neon palette
    const colors = ['#00D4FF', '#FF0080', '#9D00FF', '#00FF88', '#FFD700'];
    for (let i = 0; i < 30; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        const size = Math.random() * 4 + 2;
        const color = colors[Math.floor(Math.random() * colors.length)];
        particle.style.cssText = `
            width: ${size}px;
            height: ${size}px;
            left: ${Math.random() * 100}%;
            background: ${color};
            animation-duration: ${Math.random() * 20 + 15}s;
            animation-delay: ${Math.random() * 10}s;
        `;
        els.bgParticles.appendChild(particle);
    }
}

// ─── Nav Scroll Effect ───────────────────────────────────────
function setupNavScrollEffect() {
    let ticking = false;
    window.addEventListener('scroll', () => {
        if (!ticking) {
            requestAnimationFrame(() => {
                els.mainNav.classList.toggle('scrolled', window.scrollY > 20);
                ticking = false;
            });
            ticking = true;
        }
    });
}

// ─── Tabs ────────────────────────────────────────────────────
function setupTabs() {
    $$('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            if (tab === state.activeTab) return;
            state.activeTab = tab;

            $$('.tab-btn').forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');

            $$('.tab-content').forEach(c => c.classList.remove('active'));
            $(`#${tab}Content`).classList.add('active');

            // Reset filter state on tab switch so stale filters don't bleed across tabs
            state.activeFilter = 'all';
            $$('.chip').forEach(c => {
                c.classList.remove('active');
                c.setAttribute('aria-pressed', 'false');
            });
            const allChip = $('.chip[data-filter="all"]');
            if (allChip) {
                allChip.classList.add('active');
                allChip.setAttribute('aria-pressed', 'true');
            }

            if (tab === 'engines') {
                els.filterChips.style.display = 'none';
                els.searchInput.placeholder = 'Search database engines...';
            } else {
                els.filterChips.style.display = 'flex';
                els.searchInput.placeholder = 'Search instance types... (e.g., m5.xlarge, gpu, burstable)';
                applyFilters();
            }
        });
    });
}

// ─── Filters ─────────────────────────────────────────────────
function setupFilters() {
    $$('.chip').forEach(chip => {
        chip.addEventListener('click', () => {
            state.activeFilter = chip.dataset.filter;
            $$('.chip').forEach(c => {
                c.classList.remove('active');
                c.setAttribute('aria-pressed', 'false');
            });
            chip.classList.add('active');
            chip.setAttribute('aria-pressed', 'true');
            applyFilters();
        });
    });
}

function applyFilters() {
    const grid = state.activeTab === 'ec2' ? els.ec2Grid : els.rdsGrid;
    const cards = grid.querySelectorAll('.family-card');
    cards.forEach(card => {
        const category = card.dataset.category;
        // Use pre-built search text cache instead of reading live DOM text
        const searchText = card.dataset.searchText || '';
        const matchesFilter = state.activeFilter === 'all' ||
            category === CATEGORY_FILTER_MAP[state.activeFilter];
        const matchesSearch = !state.searchQuery || searchText.includes(state.searchQuery);
        card.style.display = (matchesFilter && matchesSearch) ? 'block' : 'none';
    });
}

// ─── Search ──────────────────────────────────────────────────
function setupSearch() {
    let debounceTimer;
    els.searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            state.searchQuery = e.target.value.toLowerCase().trim();
            if (state.activeTab === 'engines') {
                applyEngineSearch();
            } else {
                applyFilters();
            }
        }, 200);
    });
}

function applyEngineSearch() {
    const cards = els.enginesGrid.querySelectorAll('.engine-card');
    cards.forEach(card => {
        const searchText = card.dataset.searchText || '';
        const matchesSearch = !state.searchQuery || searchText.includes(state.searchQuery);
        card.style.display = matchesSearch ? 'block' : 'none';
    });
}

// ─── Load Static Data ────────────────────────────────────────
async function loadStaticData() {
    els.loadingState.style.display = 'flex';
    try {
        const resp = await fetch('./static/data.json');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        // Build EC2 data
        const ec2Families = {};
        let totalEc2 = 0;
        for (const [key, reasoning] of Object.entries(data.ec2Families)) {
            const instances = (data.ec2Instances[key] || []).map(inst => ({
                instanceType: inst.type,
                vCPUs: inst.vCPUs,
                memoryGiB: inst.memoryGiB,
                networkPerformance: inst.network,
                currentGeneration: inst.gen,
                burstable: key === 't',
                price_hourly: inst.price_hourly,
                price_hourly_windows: inst.price_hourly_windows,
            }));
            ec2Families[key] = { reasoning, instances, count: instances.length };
            totalEc2 += instances.length;
        }
        state.ec2Data = { families: ec2Families, totalTypes: totalEc2, totalFamilies: Object.keys(ec2Families).length };

        // Build RDS data
        const rdsFamilies = {};
        let totalRds = 0;
        for (const [key, reasoning] of Object.entries(data.rdsFamilies)) {
            const instances = (data.rdsInstances[key] || []).map(inst => ({
                dbInstanceClass: inst.class,
                engine: inst.engine,
                price_hourly: inst.price_hourly,
            }));
            rdsFamilies[key] = { reasoning, instances, count: instances.length };
            totalRds += instances.length;
        }
        state.rdsData = { families: rdsFamilies, totalClasses: totalRds, totalFamilies: Object.keys(rdsFamilies).length };

        state.engineData = data.rdsEngines;
        state.ec2RegionalPrices = data.ec2RegionalPrices || {};
        state.rdsRegionalPrices = data.rdsRegionalPrices || {};
        if (data.supportedRegions?.length) state.supportedRegions = data.supportedRegions;

        // Set last updated timestamp if available
        if (data.lastUpdated) {
            const date = new Date(data.lastUpdated);
            $('#lastUpdated').textContent = `Last updated: ${date.toLocaleDateString()}`;
        }

        // Build lookup for comparison feature
        for (const [, fam] of Object.entries(ec2Families)) {
            for (const inst of fam.instances) {
                state.instanceLookup.set(`ec2:${inst.instanceType}`, { itype: 'ec2', ...inst });
            }
        }
        for (const [, fam] of Object.entries(rdsFamilies)) {
            for (const inst of fam.instances) {
                state.instanceLookup.set(`rds:${inst.dbInstanceClass}`, { itype: 'rds', ...inst });
            }
        }

        // Populate region selector with live supported regions
        populateRegionSelector();

        // Render everything
        updateStats();
        renderEc2Families();
        renderRdsFamilies();
        renderEngines();

        // Restore comparison from URL hash (after lookup is built)
        parseCompareFromHash();

    } catch (err) {
        console.error('Failed to load data:', err);
        els.errorState.classList.remove('hidden');
        els.errorMessage.textContent = 'Failed to load data.json. Make sure the file exists.';
    } finally {
        els.loadingState.style.display = 'none';
    }
}

function updateStats() {
    if (state.ec2Data) {
        animateNumber(els.statEc2Count, state.ec2Data.totalTypes);
        animateNumber(els.statEc2Families, state.ec2Data.totalFamilies);
    }
    if (state.rdsData) {
        animateNumber(els.statRdsCount, state.rdsData.totalClasses);
    }
    if (state.engineData) {
        animateNumber(els.statRdsEngines, Object.keys(state.engineData).length);
    }
}

function animateNumber(el, target) {
    const duration = 1200;
    const start = performance.now();
    const startVal = parseInt(el.textContent) || 0;
    function update(now) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(startVal + (target - startVal) * eased).toLocaleString();
        if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
}

// ─── Render EC2 Families ─────────────────────────────────────
function renderEc2Families() {
    if (!state.ec2Data) return;
    const families = state.ec2Data.families;
    const sortedKeys = Object.keys(families).sort((a, b) => {
        const catA = families[a].reasoning?.category || '';
        const catB = families[b].reasoning?.category || '';
        if (catA !== catB) return catA.localeCompare(catB);
        return a.localeCompare(b);
    });
    els.ec2Grid.innerHTML = sortedKeys.map((key, idx) => {
        const fam = families[key];
        return buildFamilyCardHTML(key, fam, fam.reasoning || {}, idx, 'ec2');
    }).join('');
    els.ec2Grid.querySelectorAll('.instances-toggle').forEach(btn => {
        btn.addEventListener('click', () => toggleInstanceList(btn));
    });
    // Event delegation for compare buttons
    els.ec2Grid.addEventListener('click', handleCompareClick);
}

// ─── Render RDS Families ─────────────────────────────────────
function renderRdsFamilies() {
    if (!state.rdsData) return;
    const families = state.rdsData.families;
    const sortedKeys = Object.keys(families).sort();
    els.rdsGrid.innerHTML = sortedKeys.map((key, idx) => {
        const fam = families[key];
        return buildFamilyCardHTML(key, fam, fam.reasoning || {}, idx, 'rds');
    }).join('');
    els.rdsGrid.querySelectorAll('.instances-toggle').forEach(btn => {
        btn.addEventListener('click', () => toggleInstanceList(btn));
    });
    // Event delegation for compare buttons
    els.rdsGrid.addEventListener('click', handleCompareClick);
}

// ─── Build Family Card HTML ──────────────────────────────────
function buildFamilyCardHTML(key, fam, r, idx, type) {
    const color = r.color || '#90A4AE';
    const gradient = r.gradient || `linear-gradient(135deg, ${color}, ${color})`;
    const category = r.category || 'Other';
    const familyName = r.family_name || key;
    const headline = r.headline || '';
    const icon = r.icon || '📦';
    const reasoning = r.reasoning || '';
    const bestFor = r.best_for || [];
    const notFor = r.not_for || [];
    const keySpecs = r.key_specs || {};
    const instances = fam.instances || [];
    const count = fam.count || instances.length;

    // Build search text at render time so we never read live DOM during search
    const searchText = [
        familyName, category, headline, reasoning,
        ...bestFor, ...notFor,
        ...instances.map(i => i.instanceType || i.dbInstanceClass || ''),
    ].join(' ').toLowerCase();

    const specsHtml = Object.entries(keySpecs).map(([label, value]) => `
        <div class="spec-item">
            <div class="spec-label">${esc(label)}</div>
            <div class="spec-value">${esc(String(value))}</div>
        </div>
    `).join('');

    const bestForHtml = bestFor.map((item, i) => `
        <span class="usecase-tag best" style="animation-delay: ${i * 0.05}s">${esc(item)}</span>
    `).join('');

    const notForHtml = notFor.map((item, i) => `
        <span class="usecase-tag avoid" style="animation-delay: ${i * 0.05}s">${esc(item)}</span>
    `).join('');

    let tableHtml = '';
    const regionLabel = REGION_LABELS[state.activeRegion] || state.activeRegion;
    if (type === 'ec2') {
        const rows = instances.slice(0, 50).map((inst, i) => {
            const lp = getEc2LinuxPrice(inst.instanceType);
            const wp = getEc2WindowsPrice(inst.instanceType);
            const costHtml    = lp ? `<span class="price-val">$${lp.toFixed(3)}/hr<br><span style="font-size:10px;opacity:0.7">~$${(lp*730).toFixed(2)}/mo</span></span>` : '<span style="color:var(--text-muted)">N/A</span>';
            const winCostHtml = wp ? `<span class="price-val">$${wp.toFixed(3)}/hr<br><span style="font-size:10px;opacity:0.7">~$${(wp*730).toFixed(2)}/mo</span></span>` : '<span style="color:var(--text-muted)">N/A</span>';
            const ikey = `ec2:${inst.instanceType}`;
            return `
            <tr style="animation-delay: ${i * 0.02}s">
                <td><span class="instance-type-name">${esc(inst.instanceType)}
                    ${inst.currentGeneration ? '<span class="gen-badge">Current</span>' : '<span class="gen-badge old">Prev</span>'}
                </span></td>
                <td>${inst.vCPUs}</td>
                <td>${inst.memoryGiB} GiB</td>
                <td>${esc(inst.networkPerformance || '—')}</td>
                <td>${inst.burstable ? '⚡ Yes' : '—'}</td>
                <td>${costHtml}</td>
                <td>${winCostHtml}</td>
                <td><button class="compare-row-btn" data-ikey="${esc(ikey)}" title="Add to compare">+</button></td>
            </tr>
        `}).join('');
        tableHtml = `<div class="table-scroll"><table class="instances-table"><thead><tr>
            <th>Instance Type</th><th>vCPUs</th><th>Memory</th><th>Network</th><th>Burstable</th><th>Linux (OD · ${esc(regionLabel)})</th><th>Windows (OD · ${esc(regionLabel)})</th><th></th>
        </tr></thead><tbody>${rows}</tbody></table></div>`;
    } else {
        const rows = instances.slice(0, 50).map((inst, i) => {
            const p = getRdsPrice(inst.dbInstanceClass);
            const costHtml = p ? `<span class="price-val">$${p.toFixed(3)}/hr<br><span style="font-size:10px;opacity:0.7">~$${(p*730).toFixed(2)}/mo</span></span>` : '<span style="color:var(--text-muted)">Varies by engine</span>';
            const ikey = `rds:${inst.dbInstanceClass}`;
            return `
            <tr style="animation-delay: ${i * 0.02}s">
                <td>${esc(inst.dbInstanceClass)}</td>
                <td>${inst.engine.split(', ').map(e => `<span class="engine-tag" style="margin:2px">${esc(e)}</span>`).join('')}</td>
                <td>${costHtml}</td>
                <td><button class="compare-row-btn" data-ikey="${esc(ikey)}" title="Add to compare">+</button></td>
            </tr>
        `}).join('');
        tableHtml = `<div class="table-scroll"><table class="instances-table"><thead><tr>
            <th>DB Instance Class</th><th>Supported Engines</th><th>MySQL Single-AZ (OD · ${esc(regionLabel)})</th><th></th>
        </tr></thead><tbody>${rows}</tbody></table></div>`;
    }

    return `
        <div class="family-card stagger-${Math.min(idx + 1, 17)}"
             style="--card-accent: ${color}"
             data-category="${esc(category)}" data-family-name="${esc(familyName)}" data-family-key="${esc(key)}"
             data-search-text="${esc(searchText)}">
            <div class="family-card-header">
                <div class="family-icon-wrapper" style="background: ${gradient}"><span>${icon}</span></div>
                <div class="family-header-text">
                    <div class="family-category" style="color: ${color}">${esc(category)}</div>
                    <div class="family-name">${esc(familyName)}</div>
                    <div class="family-headline">${esc(headline)}</div>
                </div>
                <div class="family-count-badge" style="background: rgba(${hexToRgb(color)}, 0.1); color: ${color}">${count} types</div>
            </div>
            <div class="family-card-body">
                <div class="reasoning-section">
                    <div class="reasoning-title">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                            <line x1="12" y1="17" x2="12.01" y2="17"></line>
                        </svg>
                        Why this family?
                    </div>
                    <p class="reasoning-text">${esc(reasoning)}</p>
                    <div class="key-specs">${specsHtml}</div>
                    <div class="usecase-section">
                        <div class="usecase-group best"><h4>✅ Best For</h4><div class="usecase-tags">${bestForHtml}</div></div>
                        <div class="usecase-group avoid"><h4>❌ Not Ideal For</h4><div class="usecase-tags">${notForHtml}</div></div>
                    </div>
                </div>
                <div class="instance-types-section">
                    <button class="instances-toggle" aria-expanded="false">
                        <span>📋 View ${count} Instance Types</span>
                        <span class="toggle-icon">▼</span>
                    </button>
                    <div class="instances-list">${tableHtml}</div>
                </div>
            </div>
        </div>
    `;
}

// ─── Render Engines ──────────────────────────────────────────
function renderEngines() {
    if (!state.engineData) return;
    els.enginesGrid.innerHTML = Object.entries(state.engineData).map(([key, eng], idx) => {
        const color = eng.color || '#666';
        const bestForHtml = (eng.best_for || []).map(item => `
            <span class="engine-tag">${esc(item)}</span>
        `).join('');
        const searchText = [
            eng.engine_name || '', eng.headline || '', eng.reasoning || '',
            ...(eng.best_for || []),
        ].join(' ').toLowerCase();
        return `
            <div class="engine-card stagger-${Math.min(idx + 1, 17)}" style="--card-accent: ${color}" data-search-text="${esc(searchText)}">
                <div class="engine-card-header" style="border-top: 3px solid ${color}">
                    <span class="engine-icon">${eng.icon || '🗄️'}</span>
                    <div class="engine-name" style="color: ${color}">${esc(eng.engine_name)}</div>
                    <div class="engine-headline">${esc(eng.headline || '')}</div>
                </div>
                <div class="engine-card-body">
                    <p class="engine-reasoning">${esc(eng.reasoning || '')}</p>
                    <div class="engine-best-for">${bestForHtml}</div>
                </div>
            </div>
        `;
    }).join('');
}

// ─── Toggle Instance List ────────────────────────────────────
function toggleInstanceList(btn) {
    const list = btn.nextElementSibling;
    const isExpanded = btn.classList.toggle('expanded');
    btn.setAttribute('aria-expanded', isExpanded);
    list.classList.toggle('expanded', isExpanded);
    if (isExpanded) {
        list.style.height = list.scrollHeight + 'px';
    } else {
        list.style.height = '0';
    }
}

// ─── Helpers ─────────────────────────────────────────────────
function esc(str) {
    if (typeof str !== 'string') return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

// ─── Regional Price Helpers ───────────────────────────────────
function getEc2LinuxPrice(instanceType) {
    const r = state.ec2RegionalPrices?.[instanceType]?.[state.activeRegion];
    if (r?.linux != null) return r.linux;
    return state.instanceLookup.get(`ec2:${instanceType}`)?.price_hourly ?? null;
}

function getEc2WindowsPrice(instanceType) {
    const r = state.ec2RegionalPrices?.[instanceType]?.[state.activeRegion];
    if (r?.windows != null) return r.windows;
    return state.instanceLookup.get(`ec2:${instanceType}`)?.price_hourly_windows ?? null;
}

function getRdsPrice(dbClass) {
    const r = state.rdsRegionalPrices?.[dbClass]?.[state.activeRegion];
    if (r != null) return r;
    return state.instanceLookup.get(`rds:${dbClass}`)?.price_hourly ?? null;
}

// ─── Region Selector ─────────────────────────────────────────
function setupRegionSelector() {
    const sel = document.getElementById('regionSelect');
    if (!sel) return;
    sel.addEventListener('change', () => {
        state.activeRegion = sel.value;
        renderEc2Families();
        renderRdsFamilies();
        // Refresh open comparison modal if visible
        if (document.getElementById('compareOverlay').classList.contains('visible')) {
            document.getElementById('compareModalBody').innerHTML = buildComparisonHTML();
        }
    });
}

function populateRegionSelector() {
    const sel = document.getElementById('regionSelect');
    if (!sel) return;
    sel.innerHTML = state.supportedRegions.map(r =>
        `<option value="${r}"${r === state.activeRegion ? ' selected' : ''}>${r} — ${REGION_LABELS[r] || r}</option>`
    ).join('');
}

// ─── URL Hash (shareable comparisons) ────────────────────────
function updateCompareHash() {
    const keys = [...state.compareItems.keys()];
    if (keys.length > 0) {
        history.replaceState(null, '', '#compare=' + encodeURIComponent(keys.join(',')));
    } else {
        history.replaceState(null, '', window.location.pathname + window.location.search);
    }
}

function parseCompareFromHash() {
    const hash = window.location.hash;
    if (!hash.startsWith('#compare=')) return;
    let keys;
    try { keys = decodeURIComponent(hash.slice('#compare='.length)).split(','); }
    catch { return; }
    for (const key of keys) {
        if (!key || !state.instanceLookup.has(key) || state.compareItems.size >= MAX_COMPARE) continue;
        const inst = state.instanceLookup.get(key);
        const [itype, label] = key.startsWith('ec2:')
            ? ['ec2', inst.instanceType]
            : ['rds', inst.dbInstanceClass];
        state.compareItems.set(key, { itype, label, data: inst });
    }
    if (state.compareItems.size > 0) {
        updateAllCompareButtons();
        renderCompareTray();
        if (state.compareItems.size >= 2) openComparisonModal();
    }
}

// ─── CSV Export ───────────────────────────────────────────────
function exportComparisonCSV() {
    const items     = [...state.compareItems.values()];
    const ec2Items  = items.filter(i => i.itype === 'ec2');
    const rdsItems  = items.filter(i => i.itype === 'rds');
    const region    = state.activeRegion;
    const rows      = [];

    if (ec2Items.length > 0) {
        rows.push(['', ...ec2Items.map(i => i.label)]);
        rows.push(['Type', ...ec2Items.map(() => 'EC2')]);
        rows.push([`Region`, ...ec2Items.map(() => region)]);
        rows.push(['vCPUs', ...ec2Items.map(i => i.data.vCPUs)]);
        rows.push(['Memory (GiB)', ...ec2Items.map(i => i.data.memoryGiB)]);
        rows.push(['Network', ...ec2Items.map(i => i.data.networkPerformance || '—')]);
        rows.push(['Burstable', ...ec2Items.map(i => i.data.burstable ? 'Yes' : 'No')]);
        rows.push(['Current Gen', ...ec2Items.map(i => i.data.currentGeneration ? 'Yes' : 'No')]);
        rows.push([`Linux/hr (OD)`, ...ec2Items.map(i => {
            const p = getEc2LinuxPrice(i.data.instanceType);
            return p != null ? `$${p.toFixed(4)}` : 'N/A';
        })]);
        rows.push([`Windows/hr (OD)`, ...ec2Items.map(i => {
            const p = getEc2WindowsPrice(i.data.instanceType);
            return p != null ? `$${p.toFixed(4)}` : 'N/A';
        })]);
        rows.push([`Monthly Linux Est.`, ...ec2Items.map(i => {
            const p = getEc2LinuxPrice(i.data.instanceType);
            return p != null ? `$${(p * 730).toFixed(2)}` : 'N/A';
        })]);
    }

    if (rdsItems.length > 0) {
        if (rows.length > 0) rows.push([]);
        rows.push(['', ...rdsItems.map(i => i.label)]);
        rows.push(['Type', ...rdsItems.map(() => 'RDS')]);
        rows.push([`Region`, ...rdsItems.map(() => region)]);
        rows.push(['Supported Engines', ...rdsItems.map(i => i.data.engine || '—')]);
        rows.push([`Hourly MySQL Single-AZ (OD)`, ...rdsItems.map(i => {
            const p = getRdsPrice(i.data.dbInstanceClass);
            return p != null ? `$${p.toFixed(4)}` : 'Varies';
        })]);
        rows.push([`Monthly Est.`, ...rdsItems.map(i => {
            const p = getRdsPrice(i.data.dbInstanceClass);
            return p != null ? `$${(p * 730).toFixed(2)}` : 'Varies';
        })]);
    }

    const csv  = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `instanceiq-compare-${region}-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ─── Compare Feature ─────────────────────────────────────────
function setupCompare() {
    const openBtn      = document.getElementById('compareOpenBtn');
    const clearBtn     = document.getElementById('compareClearBtn');
    const closeBtn     = document.getElementById('compareCloseBtn');
    const copyBtn      = document.getElementById('compareCopyBtn');
    const exportCsvBtn = document.getElementById('compareExportCsvBtn');
    const overlay      = document.getElementById('compareOverlay');

    openBtn.addEventListener('click', openComparisonModal);
    clearBtn.addEventListener('click', clearCompare);
    closeBtn.addEventListener('click', closeComparisonModal);
    copyBtn.addEventListener('click', copyCompareLink);
    exportCsvBtn.addEventListener('click', exportComparisonCSV);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeComparisonModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeComparisonModal();
    });
}

function copyCompareLink() {
    updateCompareHash();
    const url = window.location.href;
    navigator.clipboard?.writeText(url).then(() => {
        const btn = document.getElementById('compareCopyBtn');
        if (!btn) return;
        btn.classList.add('copied');
        btn.childNodes[btn.childNodes.length - 1].textContent = ' Copied!';
        setTimeout(() => {
            btn.classList.remove('copied');
            btn.childNodes[btn.childNodes.length - 1].textContent = ' Copy link';
        }, 2000);
    }).catch(() => {
        const el = document.createElement('textarea');
        el.value = url;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
    });
}

function handleCompareClick(e) {
    const btn = e.target.closest('.compare-row-btn');
    if (!btn) return;
    const ikey = btn.dataset.ikey;
    if (!ikey) return;
    toggleCompare(ikey);
}

function toggleCompare(ikey) {
    if (state.compareItems.has(ikey)) {
        state.compareItems.delete(ikey);
    } else {
        if (state.compareItems.size >= MAX_COMPARE) return;
        const inst = state.instanceLookup.get(ikey);
        if (!inst) return;
        const [itype, label] = ikey.startsWith('ec2:')
            ? ['ec2', inst.instanceType]
            : ['rds', inst.dbInstanceClass];
        state.compareItems.set(ikey, { itype, label, data: inst });
    }
    updateAllCompareButtons();
    renderCompareTray();
    updateCompareHash();
}

function updateAllCompareButtons() {
    const atMax = state.compareItems.size >= MAX_COMPARE;
    document.querySelectorAll('.compare-row-btn').forEach(btn => {
        const ikey = btn.dataset.ikey;
        const selected = state.compareItems.has(ikey);
        btn.classList.toggle('active', selected);
        btn.textContent = selected ? '✓' : '+';
        btn.title = selected ? 'Remove from compare' : (atMax ? 'Max 4 reached' : 'Add to compare');
        btn.classList.toggle('disabled', !selected && atMax);
    });
}

function renderCompareTray() {
    const tray = document.getElementById('compareTray');
    const slots = document.getElementById('compareTraySlots');
    const hint = document.getElementById('compareTrayHint');
    const openBtn = document.getElementById('compareOpenBtn');
    const countSpan = document.getElementById('compareCount');
    const count = state.compareItems.size;

    if (count === 0) {
        tray.classList.remove('visible');
        return;
    }
    tray.classList.add('visible');
    openBtn.disabled = count < 2;
    countSpan.textContent = count;
    hint.textContent = count < 2 ? 'Add 1 more to compare' : `${count} selected — ready to compare`;

    // Fill slots (always show 4 slots)
    const items = [...state.compareItems.entries()];
    let html = '';
    for (let i = 0; i < MAX_COMPARE; i++) {
        if (i < items.length) {
            const [ikey, { label }] = items[i];
            html += `<div class="compare-slot">
                <span class="compare-slot-label" title="${esc(label)}">${esc(label)}</span>
                <button class="compare-slot-remove" data-ikey="${esc(ikey)}" title="Remove">✕</button>
            </div>`;
        } else {
            html += `<div class="compare-slot compare-slot-empty"></div>`;
        }
    }
    slots.innerHTML = html;
    slots.querySelectorAll('.compare-slot-remove').forEach(btn => {
        btn.addEventListener('click', () => toggleCompare(btn.dataset.ikey));
    });
}

function clearCompare() {
    state.compareItems.clear();
    updateAllCompareButtons();
    renderCompareTray();
    updateCompareHash();
}

function openComparisonModal() {
    if (state.compareItems.size < 2) return;
    const overlay = document.getElementById('compareOverlay');
    const body = document.getElementById('compareModalBody');
    body.innerHTML = buildComparisonHTML();
    overlay.classList.add('visible');
    document.body.style.overflow = 'hidden';
}

function closeComparisonModal() {
    document.getElementById('compareOverlay').classList.remove('visible');
    document.body.style.overflow = '';
}

function buildComparisonHTML() {
    const items = [...state.compareItems.values()];
    const ec2Items = items.filter(i => i.itype === 'ec2');
    const rdsItems = items.filter(i => i.itype === 'rds');
    let html = '';

    if (ec2Items.length > 0 && rdsItems.length > 0) {
        html += `<div class="compare-mixed-notice">⚠ Comparing mixed types (EC2 + RDS). Each section is shown separately.</div>`;
    }
    if (ec2Items.length > 0) {
        html += buildEc2ComparisonTable(ec2Items);
    }
    if (rdsItems.length > 0) {
        if (ec2Items.length > 0) html += `<br>`;
        html += buildRdsComparisonTable(rdsItems);
    }
    return html;
}

function buildEc2ComparisonTable(items) {
    const regionLabel = REGION_LABELS[state.activeRegion] || state.activeRegion;
    const headers = items.map(i => `<th class="compare-instance-header">
        <div class="compare-instance-name">${esc(i.label)}</div>
        <div class="compare-instance-type-label">EC2 Instance</div>
    </th>`).join('');

    const vcpus   = items.map(i => i.data.vCPUs || 0);
    const mems    = items.map(i => i.data.memoryGiB || 0);
    const pricesL = items.map(i => getEc2LinuxPrice(i.data.instanceType));
    const pricesW = items.map(i => getEc2WindowsPrice(i.data.instanceType));

    const vcpuRow  = buildCompareRow('vCPUs', vcpus.map(v => v.toLocaleString()), vcpus, true);
    const memRow   = buildCompareRow('Memory (GiB)', mems.map(v => `${v} GiB`), mems, true);
    const netRow   = items.map(i => `<td class="compare-val">${esc(i.data.networkPerformance || '—')}</td>`).join('');
    const burstRow = items.map(i => `<td class="compare-val">${i.data.burstable ? '⚡ Yes' : '—'}</td>`).join('');
    const genRow   = items.map(i => `<td class="compare-val">${i.data.currentGeneration ? '<span class="gen-badge">Current</span>' : '<span class="gen-badge old">Prev</span>'}</td>`).join('');
    const linuxRow = buildCompareRow(
        'Linux Cost (OD)',
        pricesL.map(p => p ? `$${p.toFixed(3)}/hr` : 'N/A'),
        pricesL.map(p => p || Infinity),
        false  // lower is better for cost
    );
    const winRow = buildCompareRow(
        'Windows Cost (OD)',
        pricesW.map(p => p ? `$${p.toFixed(3)}/hr` : 'N/A'),
        pricesW.map(p => p || Infinity),
        false
    );
    const moRow = buildCompareRow(
        'Monthly Est. (Linux)',
        pricesL.map(p => p ? `~$${(p * 730).toFixed(0)}/mo` : 'N/A'),
        pricesL.map(p => p || Infinity),
        false
    );

    return `
    <p class="compare-notice">// EC2 · ${esc(regionLabel)} · On-Demand · best value <span style="color:var(--neon-green)">green ↑</span></p>
    <div style="overflow-x:auto">
    <table class="compare-table">
        <thead><tr><th>Spec</th>${headers}</tr></thead>
        <tbody>
            <tr class="compare-section-header"><td colspan="${items.length + 1}">// Compute</td></tr>
            <tr><td class="compare-row-label">vCPUs</td>${vcpuRow}</tr>
            <tr><td class="compare-row-label">Memory</td>${memRow}</tr>
            <tr><td class="compare-row-label">Network</td>${netRow}</tr>
            <tr><td class="compare-row-label">Burstable</td>${burstRow}</tr>
            <tr><td class="compare-row-label">Generation</td>${genRow}</tr>
            <tr class="compare-section-header"><td colspan="${items.length + 1}">// Pricing (${esc(regionLabel)} · On-Demand)</td></tr>
            <tr><td class="compare-row-label">Linux/hr</td>${linuxRow}</tr>
            <tr><td class="compare-row-label">Windows/hr</td>${winRow}</tr>
            <tr><td class="compare-row-label">Monthly (Linux)</td>${moRow}</tr>
        </tbody>
    </table>
    </div>`;
}

function buildRdsComparisonTable(items) {
    const regionLabel = REGION_LABELS[state.activeRegion] || state.activeRegion;
    const headers = items.map(i => `<th class="compare-instance-header">
        <div class="compare-instance-name">${esc(i.label)}</div>
        <div class="compare-instance-type-label">RDS Instance Class</div>
    </th>`).join('');

    const prices = items.map(i => getRdsPrice(i.data.dbInstanceClass));
    const priceRow = buildCompareRow(
        'Estimated Cost',
        prices.map(p => p ? `$${p.toFixed(3)}/hr` : 'Varies'),
        prices.map(p => p || Infinity),
        false
    );
    const moRow = buildCompareRow(
        'Monthly Est.',
        prices.map(p => p ? `~$${(p * 730).toFixed(0)}/mo` : 'Varies'),
        prices.map(p => p || Infinity),
        false
    );
    const engRow = items.map(i => `<td class="compare-val" style="font-size:11px">${esc(i.data.engine || '—')}</td>`).join('');

    return `
    <p class="compare-notice">// RDS · ${esc(regionLabel)} · MySQL Single-AZ · best value <span style="color:var(--neon-green)">green ↑</span></p>
    <div style="overflow-x:auto">
    <table class="compare-table">
        <thead><tr><th>Spec</th>${headers}</tr></thead>
        <tbody>
            <tr class="compare-section-header"><td colspan="${items.length + 1}">// Engines</td></tr>
            <tr><td class="compare-row-label">Supported Engines</td>${engRow}</tr>
            <tr class="compare-section-header"><td colspan="${items.length + 1}">// Pricing (${esc(regionLabel)} · MySQL Single-AZ · On-Demand)</td></tr>
            <tr><td class="compare-row-label">Hourly (OD)</td>${priceRow}</tr>
            <tr><td class="compare-row-label">Monthly Est.</td>${moRow}</tr>
        </tbody>
    </table>
    </div>`;
}

function buildCompareRow(label, displayVals, numericVals, higherIsBetter) {
    const validNums = numericVals.filter(v => v !== null && v !== Infinity && !isNaN(v));
    if (validNums.length < 2) {
        return numericVals.map((_, i) => `<td class="compare-val">${esc(String(displayVals[i]))}</td>`).join('');
    }
    const best  = higherIsBetter ? Math.max(...validNums) : Math.min(...validNums);
    const worst = higherIsBetter ? Math.min(...validNums) : Math.max(...validNums);
    return numericVals.map((val, i) => {
        let cls = 'compare-val';
        if (val !== null && val !== Infinity && !isNaN(val)) {
            if (val === best && best !== worst) cls += ' compare-val-best';
            else if (val === worst && best !== worst) cls += ' compare-val-worst';
        }
        return `<td class="${cls}">${esc(String(displayVals[i]))}</td>`;
    }).join('');
}

function hexToRgb(hex) {
    if (typeof hex !== 'string') return '144, 164, 174';
    const raw = hex.replace('#', '');
    // Expand shorthand (#abc → aabbcc)
    const full = raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw;
    if (full.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(full)) return '144, 164, 174';
    return `${parseInt(full.substring(0, 2), 16)}, ${parseInt(full.substring(2, 4), 16)}, ${parseInt(full.substring(4, 6), 16)}`;
}
