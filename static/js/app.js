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
    modalOverlay: $('#modalOverlay'),
    modalClose: $('#modalClose'),
    modalHeader: $('#modalHeader'),
    modalBody: $('#modalBody'),
    statEc2Count: $('#statEc2Count'),
    statEc2Families: $('#statEc2Families'),
    statRdsCount: $('#statRdsCount'),
    statRdsEngines: $('#statRdsEngines'),
};

// ─── Initialize ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

function init() {
    createParticles();
    setupNavScrollEffect();
    setupTabs();
    setupFilters();
    setupSearch();
    setupModal();
    loadStaticData();
}

// ─── Background Particles ────────────────────────────────────
function createParticles() {
    const colors = ['#FF9900', '#3b82f6', '#8b5cf6', '#10b981', '#ec4899'];
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
            $$('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            $$('.tab-content').forEach(c => c.classList.remove('active'));
            $(`#${tab}Content`).classList.add('active');
            if (tab === 'engines') {
                els.filterChips.style.display = 'none';
            } else {
                els.filterChips.style.display = 'flex';
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
            $$('.chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            applyFilters();
        });
    });
}

function applyFilters() {
    const grid = state.activeTab === 'ec2' ? els.ec2Grid : els.rdsGrid;
    const cards = grid.querySelectorAll('.family-card');
    cards.forEach(card => {
        const category = card.dataset.category;
        const familyName = card.dataset.familyName || '';
        const matchesFilter = state.activeFilter === 'all' ||
            category === CATEGORY_FILTER_MAP[state.activeFilter];
        const matchesSearch = !state.searchQuery ||
            familyName.toLowerCase().includes(state.searchQuery) ||
            category.toLowerCase().includes(state.searchQuery) ||
            card.textContent.toLowerCase().includes(state.searchQuery);
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
            applyFilters();
        }, 200);
    });
}

// ─── Modal ───────────────────────────────────────────────────
function setupModal() {
    els.modalClose.addEventListener('click', closeModal);
    els.modalOverlay.addEventListener('click', (e) => {
        if (e.target === els.modalOverlay) closeModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });
}

function closeModal() {
    els.modalOverlay.classList.add('hidden');
    document.body.style.overflow = '';
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

        // Render everything
        updateStats();
        renderEc2Families();
        renderRdsFamilies();
        renderEngines();

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
    if (type === 'ec2') {
        const rows = instances.slice(0, 50).map((inst, i) => {
            const costHtml = inst.price_hourly ? `<span class="price-val">$${inst.price_hourly.toFixed(3)}/hr<br><span style="font-size:10px; opacity:0.7">~$${(inst.price_hourly * 730).toFixed(2)}/mo</span></span>` : '—';
            const winCostHtml = inst.price_hourly_windows ? `<span class="price-val">$${inst.price_hourly_windows.toFixed(3)}/hr<br><span style="font-size:10px; opacity:0.7">~$${(inst.price_hourly_windows * 730).toFixed(2)}/mo</span></span>` : '—';
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
            </tr>
        `}).join('');
        tableHtml = `<table class="instances-table"><thead><tr>
            <th>Instance Type</th><th>vCPUs</th><th>Memory</th><th>Network</th><th>Burstable</th><th>Linux Cost (OD)</th><th>Windows Cost (OD)</th>
        </tr></thead><tbody>${rows}</tbody></table>`;
    } else {
        const rows = instances.slice(0, 50).map((inst, i) => {
            const costHtml = inst.price_hourly ? `<span class="price-val">$${inst.price_hourly.toFixed(3)}/hr<br><span style="font-size:10px; opacity:0.7">~$${(inst.price_hourly * 730).toFixed(2)}/mo</span></span>` : '—';
            return `
            <tr style="animation-delay: ${i * 0.02}s">
                <td>${esc(inst.dbInstanceClass)}</td>
                <td>${inst.engine.split(', ').map(e => `<span class="engine-tag" style="margin:2px">${esc(e)}</span>`).join('')}</td>
                <td>${costHtml}</td>
            </tr>
        `}).join('');
        tableHtml = `<table class="instances-table"><thead><tr>
            <th>DB Instance Class</th><th>Supported Engines</th><th>MySQL Cost (Single-AZ)</th>
        </tr></thead><tbody>${rows}</tbody></table>`;
    }

    return `
        <div class="family-card stagger-${Math.min(idx + 1, 17)}" 
             data-category="${esc(category)}" data-family-name="${esc(familyName)}" data-family-key="${esc(key)}">
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
                    <button class="instances-toggle">
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
        return `
            <div class="engine-card stagger-${Math.min(idx + 1, 17)}">
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
    list.classList.toggle('expanded', isExpanded);
}

// ─── Helpers ─────────────────────────────────────────────────
function esc(str) {
    if (typeof str !== 'string') return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return `${parseInt(h.substring(0, 2), 16)}, ${parseInt(h.substring(2, 4), 16)}, ${parseInt(h.substring(4, 6), 16)}`;
}
