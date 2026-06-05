// ── Team config ─────────────────────────────────────────────
const TEAMS = [
  { key: 'banquets',  label: 'Banquets'    },
  { key: 'av',        label: 'Audio Visual' },
  { key: 'speakers',  label: 'Speakers'    },
  { key: 'content',   label: 'Content'     },
  { key: 'equipment', label: 'Equipment'   },
];

// ── State ────────────────────────────────────────────────────
// currentUser is declared in auth.js (loaded first)
let events         = [];
let currentEventId = null;
let sessions       = [];
let activeView     = 'table';
let activeFilters  = new Set(['all']);
let editingId      = null;
let sharingEventId = null;
let nameDebounce   = null;

// ── Helpers ──────────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function formatDuration(min) {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatEventDate(d) {
  if (!d) return '';
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch { return d; }
}

function getActiveTeamsForSession(s) {
  return TEAMS.filter(t => s.notes[t.key]?.trim());
}

function primaryTeam(s) {
  const first = getActiveTeamsForSession(s)[0];
  return first ? first.key : 'none';
}

function teamBadgeHTML(teamKey, label) {
  return `<span class="team-badge badge-${teamKey}">${esc(label)}</span>`;
}

function sortedSessions() {
  return [...sessions].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
}

function filteredSessions() {
  if (activeFilters.has('all')) return sortedSessions();
  return sortedSessions().filter(s =>
    TEAMS.some(t => activeFilters.has(t.key) && s.notes[t.key]?.trim())
  );
}

// ── Screen switching ─────────────────────────────────────────
// Called by auth.js after a successful sign-in.
async function initHomeScreen() {
  showLoading(); // defined in auth.js
  try {
    events = await loadEventsFromDB();
  } catch (err) {
    console.error('Failed to load events:', err);
    events = [];
  }
  hideLoading();
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('schedule-screen').classList.add('hidden');
  document.getElementById('home-screen').classList.remove('hidden');
  renderHome();
  refreshSessionCounts().catch(console.error);
}

function showHome() {
  currentEventId = null;
  sessions = [];
  document.getElementById('schedule-screen').classList.add('hidden');
  document.getElementById('home-screen').classList.remove('hidden');
  renderHome();
}

async function openEvent(eventId) {
  showLoading();
  currentEventId = eventId;
  try {
    sessions = await loadSessionsFromDB(eventId);
  } catch (err) {
    console.error('Failed to load sessions:', err);
    sessions = [];
  }
  hideLoading();

  const evt     = events.find(e => e.id === eventId);
  const canEdit = evt?.isOwner || evt?.sharedPermission === 'edit';

  document.getElementById('event-name').value    = evt?.name ?? '';
  document.getElementById('event-name').readOnly = !canEdit;
  document.getElementById('add-session-btn').classList.toggle('hidden', !canEdit);
  document.getElementById('import-csv-btn').classList.toggle('hidden', !canEdit);

  document.getElementById('home-screen').classList.add('hidden');
  document.getElementById('schedule-screen').classList.remove('hidden');

  activeView    = 'table';
  activeFilters = new Set(['all']);
  document.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'table'));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'table-view'));
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.team === 'all'));
  render();
}

// ── DB: events ───────────────────────────────────────────────
async function loadEventsFromDB() {
  // Owned events — this failing is fatal; rethrow so the caller can handle it.
  const { data: owned, error: e1 } = await supabaseClient
    .from('events').select('*').eq('owner_id', currentUser.id)
    .order('created_at', { ascending: true });
  if (e1) {
    console.error('[loadEventsFromDB] owned query failed:', e1.message, e1.code);
    throw e1;
  }

  // Shared events — isolated: a failure here never hides owned events.
  let sharedEvents = [];
  try {
    const { data: shares, error: e2 } = await supabaseClient
      .from('event_shares').select('event_id, permission')
      .eq('shared_with_email', currentUser.email);

    if (!e2 && shares?.length) {
      const ids = shares.map(s => s.event_id);
      const { data: shared, error: e3 } = await supabaseClient
        .from('events').select('*').in('id', ids)
        .order('created_at', { ascending: true });
      if (!e3) {
        const permMap = Object.fromEntries(shares.map(s => [s.event_id, s.permission]));
        sharedEvents = (shared || []).map(ev => ({
          ...ev, isOwner: false, sharedPermission: permMap[ev.id],
        }));
      }
    }
  } catch (err) {
    console.warn('[loadEventsFromDB] shared-events query failed (non-fatal):', err.message);
  }

  console.log(`[loadEventsFromDB] loaded ${owned?.length ?? 0} owned, ${sharedEvents.length} shared`);
  return [
    ...(owned || []).map(ev => ({ ...ev, isOwner: true })),
    ...sharedEvents,
  ];
}

async function createEventInDB(name, date, type) {
  const { data, error } = await supabaseClient
    .from('events')
    .insert({ owner_id: currentUser.id, name, date: date || null, type: type || null })
    .select().single();

  if (error) {
    console.error('[createEventInDB]', error.code, error.message, error.hint ?? '');
    throw error;
  }
  return { ...data, isOwner: true };
}

async function updateEventNameInDB(id, name) {
  const { error } = await supabaseClient.from('events').update({ name }).eq('id', id);
  if (error) throw error;
}

async function deleteEventFromDB(id) {
  const { error } = await supabaseClient.from('events').delete().eq('id', id);
  if (error) throw error;
}

// ── DB: sessions ─────────────────────────────────────────────
async function loadSessionsFromDB(eventId) {
  const { data, error } = await supabaseClient
    .from('sessions').select('*').eq('event_id', eventId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(s => ({
    id: s.id, title: s.title, startTime: s.start_time,
    duration: s.duration, location: s.location || '', notes: s.notes || {},
  }));
}

async function insertSessionInDB(eventId, session) {
  const { data, error } = await supabaseClient
    .from('sessions')
    .insert({
      event_id: eventId, title: session.title, start_time: session.startTime,
      duration: session.duration, location: session.location, notes: session.notes,
    })
    .select().single();
  if (error) throw error;
  return data.id;
}

async function updateSessionInDB(session) {
  const { error } = await supabaseClient
    .from('sessions')
    .update({
      title: session.title, start_time: session.startTime,
      duration: session.duration, location: session.location, notes: session.notes,
    })
    .eq('id', session.id);
  if (error) throw error;
}

async function deleteSessionFromDB(sessionId) {
  const { error } = await supabaseClient.from('sessions').delete().eq('id', sessionId);
  if (error) throw error;
}

// ── DB: shares ───────────────────────────────────────────────
async function loadSharesForEvent(eventId) {
  const { data, error } = await supabaseClient
    .from('event_shares').select('*').eq('event_id', eventId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function addShareInDB(eventId, email, permission) {
  const { error } = await supabaseClient
    .from('event_shares')
    .insert({ event_id: eventId, shared_with_email: email, permission, created_by: currentUser.id });
  if (error) throw error;
}

async function removeShareFromDB(shareId) {
  const { error } = await supabaseClient.from('event_shares').delete().eq('id', shareId);
  if (error) throw error;
}

// ── Home screen render ───────────────────────────────────────
function renderHome() {
  const grid  = document.getElementById('event-cards');
  const empty = document.getElementById('home-empty');

  if (!events.length) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  grid.innerHTML = events.map(evt => {
    const dateStr      = formatEventDate(evt.date);
    const sessionCount = evt._sessionCount ?? 0;
    const isOwner      = evt.isOwner !== false;

    const ownerActions = `
      <button class="icon-btn" data-action="share-event" data-event-id="${evt.id}" title="Share event">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="11" cy="2.5" r="1.5" stroke="currentColor" stroke-width="1.4"/><circle cx="11" cy="11.5" r="1.5" stroke="currentColor" stroke-width="1.4"/><circle cx="3" cy="7" r="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M4.4 6.3L9.6 3.2M4.4 7.7l5.2 3.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
      </button>
      <button class="icon-btn danger" data-action="delete-event" data-event-id="${evt.id}" title="Delete event">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4h10M5 4V2h4v2M5.5 6.5v4M8.5 6.5v4M3 4l.7 7.3A1 1 0 004.7 12h4.6a1 1 0 001-.7L11 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>`;

    const sharedBadge = !isOwner
      ? `<span class="shared-badge">${evt.sharedPermission === 'edit' ? 'Can edit' : 'View only'}</span>`
      : '';

    return `
      <div class="event-card" data-event-id="${evt.id}">
        <div class="event-card-name">${esc(evt.name)}</div>
        <div class="event-card-meta">
          ${evt.type ? `<span class="event-card-type">${esc(evt.type)}</span>` : ''}
          ${dateStr  ? `<div class="event-card-date">${dateStr}</div>` : ''}
        </div>
        <div class="event-card-footer">
          <span class="event-card-sessions">${sessionCount} session${sessionCount !== 1 ? 's' : ''}</span>
          <div class="event-card-actions">
            ${sharedBadge}
            ${isOwner ? ownerActions : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

async function refreshSessionCounts() {
  await Promise.all(events.map(async evt => {
    const { count, error } = await supabaseClient
      .from('sessions').select('*', { count: 'exact', head: true })
      .eq('event_id', evt.id);
    if (!error) evt._sessionCount = count ?? 0;
  }));
  renderHome();
}

// ── New event modal ──────────────────────────────────────────
function openNewEventModal() {
  document.getElementById('new-event-name').value = '';
  document.getElementById('new-event-date').value = '';
  document.getElementById('new-event-type').value = '';
  document.getElementById('new-event-error').classList.add('hidden');
  document.getElementById('new-event-overlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('new-event-name').focus(), 50);
}

function closeNewEventModal() {
  document.getElementById('new-event-overlay').classList.add('hidden');
}

async function createEvent() {
  const name = document.getElementById('new-event-name').value.trim();
  const date = document.getElementById('new-event-date').value;
  const type = document.getElementById('new-event-type').value;

  if (!name) {
    const err = document.getElementById('new-event-error');
    err.textContent = 'Event name is required.';
    err.classList.remove('hidden');
    return;
  }

  const btn = document.getElementById('new-event-save-btn');
  btn.disabled = true; btn.textContent = 'Creating…';

  try {
    const newEvent = await createEventInDB(name, date, type);
    newEvent._sessionCount = 0;
    events.push(newEvent);
    closeNewEventModal();
    await openEvent(newEvent.id);
  } catch (err) {
    console.error('[createEvent] caught:', err);
    const errEl = document.getElementById('new-event-error');
    errEl.textContent = err?.message || 'Failed to create event. Please try again.';
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'Create event';
  }
}

// ── Share modal ──────────────────────────────────────────────
async function openShareModal(eventId) {
  sharingEventId = eventId;
  document.getElementById('share-email').value = '';
  document.getElementById('share-permission').value = 'view';
  document.getElementById('share-error').classList.add('hidden');
  document.getElementById('share-list').innerHTML = '<div class="share-loading">Loading…</div>';
  document.getElementById('share-overlay').classList.remove('hidden');

  try {
    const shares = await loadSharesForEvent(eventId);
    renderShareList(shares);
  } catch {
    document.getElementById('share-list').innerHTML = '<div class="share-loading">Failed to load.</div>';
  }
}

function closeShareModal() {
  document.getElementById('share-overlay').classList.add('hidden');
  sharingEventId = null;
}

function renderShareList(shares) {
  const el = document.getElementById('share-list');
  if (!shares.length) {
    el.innerHTML = '<p class="share-empty">Not shared with anyone yet.</p>';
    return;
  }
  el.innerHTML = shares.map(s => `
    <div class="share-item">
      <div class="share-item-info">
        <span class="share-item-email">${esc(s.shared_with_email)}</span>
        <span class="share-perm-badge ${s.permission === 'edit' ? 'badge-edit' : 'badge-view'}">
          ${s.permission === 'edit' ? 'Can edit' : 'View only'}
        </span>
      </div>
      <button class="icon-btn danger" data-action="remove-share" data-share-id="${s.id}" title="Remove">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>`).join('');
}

async function submitShare() {
  if (!sharingEventId) return;
  const email      = document.getElementById('share-email').value.trim().toLowerCase();
  const permission = document.getElementById('share-permission').value;
  const errEl      = document.getElementById('share-error');
  errEl.classList.add('hidden');

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errEl.textContent = 'Please enter a valid email address.';
    errEl.classList.remove('hidden');
    return;
  }
  if (email === currentUser.email) {
    errEl.textContent = 'You cannot share an event with yourself.';
    errEl.classList.remove('hidden');
    return;
  }

  const btn = document.getElementById('share-save-btn');
  btn.disabled = true; btn.textContent = 'Sharing…';

  try {
    await addShareInDB(sharingEventId, email, permission);
    document.getElementById('share-email').value = '';
    const shares = await loadSharesForEvent(sharingEventId);
    renderShareList(shares);
  } catch (err) {
    errEl.textContent = err.message?.includes('unique') ? 'Already shared with this person.' : 'Failed to share. Please try again.';
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'Share';
  }
}

// ── Render: Table view ───────────────────────────────────────
function renderTable() {
  const tbody = document.getElementById('table-body');
  const empty = document.getElementById('table-empty');
  const list  = filteredSessions();

  if (!list.length) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const evt     = events.find(e => e.id === currentEventId);
  const canEdit = evt?.isOwner || evt?.sharedPermission === 'edit';

  tbody.innerHTML = list.map(s => {
    const teamNotes = getActiveTeamsForSession(s);
    const notesHTML = teamNotes.length
      ? teamNotes.map(t => `
          <div class="team-note-item">
            ${teamBadgeHTML(t.key, t.label)}
            <span class="team-note-text">${esc(s.notes[t.key])}</span>
          </div>`).join('')
      : '<span style="color:var(--subtle);font-size:13px">-</span>';

    const actionBtns = canEdit ? `
      <div class="actions-group">
        <button class="icon-btn" data-action="edit" data-id="${s.id}" title="Edit session">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
        </button>
        <button class="icon-btn danger" data-action="delete" data-id="${s.id}" title="Delete session">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4h10M5 4V2h4v2M5.5 6.5v4M8.5 6.5v4M3 4l.7 7.3A1 1 0 004.7 12h4.6a1 1 0 001-.7L11 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>` : '';

    return `
      <tr>
        <td class="td-time">${esc(s.startTime)}</td>
        <td class="td-duration">${formatDuration(s.duration)}</td>
        <td class="td-title">${esc(s.title)}</td>
        <td class="td-location">${esc(s.location) || '<span style="color:var(--subtle)">-</span>'}</td>
        <td><div class="team-note-list">${notesHTML}</div></td>
        <td class="td-actions">${actionBtns}</td>
      </tr>`;
  }).join('');
}

// ── Render: Timeline view ────────────────────────────────────
function renderTimeline() {
  const container = document.getElementById('timeline-container');
  const empty     = document.getElementById('timeline-empty');
  const list      = filteredSessions();

  if (!list.length) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const evt     = events.find(e => e.id === currentEventId);
  const canEdit = evt?.isOwner || evt?.sharedPermission === 'edit';

  const allMins   = list.flatMap(s => [timeToMinutes(s.startTime), timeToMinutes(s.startTime) + s.duration]);
  const minMin    = Math.min(...allMins);
  const maxMin    = Math.max(...allMins);
  const startHour = Math.floor(minMin / 60);
  const endHour   = Math.ceil(maxMin / 60);
  const PX_PER_HOUR = 100;
  const PADDING_TOP = 16;
  const totalPx   = (endHour - startHour) * PX_PER_HOUR + PADDING_TOP + 32;

  let labels = '', gridlines = '';
  for (let h = startHour; h <= endHour; h++) {
    for (let half = 0; half < 2; half++) {
      const mins = h * 60 + half * 30;
      if (mins < minMin - 30 || mins > maxMin + 30) continue;
      const top    = PADDING_TOP + ((mins / 60) - startHour) * PX_PER_HOUR;
      const label  = `${String(h).padStart(2,'0')}:${half ? '30' : '00'}`;
      const isHour = half === 0;
      labels    += `<div class="time-label" style="top:${top}px;opacity:${isHour?1:.55}">${label}</div>`;
      gridlines += `<div class="tl-gridline" style="top:${top}px;opacity:${isHour?.6:.25}"></div>`;
    }
  }

  let blocks = '';
  list.forEach(s => {
    const startMin  = timeToMinutes(s.startTime);
    const top       = PADDING_TOP + ((startMin / 60) - startHour) * PX_PER_HOUR;
    const height    = Math.max((s.duration / 60) * PX_PER_HOUR - 4, 48);
    const primary   = primaryTeam(s);
    const teamPills = getActiveTeamsForSession(s).map(t => teamBadgeHTML(t.key, t.label)).join('');
    const editBtns  = canEdit ? `
      <div class="tl-actions">
        <button class="icon-btn" data-action="edit" data-id="${s.id}" title="Edit">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
        </button>
        <button class="icon-btn danger" data-action="delete" data-id="${s.id}" title="Delete">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 4h10M5 4V2h4v2M5.5 6.5v4M8.5 6.5v4M3 4l.7 7.3A1 1 0 004.7 12h4.6a1 1 0 001-.7L11 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>` : '';

    blocks += `
      <div class="tl-block team-${primary}" style="top:${top}px;height:${height}px" data-id="${s.id}">
        <div class="tl-header">
          <span class="tl-title">${esc(s.title)}</span>
          <span class="tl-meta">${esc(s.startTime)} · ${formatDuration(s.duration)}</span>
        </div>
        ${s.location ? `<div class="tl-location">${esc(s.location)}</div>` : ''}
        ${teamPills   ? `<div class="tl-teams">${teamPills}</div>` : ''}
        ${editBtns}
      </div>`;
  });

  container.innerHTML = `
    <div class="timeline-wrapper" style="height:${totalPx}px">
      <div class="timeline-axis" style="height:${totalPx}px">
        <div class="time-rule"></div>${labels}
      </div>
      <div class="timeline-track" style="height:${totalPx}px">
        ${gridlines}${blocks}
      </div>
    </div>`;
}

function render() {
  if (activeView === 'table') renderTable();
  else renderTimeline();
}

// ── Session modal ────────────────────────────────────────────
function openModal(session = null) {
  editingId = session?.id ?? null;
  document.getElementById('modal-title').textContent   = session ? 'Edit session' : 'Add session';
  document.getElementById('form-id').value             = session?.id ?? '';
  document.getElementById('form-title').value          = session?.title ?? '';
  document.getElementById('form-start-time').value     = session?.startTime ?? '';
  document.getElementById('form-duration').value       = session?.duration ?? '';
  document.getElementById('form-location').value       = session?.location ?? '';
  TEAMS.forEach(t => {
    document.getElementById(`form-${t.key}`).value = session?.notes[t.key] ?? '';
  });
  clearFormError();
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('form-title').focus();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  editingId = null;
}

function showFormError(msg) {
  const el = document.getElementById('form-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function clearFormError() {
  document.getElementById('form-error').classList.add('hidden');
}

async function saveSession(e) {
  e.preventDefault();
  clearFormError();

  const title     = document.getElementById('form-title').value.trim();
  const startTime = document.getElementById('form-start-time').value;
  const duration  = parseInt(document.getElementById('form-duration').value, 10);
  const location  = document.getElementById('form-location').value.trim();

  if (!title)                    return showFormError('Session title is required.');
  if (!startTime)                return showFormError('Start time is required.');
  if (!duration || duration < 1) return showFormError('Please enter a valid duration.');

  const notes = {};
  TEAMS.forEach(t => { notes[t.key] = document.getElementById(`form-${t.key}`).value.trim(); });

  const saveBtn = document.getElementById('session-save-btn');
  saveBtn.disabled = true; saveBtn.textContent = 'Saving…';

  try {
    if (editingId) {
      const updated = { id: editingId, title, startTime, duration, location, notes };
      await updateSessionInDB(updated);
      const idx = sessions.findIndex(s => s.id === editingId);
      if (idx !== -1) sessions[idx] = updated;
    } else {
      const newId = await insertSessionInDB(currentEventId, { title, startTime, duration, location, notes });
      sessions.push({ id: newId, title, startTime, duration, location, notes });
      const evtIdx = events.findIndex(e => e.id === currentEventId);
      if (evtIdx !== -1) events[evtIdx]._sessionCount = (events[evtIdx]._sessionCount ?? 0) + 1;
    }
    closeModal();
    render();
  } catch (err) {
    console.error(err);
    showFormError('Failed to save session. Please try again.');
  } finally {
    saveBtn.disabled = false; saveBtn.textContent = 'Save session';
  }
}

// ── CSV import ───────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  return lines.slice(1).map(line => {
    const cols = []; let cur = '', inQuote = false;
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) { cols.push(cur); cur = ''; }
      else { cur += ch; }
    }
    cols.push(cur);
    const row = {};
    headers.forEach((h, i) => { row[h] = (cols[i] ?? '').trim(); });
    return row;
  });
}

function importCSV(file) {
  const reader = new FileReader();
  reader.onload = async e => {
    const rows = parseCSV(e.target.result);
    let imported = 0;
    for (const row of rows) {
      const title     = row['title']    || row['session'] || row['name'];
      const startTime = row['time']     || row['start']   || row['start_time'];
      const duration  = parseInt(row['duration'] || row['dur'] || '0', 10);
      if (!title || !startTime) continue;
      const notes = {
        banquets:  row['banquets']  || row['banquet']     || '',
        av:        row['av']        || row['audio_visual'] || '',
        speakers:  row['speakers']  || row['speaker']     || '',
        content:   row['content']                         || '',
        equipment: row['equipment']                       || '',
      };
      try {
        const newId = await insertSessionInDB(currentEventId, {
          title, startTime, duration: duration || 60,
          location: row['location'] || row['venue'] || '', notes,
        });
        sessions.push({ id: newId, title, startTime, duration: duration || 60,
          location: row['location'] || row['venue'] || '', notes });
        imported++;
      } catch (err) {
        console.error('Row import failed:', err);
      }
    }
    if (imported > 0) {
      const evtIdx = events.findIndex(ev => ev.id === currentEventId);
      if (evtIdx !== -1) events[evtIdx]._sessionCount = (events[evtIdx]._sessionCount ?? 0) + imported;
      render();
      alert(`Imported ${imported} session${imported !== 1 ? 's' : ''}.`);
    } else {
      alert('No valid sessions found. Check that your CSV has "title" and "time" columns.');
    }
  };
  reader.readAsText(file);
}

// ── Event wiring ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // ── Home — new event ─────────────────────────────────────
  document.getElementById('new-event-btn').addEventListener('click', openNewEventModal);
  document.getElementById('empty-new-btn').addEventListener('click', openNewEventModal);

  // ── Home — event card clicks (delegated) ─────────────────
  document.getElementById('event-cards').addEventListener('click', async e => {
    const shareBtn  = e.target.closest('[data-action="share-event"]');
    const deleteBtn = e.target.closest('[data-action="delete-event"]');
    const card      = e.target.closest('.event-card');

    if (shareBtn) {
      e.stopPropagation();
      await openShareModal(shareBtn.dataset.eventId);
      return;
    }
    if (deleteBtn) {
      e.stopPropagation();
      const evtId = deleteBtn.dataset.eventId;
      const evt   = events.find(ev => ev.id === evtId);
      if (evt && confirm(`Delete "${evt.name}" and all its sessions?`)) {
        showLoading();
        try {
          await deleteEventFromDB(evtId);
          events = events.filter(ev => ev.id !== evtId);
          renderHome();
        } catch {
          alert('Failed to delete event.');
        } finally {
          hideLoading();
        }
      }
      return;
    }
    if (card) openEvent(card.dataset.eventId);
  });

  // ── New event modal ───────────────────────────────────────
  document.getElementById('new-event-close-btn').addEventListener('click', closeNewEventModal);
  document.getElementById('new-event-cancel-btn').addEventListener('click', closeNewEventModal);
  document.getElementById('new-event-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('new-event-overlay')) closeNewEventModal();
  });
  document.getElementById('new-event-save-btn').addEventListener('click', createEvent);
  document.getElementById('new-event-name').addEventListener('keydown', e => { if (e.key === 'Enter') createEvent(); });

  // ── Share modal ───────────────────────────────────────────
  document.getElementById('share-close-btn').addEventListener('click', closeShareModal);
  document.getElementById('share-cancel-btn').addEventListener('click', closeShareModal);
  document.getElementById('share-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('share-overlay')) closeShareModal();
  });
  document.getElementById('share-save-btn').addEventListener('click', submitShare);
  document.getElementById('share-email').addEventListener('keydown', e => { if (e.key === 'Enter') submitShare(); });

  document.getElementById('share-list').addEventListener('click', async e => {
    const btn = e.target.closest('[data-action="remove-share"]');
    if (!btn) return;
    btn.disabled = true;
    try {
      await removeShareFromDB(btn.dataset.shareId);
      const shares = await loadSharesForEvent(sharingEventId);
      renderShareList(shares);
    } catch {
      alert('Failed to remove share.');
      btn.disabled = false;
    }
  });

  // ── Schedule — back button ────────────────────────────────
  document.getElementById('back-btn').addEventListener('click', showHome);

  // ── Schedule — event name sync ────────────────────────────
  document.getElementById('event-name').addEventListener('input', e => {
    if (!currentEventId) return;
    const idx = events.findIndex(ev => ev.id === currentEventId);
    if (idx !== -1) events[idx].name = e.target.value;
    clearTimeout(nameDebounce);
    nameDebounce = setTimeout(() => {
      updateEventNameInDB(currentEventId, e.target.value).catch(console.error);
    }, 600);
  });

  // ── View toggle ───────────────────────────────────────────
  document.querySelector('.view-toggle').addEventListener('click', e => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    activeView = btn.dataset.view;
    document.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `${activeView}-view`));
    render();
  });

  // ── Filter chips ──────────────────────────────────────────
  document.querySelector('.filter-chips').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const team = chip.dataset.team;
    if (team === 'all') {
      activeFilters = new Set(['all']);
    } else {
      activeFilters.delete('all');
      if (activeFilters.has(team)) {
        activeFilters.delete(team);
        if (!activeFilters.size) activeFilters.add('all');
      } else {
        activeFilters.add(team);
      }
    }
    document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', activeFilters.has(c.dataset.team)));
    render();
  });

  // ── Session buttons ───────────────────────────────────────
  document.getElementById('add-session-btn').addEventListener('click', () => openModal());
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });
  document.getElementById('session-form').addEventListener('submit', saveSession);

  // Edit / Delete sessions (delegated)
  document.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'edit') {
      const s = sessions.find(s => s.id === id);
      if (s) openModal(s);
    } else if (action === 'delete') {
      if (!confirm('Delete this session?')) return;
      btn.disabled = true;
      try {
        await deleteSessionFromDB(id);
        sessions = sessions.filter(s => s.id !== id);
        const evtIdx = events.findIndex(ev => ev.id === currentEventId);
        if (evtIdx !== -1) events[evtIdx]._sessionCount = Math.max(0, (events[evtIdx]._sessionCount ?? 1) - 1);
        render();
      } catch {
        alert('Failed to delete session.');
        btn.disabled = false;
      }
    }
  });

  // ── CSV import ────────────────────────────────────────────
  document.getElementById('import-csv-btn').addEventListener('click', () => {
    document.getElementById('csv-file-input').click();
  });
  document.getElementById('csv-file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) { importCSV(file); e.target.value = ''; }
  });

  // ── Escape closes any open modal ──────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); closeNewEventModal(); closeShareModal(); }
  });
});
