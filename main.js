/* Project Dash — Supabase (RLS OFF, DB-key aware, truncated-column safe) */

/* ---------- Supabase ---------- */
const SUPABASE_URL = window.SUPABASE_URL || "https://tvxzvawzqlxkdlctgges.supabase.co";
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2eHp2YXd6cWx4a2RsY3RnZ2VzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0NDMwNjcsImV4cCI6MjA3NDAxOTA2N30.0pitJMrKxP76za6ml7PyrIRJ5oKvaf-nEtjCAvJMTwU";
if (!window.supabase) console.error("Supabase JS not loaded.");
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------- Chart.js ---------- */
if (window.Chart && window.ChartDataLabels) Chart.register(window.ChartDataLabels);

/* ---------- DOM refs ---------- */
/* Passcode */
const passcodeModal   = document.getElementById('passcodeModal');
const passcodeInput   = document.getElementById('editPasscodeInput');
const passcodeError   = document.getElementById('editPasscodeError');
const passcodeCancel  = document.getElementById('passcodeCancel');
const passcodeUnlock  = document.getElementById('passcodeUnlock');

const EDIT_PASSCODE     = (window.EDIT_PASSCODE || 'EIOC2025');
const EDIT_SESSION_KEY  = 'editUnlocked'; // sessionStorage flag

const totalElem         = document.getElementById('totalRegistrations');
const prevTotalElem     = document.getElementById('prevTotalRegistrations');
const abstractElem      = document.getElementById('abstractSubmissions');
const countriesElem     = document.getElementById('participatingCountries');
const prevCountriesElem = document.getElementById('prevParticipatingCountries');

const categoryChartEl = document.getElementById('categoryChart');
const uaeChartEl      = document.getElementById('uaeChart');
const regionalChartEl = document.getElementById('regionalChart');
const sessionsBody    = document.getElementById('dashboardSessionsBody');

/* Edit modal */
const menuBtn         = document.getElementById('menuBtn');
const menuOptions     = document.getElementById('menuOptions');
const editBtnOverlay  = document.getElementById('editBtnOverlay');
const editModal       = document.getElementById('editModal');
const cancelEdit      = document.getElementById('cancelEdit');
const saveEdit        = document.getElementById('saveEdit');
const editSessionsBody= document.getElementById('editSessionsBody');

/* ---------- State ---------- */
let categoryChart, uaeChart, regionalChart;
let latestRowId = null;
let lastLoadedDashboard = null;

/* ---------- Hide this legacy session key (had a '/') ---------- */
const DEPRECATED_SESSION_KEYS = new Set([
  'day_1_-_breast_imaging_/_breast_surgical_session'
]);
const DEPRECATED_PREFIXES = [...DEPRECATED_SESSION_KEYS].map(k => `sessions_${k}_`);
const isDeprecatedSessionKey = (key) => DEPRECATED_SESSION_KEYS.has(key);
const isDeprecatedColumn = (col) => DEPRECATED_PREFIXES.some(pfx => col.startsWith(pfx));

/* ---------- Truncated field aliases (Postgres 63-char identifier limit) ---------- */
const FIELD_ALIAS = {
  previou: 'previous',  // your SB column ends with _previou
  targe:   'target',
  curre:   'current',
  uniqu:   'unique',
  oncol:   'oncologist',
  defic:   'deficit'
};

/* Map payload column name to an existing table column (handles _previous → _previou, and 63-char truncation) */
function mapToExistingColumnSmart(col, allowedSet) {
  if (allowedSet.has(col)) return col;

  // Specific fix for "_previous" → "_previou"
  if (col.endsWith('_previous')) {
    const alt = col.slice(0, -'_previous'.length) + '_previou';
    if (allowedSet.has(alt)) return alt;
  }

  // Generic: try 63-char hard truncate
  if (col.length > 63) {
    const truncated = col.slice(0, 63);
    if (allowedSet.has(truncated)) return truncated;
  }
  return null;
}

/* ---------- Utils ---------- */
function showPasscodeModal() {
  passcodeError?.classList.add('hidden');
  if (passcodeInput) passcodeInput.value = '';
  passcodeModal?.classList.remove('hidden');
  setTimeout(() => passcodeInput?.focus(), 0);
}
function hidePasscodeModal() { passcodeModal?.classList.add('hidden'); }
function isUnlocked() { return sessionStorage.getItem(EDIT_SESSION_KEY) === '1'; }
function unlock() { sessionStorage.setItem(EDIT_SESSION_KEY, '1'); }
function $(id){ return document.getElementById(id); }
function toInt(v){ const n = parseInt(v ?? "0", 10); return Number.isFinite(n) ? n : 0; }
function titleizeKey(dbKey){
  return (dbKey||"")
    .split("_")
    .map(tok => tok.length <= 2 ? tok.toUpperCase() : (tok[0].toUpperCase() + tok.slice(1)))
    .join(" ");
}

/* ---------- Charts ---------- */
function ensureCategoryChart(values) {
  if (!categoryChart) {
    categoryChart = new Chart(categoryChartEl, {
      type: 'doughnut',
      data: { labels: ['Doctors', 'Nurses', 'Allied HCP'], datasets: [{ data: values }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: { position: 'bottom' },
          datalabels: {
            formatter: v => v,
            anchor: 'center',
            align: 'center',
            font: { weight: 'bold' },
            color: '#fff'
          }
        }
      }
    });
  } else {
    categoryChart.data.datasets[0].data = values;
    categoryChart.options.plugins.datalabels.color = '#fff';
    categoryChart.update();
  }
}

function ensureUAEChart(prev, current) {
  const prevTotal = (prev || []).reduce((a, b) => a + (Number(b) || 0), 0);
  const currTotal = (current || []).reduce((a, b) => a + (Number(b) || 0), 0);

  const uaeHeader = uaeChartEl.closest('section')?.querySelector('h2');
  if (uaeHeader) {
    uaeHeader.innerHTML = `UAE Delegates total — <span class="text-indigo-700 font-bold">${currTotal.toLocaleString()}</span>`;
  }

  const cfg = {
    type: 'bar',
    data: {
      labels: ['Dxb-Shj', 'Abu Dhabi-Al Ain', 'Other Emirates'],
      datasets: [
        { label: 'Previous', data: prev, backgroundColor: '#a5b4fc', datalabels: { color: '#fff' } },
        { label: 'Current',  data: current, backgroundColor: '#1d4ed8', datalabels: { color: '#fff' } }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 10, right: 24 } },
      scales: { y: { beginAtZero: true } },
      plugins: {
        datalabels: { formatter: v => (v ?? 0), anchor: 'center', align: 'center', font: { weight: 'bold' } },
        title: { display: true, align: 'end', padding: { top: 4, bottom: 8 }, font: { size: 16, weight: 'bold' } },
        legend: { position: 'right', align: 'center', labels: { boxWidth: 14, font: { size: 14, weight: 'bold' } } }
      }
    }
  };

  if (!uaeChart) uaeChart = new Chart(uaeChartEl, cfg);
  else { uaeChart.data = cfg.data; uaeChart.options = cfg.options; uaeChart.update(); }
}

function ensureRegionalChart(prev, current) {
  const prevTotal = (prev || []).reduce((a, b) => a + (Number(b) || 0), 0);
  const currTotal = (current || []).reduce((a, b) => a + (Number(b) || 0), 0);

  const regionalHeader = regionalChartEl.closest('section')?.querySelector('h2');
  if (regionalHeader) {
    regionalHeader.innerHTML = `Regional and International Delegates — <span class="text-indigo-700 font-bold">${currTotal.toLocaleString()}</span>`;
  }

  const cfg = {
    type: 'bar',
    data: {
      labels: ['Regional', 'APAC', 'International'],
      datasets: [
        { label: 'Previous', data: prev,    backgroundColor: '#a5b4fc', datalabels: { color: '#fff' } },
        { label: 'Current',  data: current, backgroundColor: '#1d4ed8', datalabels: { color: '#fff' } }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 10, right: 24 } },
      scales: { y: { beginAtZero: true } },
      plugins: {
        datalabels: { formatter: v => (v ?? 0), anchor: 'center', align: 'center', font: { weight: 'bold' } },
        title: { display: true, align: 'end', padding: { top: 4, bottom: 8 }, font: { size: 16, weight: 'bold' } },
        legend: { position: 'right', align: 'center', labels: { boxWidth: 14, font: { size: 14, weight: 'bold' } } }
      }
    }
  };

  if (!regionalChart) regionalChart = new Chart(regionalChartEl, cfg);
  else { regionalChart.data = cfg.data; regionalChart.options = cfg.options; regionalChart.update(); }
}

/* ---------- Row -> Dashboard shape ---------- */
function rowToDashboard(row) {
  const out = { summary: {}, category: {}, uae: {}, uaePrev: {}, regional: {}, regionalPrev: {}, sessions: [] };

  for (const k in row) if (k.startsWith('summary_'))  out.summary[k.replace('summary_', '')] = row[k];
  for (const k in row) if (k.startsWith('category_')) out.category[k.replace('category_', '')] = row[k];

  for (const k in row) {
    if (k.startsWith('uae_current_'))  out.uae[k.replace('uae_current_', '')]     = row[k];
    if (k.startsWith('uae_previous_')) out.uaePrev[k.replace('uae_previous_', '')]= row[k];
  }
  for (const k in row) {
    if (k.startsWith('regional_current_'))  out.regional[k.replace('regional_current_', '')]      = row[k];
    if (k.startsWith('regional_previous_')) out.regionalPrev[k.replace('regional_previous_', '')] = row[k];
  }

  // sessions_<dbKey>_<field> (dbKey may include '-', '/', '&'), handle truncated field suffix
  const sessionsMap = {};
  for (const k in row) if (k.startsWith('sessions_')) {
    const lastUnderscore = k.lastIndexOf('_');
    if (lastUnderscore <= 'sessions_'.length) continue;
    const fieldRaw = k.slice(lastUnderscore + 1);                   // might be 'previou'
    const field    = FIELD_ALIAS[fieldRaw] || fieldRaw;             // normalize to 'previous'
    const dbKey    = k.slice('sessions_'.length, lastUnderscore);   // exact DB key
    if (isDeprecatedSessionKey(dbKey)) continue;
    if (!sessionsMap[dbKey]) sessionsMap[dbKey] = { key: dbKey, name: titleizeKey(dbKey) };
    sessionsMap[dbKey][field] = row[k];
  }
  out.sessions = Object.values(sessionsMap);

  return out;
}

/* ---------- Populate UI ---------- */
function populateDashboard(d) {
  const { summary, category, uae, uaePrev, regional, regionalPrev, sessions } = d;

  if (totalElem)        totalElem.textContent        = summary.total_registration ?? 0;
  if (prevTotalElem)    prevTotalElem.textContent    = `Previous: ${summary.previous_registration ?? 0}`;
  if (abstractElem)     abstractElem.textContent     = summary.abstract_sub ?? 0;
  if (countriesElem)    countriesElem.textContent    = summary.participating_countries ?? 0;
  if (prevCountriesElem)prevCountriesElem.textContent= `Previous: ${summary.previous_countries ?? 0}`;

  ensureCategoryChart([ category.doctors ?? 0, category.nurses ?? 0, category.allied_hcp ?? 0 ]);

  if (sessionsBody) {
    sessionsBody.innerHTML = '';
    (sessions || []).forEach(s => {
      const target = Number(s.target) || 0;
      const unique = Number(s.unique) || 0;
      const computedDef = target - unique;
      const defClass =
        computedDef < 0 ? 'text-green-600 font-semibold'
        : computedDef > 0 ? 'text-red-600 font-semibold'
        : 'text-gray-600';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="border px-2 py-1 text-left">${s.name || ''}</td>
        <td class="border px-2 py-1">${target}</td>
        <td class="border px-2 py-1">${s.previous ?? 0}</td>
        <td class="border px-2 py-1">${s.current ?? 0}</td>
        <td class="border px-2 py-1">${unique}</td>
        <td class="border px-2 py-1 ${defClass}">${computedDef}</td>
      `;
      sessionsBody.appendChild(tr);
    });
  }

  ensureUAEChart(
    [uaePrev.dxb_shj ?? 0, uaePrev.abu_dhabi_al_ain ?? 0, uaePrev.other_emirates ?? 0],
    [uae.dxb_shj ?? 0, uae.abu_dhabi_al_ain ?? 0, uae.other_emirates ?? 0]
  );
  ensureRegionalChart(
    [regionalPrev.regional ?? 0, regionalPrev.apac ?? 0, regionalPrev.international ?? 0],
    [regional.regional ?? 0, regional.apac ?? 0, regional.international ?? 0]
  );
}

/* ---------- Edit modal ---------- */
function renderSessionsEditor(sessions) {
  const ordered = (sessions || []).slice().sort((a,b) => (a.key || '').localeCompare(b.key || ''));
  editSessionsBody.innerHTML = '';

  for (const s of ordered) {
    const key = s.key; // exact DB key
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="p-1">${s.name || ''}</td>
      <td class="p-1"><input id="session-${key}-target"      type="number" class="w-24 border p-1 rounded" value="${s.target ?? 0}"></td>
      <td class="p-1"><input id="session-${key}-previous"    type="number" class="w-24 border p-1 rounded" value="${s.previous ?? 0}"></td>
      <td class="p-1"><input id="session-${key}-current"     type="number" class="w-24 border p-1 rounded" value="${s.current ?? 0}"></td>
      <td class="p-1"><input id="session-${key}-unique"      type="number" class="w-24 border p-1 rounded" value="${s.unique ?? 0}"></td>
      <td class="p-1"><input id="session-${key}-oncologist"  type="number" class="w-24 border p-1 rounded" value="${s.oncologist ?? 0}"></td>
      <td class="p-1"><input id="session-${key}-deficit"     type="number" class="w-24 border p-1 rounded" value="${s.deficit ?? ( (Number(s.target)||0) - (Number(s.unique)||0) )}"></td>
    `;
    editSessionsBody.appendChild(tr);
  }
}

function prefillEditModal(d){
  $('editTotal').value         = d?.summary?.total_registration ?? 0;
  $('editPrevTotal').value     = d?.summary?.previous_registration ?? 0;
  $('editAbstract').value      = d?.summary?.abstract_sub ?? 0;
  $('editPrevAbstract').value  = d?.summary?.previous_abstract ?? 0;
  $('editCountries').value     = d?.summary?.participating_countries ?? 0;
  $('editPrevCountries').value = d?.summary?.previous_countries ?? 0;
  $('editOral').value          = d?.summary?.oral ?? 0;
  $('editEPoster').value       = d?.summary?.e_poster ?? 0;

  $('editUAE1').value = d?.uae?.dxb_shj ?? 0;
  $('editUAE2').value = d?.uae?.abu_dhabi_al_ain ?? 0;
  $('editUAE3').value = d?.uae?.other_emirates ?? 0;
  $('editPrevUAE1').value = d?.uaePrev?.dxb_shj ?? 0;
  $('editPrevUAE2').value = d?.uaePrev?.abu_dhabi_al_ain ?? 0;
  $('editPrevUAE3').value = d?.uaePrev?.other_emirates ?? 0;

  $('editRegional').value      = d?.regional?.regional ?? 0;
  $('editAPAC').value          = d?.regional?.apac ?? 0;
  $('editInternational').value = d?.regional?.international ?? 0;
  $('editPrevRegional').value  = d?.regionalPrev?.regional ?? 0;
  $('editPrevAPAC').value      = d?.regionalPrev?.apac ?? 0;
  $('editPrevInternational').value = d?.regionalPrev?.international ?? 0;

  const cats = document.querySelectorAll('#editCategoryTable .category-input');
  if (cats[0]) cats[0].value = d?.category?.doctors ?? 0;
  if (cats[1]) cats[1].value = d?.category?.nurses ?? 0;
  if (cats[2]) cats[2].value = d?.category?.allied_hcp ?? 0;

  renderSessionsEditor(d?.sessions || []);
}

/* ---------- Build update row from inputs ---------- */
function buildRowFromInputs(){
  const cats = document.querySelectorAll('#editCategoryTable .category-input');
  const row = {
    summary_total_registration:       toInt($('editTotal').value),
    summary_previous_registration:    toInt($('editPrevTotal').value),
    summary_abstract_sub:             toInt($('editAbstract').value),
    summary_previous_abstract:        toInt($('editPrevAbstract').value),
    summary_participating_countries:  toInt($('editCountries').value),
    summary_previous_countries:       toInt($('editPrevCountries').value),
    summary_oral:                     toInt($('editOral').value),
    summary_e_poster:                 toInt($('editEPoster').value),

    category_doctors:     cats[0] ? toInt(cats[0].value) : 0,
    category_nurses:      cats[1] ? toInt(cats[1].value) : 0,
    category_allied_hcp:  cats[2] ? toInt(cats[2].value) : 0,

    uae_current_dxb_shj:            toInt($('editUAE1').value),
    uae_current_abu_dhabi_al_ain:   toInt($('editUAE2').value),
    uae_current_other_emirates:     toInt($('editUAE3').value),

    uae_previous_dxb_shj:           toInt($('editPrevUAE1').value),
    uae_previous_abu_dhabi_al_ain:  toInt($('editPrevUAE2').value),
    uae_previous_other_emirates:    toInt($('editPrevUAE3').value),

    regional_current_regional:        toInt($('editRegional').value),
    regional_current_apac:            toInt($('editAPAC').value),
    regional_current_international:   toInt($('editInternational').value),

    regional_previous_regional:       toInt($('editPrevRegional').value),
    regional_previous_apac:           toInt($('editPrevAPAC').value),
    regional_previous_international:  toInt($('editPrevInternational').value)
  };

  // Sessions (ids carry exact DB key)
  const inputs = editSessionsBody.querySelectorAll('input[id^="session-"]');
  const keys = new Set();
  inputs.forEach(inp => {
    const m = inp.id.match(/^session-(.+)-(target|previous|current|unique|oncologist|deficit)$/);
    if (!m) return;
    const dbKey = m[1];
    if (isDeprecatedSessionKey(dbKey)) return; // skip legacy
    const field = m[2];
    keys.add(dbKey);
    row[`sessions_${dbKey}_${field}`] = toInt(inp.value);
  });

  // Auto-calc deficit = target - unique (preferred)
  keys.forEach(k => {
    const t = row[`sessions_${k}_target`];
    const u = row[`sessions_${k}_unique`];
    const hasDef = Number.isFinite(row[`sessions_${k}_deficit`]);
    if (!hasDef && Number.isFinite(t) && Number.isFinite(u)) {
      row[`sessions_${k}_deficit`] = t - u;
    }
  });

  return row;
}

/* ---------- Save (only existing, non-deprecated columns; map truncated names) ---------- */
async function saveToSupabase() {
  if (!latestRowId) {
    alert('No row to update. Insert one row in Supabase first.');
    return;
  }

  const row = buildRowFromInputs();

  // Re-fetch latest row to get current column list
  const { data: fresh, error: freshErr } = await supabaseClient
    .from('DashboardData')
    .select('*')
    .eq('id', latestRowId)
    .single();
  if (freshErr) {
    console.error('Schema refresh failed:', freshErr);
    alert('Could not refresh schema before saving. See console.');
    return;
  }

  const allowed = new Set(
    Object.keys(fresh || {}).filter(k => k !== 'id' && k !== 'created_at' && !isDeprecatedColumn(k))
  );

  const safeRow = {};
  const ignored = [];
  for (const [k, v] of Object.entries(row)) {
    if (isDeprecatedColumn(k)) continue;
    const mapped = mapToExistingColumnSmart(k, allowed);
    if (mapped) {
      safeRow[mapped] = (typeof v === 'number' && Number.isNaN(v)) ? null : v;
    } else {
      ignored.push(k);
    }
  }
  if (ignored.length) console.warn('Ignored (no DB column match):', ignored);
  if (Object.keys(safeRow).length === 0) {
    alert('No matching columns to update. Hard refresh and try again.');
    return;
  }

  const { error, status } = await supabaseClient
    .from('DashboardData')
    .update(safeRow)
    .eq('id', latestRowId);

  if (error) {
    const msg = error.message || error.details || error.hint || JSON.stringify(error);
    console.error('UPDATE failed:', { status, error, safeRow });
    alert('Update failed: ' + msg + '\n\nIf RLS is OFF, ensure:\n' +
      '• GRANT USAGE ON SCHEMA public TO anon;\n' +
      '• GRANT SELECT, UPDATE ON public."DashboardData" TO anon;');
    return;
  }

  await loadData();
  editModal?.classList.add('hidden');
}

/* ---------- Load & wire ---------- */
async function fetchLatestRow() {
  let { data, error } = await supabaseClient
    .from('DashboardData')
    .select('*')
    .order('id', { ascending: false })
    .limit(1);

  if (error) {
    ({ data, error } = await supabaseClient
      .from('DashboardData')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1));
  }
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('No rows found in DashboardData');
  return data[0];
}

async function loadData() {
  try {
    const row = await fetchLatestRow();
    latestRowId = row.id ?? null;
    lastLoadedDashboard = rowToDashboard(row);
    populateDashboard(lastLoadedDashboard);
  } catch (err) {
    console.error('Failed to load from Supabase:', err);
    alert('Unable to fetch data from Supabase. Check console/network.');
  }
}

/* Menu + modal */
if (menuBtn && menuOptions) menuBtn.addEventListener('click', () => menuOptions.classList.toggle('hidden'));

function openEditor() {
  prefillEditModal(lastLoadedDashboard);
  editModal?.classList.remove('hidden');
}

if (editBtnOverlay && editModal) {
  editBtnOverlay.addEventListener('click', () => {
    // If the passcode UI is missing, open editor directly
    if (!passcodeModal || !passcodeInput || !passcodeUnlock) {
      console.warn('Passcode modal not found — opening editor without passcode.');
      openEditor();
      return;
    }
    if (isUnlocked()) {
      openEditor();
    } else {
      showPasscodeModal();
    }
  });
}

if (cancelEdit && editModal) cancelEdit.addEventListener('click', () => editModal.classList.add('hidden'));

if (saveEdit && editModal) {
  saveEdit.addEventListener('click', async () => {
    if (!isUnlocked()) {
      if (!passcodeModal || !passcodeInput || !passcodeUnlock) {
        console.warn('Passcode modal not found — saving without passcode.');
      } else {
        showPasscodeModal();
        return;
      }
    }
    try {
      await saveToSupabase();
      editModal.classList.add('hidden');
      await loadData();
    } catch (_) {}
  });
}


/* Passcode modal events */
if (passcodeCancel) passcodeCancel.addEventListener('click', hidePasscodeModal);

async function tryUnlockAndOpenEditor() {
  const typed = (passcodeInput?.value || '').trim();
  if (!typed || typed !== EDIT_PASSCODE) {
    passcodeError?.classList.remove('hidden');
    return;
  }
  unlock();
  hidePasscodeModal();
  openEditor();
}
if (passcodeUnlock) passcodeUnlock.addEventListener('click', tryUnlockAndOpenEditor);
if (passcodeInput) passcodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') tryUnlockAndOpenEditor();
});

window.addEventListener('DOMContentLoaded', loadData);
