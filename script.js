// ── Team config ─────────────────────────────────────────────
const TEAMS = [
  { key: 'banquets',  label: 'Banquets'    },
  { key: 'av',        label: 'Audio Visual' },
  { key: 'speakers',  label: 'Speakers'    },
  { key: 'content',   label: 'Content'     },
  { key: 'equipment', label: 'Equipment'   },
];

// ── Sample data ──────────────────────────────────────────────
const SAMPLE_SESSIONS = [
  {
    id: 'sample-1',
    title: 'Registration',
    startTime: '08:00',
    duration: 30,
    location: 'Main Foyer',
    notes: {
      banquets:  'Set up welcome table with name badges and lanyards. Ensure tea & coffee station is ready before doors open.',
      av:        'Background music at low volume. Confirm registration screens are displaying event branding correctly.',
      speakers:  '',
      content:   'Welcome signage and event program booklets available at desk. Display QR code for digital schedule.',
      equipment: 'Ensure 2 registration laptops are set up and connected. Test badge printers.',
    },
  },
  {
    id: 'sample-2',
    title: 'Opening Keynote',
    startTime: '09:00',
    duration: 60,
    location: 'Main Hall',
    notes: {
      banquets:  '',
      av:        'Full AV setup: lapel mic for speaker, slides loaded on stage laptop, test clicker. Live stream active.',
      speakers:  'Speaker arrives 30 min early for soundcheck. Load and test presentation. Confirm clicker batteries.',
      content:   'Live-blog the keynote. Capture key quotes for social media. Photographer on stage for first 5 min.',
      equipment: 'Stage lighting at full. Podium and confidence monitor displaying slides. Check all cables taped.',
    },
  },
  {
    id: 'sample-3',
    title: 'Morning Tea',
    startTime: '10:00',
    duration: 30,
    location: 'Foyer & Terrace',
    notes: {
      banquets:  'Serve scones, pastries, tea and coffee. Allergen cards displayed prominently. Clear within 20 min.',
      av:        'Background music on in foyer at social volume.',
      speakers:  '',
      content:   '',
      equipment: '',
    },
  },
  {
    id: 'sample-4',
    title: 'Panel Discussion',
    startTime: '10:30',
    duration: 60,
    location: 'Main Hall',
    notes: {
      banquets:  '',
      av:        'Panel setup: 4 lapel mics + 1 handheld for moderator. Name placards on table. Run Q&A handheld.',
      speakers:  '4 panellists + moderator. Pre-panel briefing at 10:15 backstage. Confirm Q&A procedure with moderator.',
      content:   'Live-tweet highlights with event hashtag. Photography of full panel. Capture audience questions.',
      equipment: 'Round table with 5 seats, water and glasses for all panellists. Extra chairs for overflow.',
    },
  },
  {
    id: 'sample-5',
    title: 'Networking Lunch',
    startTime: '12:00',
    duration: 60,
    location: 'Restaurant & Garden',
    notes: {
      banquets:  'Seated lunch: entree at 12:15, main at 12:35, dessert at 12:50. Dietary options labelled on each plate.',
      av:        'Background music only. No presentations during lunch. Lower stage lighting.',
      speakers:  '',
      content:   'Networking photography — candid shots for social media. Collect speaker testimonials if possible.',
      equipment: '',
    },
  },
];

// ── Storage ──────────────────────────────────────────────────
const EVENTS_KEY = 'eventflow_v2_events';

function sessionsKey(eventId) {
  return `eventflow_v2_sessions_${eventId}`;
}

function saveEvents(evts) {
  localStorage.setItem(EVENTS_KEY, JSON.stringify(evts));
}

function loadEvents() {
  try {
    const saved = localStorage.getItem(EVENTS_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch (e) {
    return null;
  }
}

function saveCurrentSessions() {
  if (currentEventId) {
    localStorage.setItem(sessionsKey(currentEventId), JSON.stringify(sessions));
  }
}

function loadSessionsForEvent(eventId) {
  try {
    const saved = localStorage.getItem(sessionsKey(eventId));
    return saved ? JSON.parse(saved) : [];
  } catch (e) {
    return [];
  }
}

// ── State ────────────────────────────────────────────────────
const storedEvents = loadEvents();
let events;
if (storedEvents === null) {
  const sampleId = 'sample-event-1';
  events = [{ id: sampleId, name: 'Annual Conference 2026', date: '2026-09-15', type: 'Conference', createdAt: new Date().toISOString() }];
  saveEvents(events);
  localStorage.setItem(sessionsKey(sampleId), JSON.stringify(SAMPLE_SESSIONS));
} else {
  events = storedEvents;
}

let currentEventId = null;
let sessions = [];
let activeView = 'table';
let activeFilters = new Set(['all']);
let editingId = null;

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
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getActiveTeamsForSession(session) {
  return TEAMS.filter(t => session.notes[t.key]?.trim());
}

function primaryTeam(session) {
  const first = getActiveTeamsForSession(session)[0];
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

function formatEventDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch (e) {
    return dateStr;
  }
}

// ── Home screen ──────────────────────────────────────────────
function renderHome() {
  const grid = document.getElementById('event-cards');
  const empty = document.getElementById('home-empty');

  if (events.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  grid.innerHTML = events.map(evt => {
    const count = loadSessionsForEvent(evt.id).length;
    const dateStr = formatEventDate(evt.date);
    return `
      <div class="event-card" data-event-id="${evt.id}">
        <div class="event-card-name">${esc(evt.name)}</div>
        <div class="event-card-meta">
          ${evt.type ? `<span class="event-card-type">${esc(evt.type)}</span>` : ''}
          ${dateStr ? `<div class="event-card-date">${dateStr}</div>` : ''}
        </div>
        <div class="event-card-footer">
          <span class="event-card-sessions">${count} session${count !== 1 ? 's' : ''}</span>
          <button class="icon-btn danger" data-action="delete-event" data-event-id="${evt.id}" title="Delete event">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4h10M5 4V2h4v2M5.5 6.5v4M8.5 6.5v4M3 4l.7 7.3A1 1 0 004.7 12h4.6a1 1 0 001-.7L11 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>`;
  }).join('');
}

function showHome() {
  currentEventId = null;
  sessions = [];
  document.getElementById('home-screen').classList.remove('hidden');
  document.getElementById('schedule-screen').classList.add('hidden');
  renderHome();
}

function openEvent(eventId) {
  currentEventId = eventId;
  sessions = loadSessionsForEvent(eventId);
  const evt = events.find(e => e.id === eventId);
  document.getElementById('event-name').value = evt?.name ?? '';
  document.getElementById('home-screen').classList.add('hidden');
  document.getElementById('schedule-screen').classList.remove('hidden');
  activeView = 'table';
  activeFilters = new Set(['all']);
  document.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'table'));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'table-view'));
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.team === 'all'));
  render();
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

function createEvent() {
  const name = document.getElementById('new-event-name').value.trim();
  const date = document.getElementById('new-event-date').value;
  const type = document.getElementById('new-event-type').value;

  if (!name) {
    const err = document.getElementById('new-event-error');
    err.textContent = 'Event name is required.';
    err.classList.remove('hidden');
    return;
  }

  const newEvent = { id: uid(), name, date, type, createdAt: new Date().toISOString() };
  events.push(newEvent);
  saveEvents(events);
  closeNewEventModal();
  openEvent(newEvent.id);
}

// ── Render: Table view ───────────────────────────────────────
function renderTable() {
  const tbody = document.getElementById('table-body');
  const empty = document.getElementById('table-empty');
  const list = filteredSessions();

  if (list.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  tbody.innerHTML = list.map(s => {
    const teamNotes = getActiveTeamsForSession(s);
    const notesHTML = teamNotes.length
      ? teamNotes.map(t => `
          <div class="team-note-item">
            ${teamBadgeHTML(t.key, t.label)}
            <span class="team-note-text">${esc(s.notes[t.key])}</span>
          </div>`).join('')
      : '<span style="color:var(--subtle);font-size:13px">-</span>';

    return `
      <tr>
        <td class="td-time">${esc(s.startTime)}</td>
        <td class="td-duration">${formatDuration(s.duration)}</td>
        <td class="td-title">${esc(s.title)}</td>
        <td class="td-location">${esc(s.location) || '<span style="color:var(--subtle)">-</span>'}</td>
        <td><div class="team-note-list">${notesHTML}</div></td>
        <td class="td-actions">
          <div class="actions-group">
            <button class="icon-btn" data-action="edit" data-id="${s.id}" title="Edit session">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
            </button>
            <button class="icon-btn danger" data-action="delete" data-id="${s.id}" title="Delete session">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4h10M5 4V2h4v2M5.5 6.5v4M8.5 6.5v4M3 4l.7 7.3A1 1 0 004.7 12h4.6a1 1 0 001-.7L11 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

// ── Render: Timeline view ────────────────────────────────────
function renderTimeline() {
  const container = document.getElementById('timeline-container');
  const empty = document.getElementById('timeline-empty');
  const list = filteredSessions();

  if (list.length === 0) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const allMins = list.flatMap(s => [timeToMinutes(s.startTime), timeToMinutes(s.startTime) + s.duration]);
  const minMin = Math.min(...allMins);
  const maxMin = Math.max(...allMins);

  const startHour = Math.floor(minMin / 60);
  const endHour = Math.ceil(maxMin / 60);
  const totalHours = endHour - startHour;

  const PX_PER_HOUR = 100;
  const PADDING_TOP = 16;
  const totalPx = totalHours * PX_PER_HOUR + PADDING_TOP + 32;

  let labels = '';
  let gridlines = '';
  for (let h = startHour; h <= endHour; h++) {
    for (let half = 0; half < 2; half++) {
      const mins = h * 60 + half * 30;
      if (mins < minMin - 30 || mins > maxMin + 30) continue;
      const top = PADDING_TOP + ((mins / 60) - startHour) * PX_PER_HOUR;
      const label = half === 0
        ? `${String(h).padStart(2, '0')}:00`
        : `${String(h).padStart(2, '0')}:30`;
      const isHour = half === 0;
      labels += `<div class="time-label" style="top:${top}px; opacity:${isHour ? 1 : 0.55}">${label}</div>`;
      gridlines += `<div class="tl-gridline" style="top:${top}px; opacity:${isHour ? 0.6 : 0.25}"></div>`;
    }
  }

  let blocks = '';
  list.forEach(s => {
    const startMin = timeToMinutes(s.startTime);
    const top = PADDING_TOP + ((startMin / 60) - startHour) * PX_PER_HOUR;
    const height = Math.max((s.duration / 60) * PX_PER_HOUR - 4, 48);
    const primary = primaryTeam(s);
    const teamPills = getActiveTeamsForSession(s)
      .map(t => teamBadgeHTML(t.key, t.label))
      .join('');

    blocks += `
      <div class="tl-block team-${primary}" style="top:${top}px; height:${height}px;" data-id="${s.id}">
        <div class="tl-header">
          <span class="tl-title">${esc(s.title)}</span>
          <span class="tl-meta">${esc(s.startTime)} · ${formatDuration(s.duration)}</span>
        </div>
        ${s.location ? `<div class="tl-location">${esc(s.location)}</div>` : ''}
        ${teamPills ? `<div class="tl-teams">${teamPills}</div>` : ''}
        <div class="tl-actions">
          <button class="icon-btn" data-action="edit" data-id="${s.id}" title="Edit">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
          </button>
          <button class="icon-btn danger" data-action="delete" data-id="${s.id}" title="Delete">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 4h10M5 4V2h4v2M5.5 6.5v4M8.5 6.5v4M3 4l.7 7.3A1 1 0 004.7 12h4.6a1 1 0 001-.7L11 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>`;
  });

  container.innerHTML = `
    <div class="timeline-wrapper" style="height:${totalPx}px">
      <div class="timeline-axis" style="height:${totalPx}px">
        <div class="time-rule"></div>
        ${labels}
      </div>
      <div class="timeline-track" style="height:${totalPx}px">
        ${gridlines}
        ${blocks}
      </div>
    </div>`;
}

// ── Render ───────────────────────────────────────────────────
function render() {
  if (activeView === 'table') renderTable();
  else renderTimeline();
}

// ── Session modal ────────────────────────────────────────────
function openModal(session = null) {
  editingId = session ? session.id : null;
  document.getElementById('modal-title').textContent = session ? 'Edit session' : 'Add session';
  document.getElementById('form-id').value = session?.id ?? '';
  document.getElementById('form-title').value = session?.title ?? '';
  document.getElementById('form-start-time').value = session?.startTime ?? '';
  document.getElementById('form-duration').value = session?.duration ?? '';
  document.getElementById('form-location').value = session?.location ?? '';
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

function saveSession(e) {
  e.preventDefault();
  clearFormError();

  const title = document.getElementById('form-title').value.trim();
  const startTime = document.getElementById('form-start-time').value;
  const duration = parseInt(document.getElementById('form-duration').value, 10);
  const location = document.getElementById('form-location').value.trim();

  if (!title) return showFormError('Session title is required.');
  if (!startTime) return showFormError('Start time is required.');
  if (!duration || duration < 1) return showFormError('Please enter a valid duration.');

  const notes = {};
  TEAMS.forEach(t => {
    notes[t.key] = document.getElementById(`form-${t.key}`).value.trim();
  });

  if (editingId) {
    const idx = sessions.findIndex(s => s.id === editingId);
    if (idx !== -1) sessions[idx] = { id: editingId, title, startTime, duration, location, notes };
  } else {
    sessions.push({ id: uid(), title, startTime, duration, location, notes });
  }

  saveCurrentSessions();
  closeModal();
  render();
}

// ── CSV import ───────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  return lines.slice(1).map(line => {
    const cols = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
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
  reader.onload = e => {
    const rows = parseCSV(e.target.result);
    let imported = 0;
    rows.forEach(row => {
      const title = row['title'] || row['session'] || row['name'];
      const startTime = row['time'] || row['start'] || row['start_time'];
      const duration = parseInt(row['duration'] || row['dur'] || '0', 10);
      if (!title || !startTime) return;
      sessions.push({
        id: uid(),
        title,
        startTime,
        duration: duration || 60,
        location: row['location'] || row['venue'] || '',
        notes: {
          banquets:  row['banquets']  || row['banquet']      || '',
          av:        row['av']        || row['audio_visual']  || '',
          speakers:  row['speakers']  || row['speaker']      || '',
          content:   row['content']                          || '',
          equipment: row['equipment']                        || '',
        },
      });
      imported++;
    });
    if (imported > 0) {
      saveCurrentSessions();
      render();
      alert(`Imported ${imported} session${imported !== 1 ? 's' : ''}. Your schedule has been saved.`);
    } else {
      alert('No valid sessions found. Check that your CSV has "title" and "time" columns.');
    }
  };
  reader.readAsText(file);
}

// ── Event wiring ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  showHome();

  // Home — new event buttons
  document.getElementById('new-event-btn').addEventListener('click', openNewEventModal);
  document.getElementById('empty-new-btn').addEventListener('click', openNewEventModal);

  // Home — event card clicks (delegated)
  document.getElementById('event-cards').addEventListener('click', e => {
    const deleteBtn = e.target.closest('[data-action="delete-event"]');
    if (deleteBtn) {
      e.stopPropagation();
      const evtId = deleteBtn.dataset.eventId;
      const evt = events.find(ev => ev.id === evtId);
      if (evt && confirm(`Delete "${evt.name}" and all its sessions?`)) {
        events = events.filter(ev => ev.id !== evtId);
        localStorage.removeItem(sessionsKey(evtId));
        saveEvents(events);
        renderHome();
      }
      return;
    }
    const card = e.target.closest('.event-card');
    if (card) openEvent(card.dataset.eventId);
  });

  // New event modal
  document.getElementById('new-event-close-btn').addEventListener('click', closeNewEventModal);
  document.getElementById('new-event-cancel-btn').addEventListener('click', closeNewEventModal);
  document.getElementById('new-event-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('new-event-overlay')) closeNewEventModal();
  });
  document.getElementById('new-event-save-btn').addEventListener('click', createEvent);
  document.getElementById('new-event-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') createEvent();
  });

  // Schedule — back button
  document.getElementById('back-btn').addEventListener('click', showHome);

  // Schedule — sync event name edits back to the events list
  document.getElementById('event-name').addEventListener('input', e => {
    if (!currentEventId) return;
    const idx = events.findIndex(ev => ev.id === currentEventId);
    if (idx !== -1) { events[idx].name = e.target.value; saveEvents(events); }
  });

  // View toggle
  document.querySelector('.view-toggle').addEventListener('click', e => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    activeView = btn.dataset.view;
    document.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `${activeView}-view`));
    render();
  });

  // Filter chips
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
        if (activeFilters.size === 0) activeFilters.add('all');
      } else {
        activeFilters.add(team);
      }
    }

    document.querySelectorAll('.chip').forEach(c => {
      c.classList.toggle('active', activeFilters.has(c.dataset.team));
    });

    render();
  });

  // Add session
  document.getElementById('add-session-btn').addEventListener('click', () => openModal());

  // Session modal close
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });

  // Escape closes any open modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); closeNewEventModal(); }
  });

  // Form submit
  document.getElementById('session-form').addEventListener('submit', saveSession);

  // Edit / Delete sessions (delegated to document)
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'edit') {
      const s = sessions.find(s => s.id === id);
      if (s) openModal(s);
    } else if (action === 'delete') {
      if (confirm('Delete this session?')) {
        sessions = sessions.filter(s => s.id !== id);
        saveCurrentSessions();
        render();
      }
    }
  });

  // CSV import
  document.getElementById('import-csv-btn').addEventListener('click', () => {
    document.getElementById('csv-file-input').click();
  });
  document.getElementById('csv-file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) { importCSV(file); e.target.value = ''; }
  });
});
