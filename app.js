(function () {
  'use strict';

  // Blend from turquoise (#00CED1) to pink (#FF3C78) in OKLCH, 5 even steps.
  // The first entry is the default for new events.
  var COLORS = [
    { name: 'Turquoise', hex: '#00CED1' },
    { name: 'Sky',       hex: '#2FB8FF' },
    { name: 'Violet',    hex: '#9691FF' },
    { name: 'Orchid',    hex: '#D966E0' },
    { name: 'Pink',      hex: '#FF3C78' }
  ];

  var STORAGE_KEY = 'event_countdowns_v1';

  // All times are entered and shown in US Eastern Time, whatever time zone the
  // device or browser reports. EST/EDT daylight-saving changes are handled.
  var TIME_ZONE = 'America/New_York';
  var TIME_ZONE_LABEL = 'Eastern Time';

  // Text color used on top of any color fill. Near-black gives the highest
  // contrast on every swatch in the palette.
  var ON_FILL = '#0b0b0b';

  var CHECK_SVG =
    '<svg class="check-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" stroke-width="1.75"/>' +
    '<path d="M8 12.4l2.7 2.7L16.2 9.5" fill="none" stroke="currentColor" stroke-width="1.75" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var state = {
    events: [],
    formOpen: false,
    selectedColor: COLORS[0].hex,
    completedIds: {}
  };

  function $(id) { return document.getElementById(id); }
  function pad2(n) { return String(n).padStart(2, '0'); }

  function uid() {
    return 'e_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function targetMs(ev) { return new Date(ev.datetime).getTime(); }
  function isComplete(ev, now) { return targetMs(ev) <= now; }

  /* ---------- Storage ---------- */

  function loadEvents() {
    var changed = false;
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          state.events = parsed.filter(function (e) {
            return e && e.id && e.title && e.datetime && !isNaN(new Date(e.datetime).getTime());
          });
        }
      }
    } catch (err) {
      state.events = [];
    }
    state.events.forEach(function (e) {
      if (typeof e.createdAt !== 'number' || isNaN(e.createdAt)) {
        e.createdAt = Date.now();
        changed = true;
      }
    });
    if (changed) persist();
    sortEvents();
  }

  function persist() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.events));
      return true;
    } catch (err) {
      return false;
    }
  }

  // Upcoming events first (soonest at top), then completed events
  // (most recently completed first).
  function sortEvents() {
    var now = Date.now();
    state.events.sort(function (a, b) {
      var ac = isComplete(a, now), bc = isComplete(b, now);
      if (ac !== bc) return ac ? 1 : -1;
      return ac ? targetMs(b) - targetMs(a) : targetMs(a) - targetMs(b);
    });
  }

  /* ---------- Time zone ---------- */

  function fmtDateDisplay(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-US', {
      timeZone: TIME_ZONE,
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    });
  }

  var tzPartsFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  // Offset of TIME_ZONE from UTC (in ms) at a given instant.
  function zoneOffsetMs(utcMs) {
    var whole = Math.floor(utcMs / 1000) * 1000;
    var p = {};
    tzPartsFormatter.formatToParts(new Date(whole)).forEach(function (part) {
      p[part.type] = part.value;
    });
    var hour = +p.hour === 24 ? 0 : +p.hour;
    var asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, hour, +p.minute, +p.second);
    return asUtc - whole;
  }

  // Parse the datetime-local value ("YYYY-MM-DDTHH:MM") as a wall-clock time in
  // TIME_ZONE and return the matching Date, independent of the device's zone.
  function parseZonedDateTime(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value || '');
    if (!m) return null;
    var wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    var off1 = zoneOffsetMs(wall);
    var utc = wall - off1;
    var off2 = zoneOffsetMs(utc);
    if (off2 !== off1) utc = wall - off2; // crossing a DST change
    var d = new Date(utc);
    return isNaN(d.getTime()) ? null : d;
  }

  function renderTimeZoneNote() {
    var footer = document.querySelector('.footer');
    if (!footer) return;
    footer.textContent = 'Data is stored locally in this browser only. Export a backup before ' +
      'clearing browser data. All times are ' + TIME_ZONE_LABEL + '.';
  }

  /* ---------- Backup: export / import ---------- */

  var BACKUP_APP_ID = 'event-countdowns';
  var BACKUP_VERSION = 1;
  var statusTimer = null;

  function showBackupStatus(msg, kind) {
    var el = $('backup-status');
    el.textContent = msg;
    el.classList.toggle('is-error', kind === 'error');
    el.classList.toggle('is-success', kind === 'success');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () {
      el.textContent = '';
      el.classList.remove('is-error', 'is-success');
    }, 7000);
  }

  function easternDateStamp() {
    // en-CA formats as YYYY-MM-DD
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    showBackupStatus('Saved ' + filename + '.', 'success');
  }

  function exportEvents() {
    if (state.events.length === 0) {
      showBackupStatus('There are no events to export yet.', 'error');
      return;
    }
    var payload = {
      app: BACKUP_APP_ID,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      timeZone: TIME_ZONE,
      events: state.events.map(function (e) {
        return { id: e.id, title: e.title, datetime: e.datetime, color: e.color, createdAt: e.createdAt };
      })
    };
    var json = JSON.stringify(payload, null, 2);
    var filename = 'event-countdowns-backup-' + easternDateStamp() + '.json';
    var blob = new Blob([json], { type: 'application/json' });

    // On phones, the share sheet is the reliable way to save a file
    // (e.g. "Save to Files" on iPhone). Desktop browsers download it.
    var touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    var file = null;
    try { file = new File([blob], filename, { type: 'application/json' }); } catch (err) { file = null; }

    if (touch && file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'Event countdowns backup' })
        .then(function () { showBackupStatus('Backup ready: ' + filename + '.', 'success'); })
        .catch(function (err) {
          if (err && err.name === 'AbortError') return; // user closed the share sheet
          downloadBlob(blob, filename);
        });
      return;
    }
    downloadBlob(blob, filename);
  }

  function readFileText(file) {
    if (file.text) return file.text();
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsText(file);
    });
  }

  // Turn one imported entry into a clean event, or null if it isn't usable.
  function sanitizeImported(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 80) : '';
    var d = new Date(raw.datetime);
    if (!title || isNaN(d.getTime())) return null;
    var color = typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : COLORS[0].hex;
    var createdAt = typeof raw.createdAt === 'number' && !isNaN(raw.createdAt) ? raw.createdAt : Date.now();
    var id = typeof raw.id === 'string' && raw.id ? raw.id : uid();
    return { id: id, title: title, datetime: d.toISOString(), color: color, createdAt: createdAt };
  }

  // Adds events from the file to the current list. Events already in the
  // list (same id, or same title and time) are skipped, so importing the
  // same backup twice never creates duplicates.
  function importFromText(text) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      showBackupStatus("That file couldn't be read. Choose a backup exported from this app.", 'error');
      return;
    }
    var list = Array.isArray(data) ? data : (data && Array.isArray(data.events) ? data.events : null);
    if (!list) {
      showBackupStatus("That file doesn't contain events from this app.", 'error');
      return;
    }

    var ids = {};
    var keys = {};
    state.events.forEach(function (e) {
      ids[e.id] = true;
      keys[e.title + '|' + e.datetime] = true;
    });

    var added = [], dupes = 0, invalid = 0;
    list.forEach(function (raw) {
      var ev = sanitizeImported(raw);
      if (!ev) { invalid++; return; }
      var key = ev.title + '|' + ev.datetime;
      if (ids[ev.id] || keys[key]) { dupes++; return; }
      ids[ev.id] = true;
      keys[key] = true;
      added.push(ev);
    });

    if (added.length === 0) {
      var none = dupes > 0
        ? 'Nothing new to import. All ' + plural(dupes, 'event') + ' are already in your list.'
        : 'No usable events were found in that file.';
      showBackupStatus(none, dupes > 0 ? 'success' : 'error');
      return;
    }

    var before = state.events.slice();
    state.events = state.events.concat(added);
    sortEvents();
    if (!persist()) {
      state.events = before;
      showBackupStatus("Couldn't save the imported events to browser storage.", 'error');
      return;
    }
    render();

    var msg = 'Imported ' + plural(added.length, 'event') + '.';
    if (dupes) msg += ' ' + plural(dupes, 'event') + ' already in your list.';
    if (invalid) msg += ' ' + invalid + (invalid === 1 ? ' entry' : ' entries') + ' skipped (unreadable).';
    showBackupStatus(msg, 'success');
  }

  function onImportFileChosen(e) {
    var input = e.target;
    var file = input.files && input.files[0];
    if (!file) return;
    readFileText(file)
      .then(importFromText)
      .catch(function () {
        showBackupStatus("That file couldn't be read.", 'error');
      })
      .then(function () { input.value = ''; });
  }

  /* ---------- Countdown math ---------- */

  function diffParts(ms) {
    var totalSec = Math.max(0, Math.floor(ms / 1000));
    return {
      days: Math.floor(totalSec / 86400),
      hours: Math.floor((totalSec % 86400) / 3600),
      minutes: Math.floor((totalSec % 3600) / 60),
      seconds: totalSec % 60
    };
  }

  var DAY_MS = 24 * 60 * 60 * 1000;

  // Fill = 1 / N, where N is the number of 24-hour periods left, rounded up.
  // Example: 1.5 days left -> N = 2 -> 50%. In the final 24 hours N = 1 (100%);
  // the stylesheet leaves a thin unfilled strip until the event completes.
  function progressPct(ev, now) {
    var left = targetMs(ev) - now;
    if (left <= 0) return 100;
    var n = Math.ceil(left / DAY_MS);
    return 100 / n;
  }

  // Final 24 hours before the event (shows the glowing strip).
  function isFinalDay(ev, now) {
    var left = targetMs(ev) - now;
    return left > 0 && left <= DAY_MS;
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function relativeAgo(ms) {
    var sec = Math.floor(ms / 1000);
    if (sec < 60) return 'Just now';
    var min = Math.floor(sec / 60);
    if (min < 60) return plural(min, 'minute') + ' ago';
    var hr = Math.floor(min / 60);
    if (hr < 24) return plural(hr, 'hour') + ' ago';
    var day = Math.floor(hr / 24);
    return plural(day, 'day') + ' ago';
  }

  /* ---------- Form ---------- */

  function showFormError(msg) {
    var box = $('form-err');
    box.textContent = msg;
    box.classList.remove('hidden');
  }

  function clearFormError() {
    var box = $('form-err');
    box.textContent = '';
    box.classList.add('hidden');
  }

  function buildSwatches() {
    var host = $('swatches');
    host.innerHTML = '';
    COLORS.forEach(function (c) {
      var b = document.createElement('button');
      var selected = c.hex === state.selectedColor;
      b.type = 'button';
      b.className = 'swatch' + (selected ? ' selected' : '');
      b.style.background = c.hex;
      b.title = c.name;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', selected ? 'true' : 'false');
      b.setAttribute('aria-label', c.name);
      b.addEventListener('click', function () {
        state.selectedColor = c.hex;
        buildSwatches();
      });
      host.appendChild(b);
    });
  }

  function openForm() {
    state.formOpen = true;
    state.selectedColor = COLORS[0].hex;
    $('evt-title').value = '';
    $('evt-dt').value = '';
    clearFormError();
    buildSwatches();
    $('form-wrap').classList.remove('hidden');
    $('toggle-form').classList.add('hidden');
    setTimeout(function () { $('evt-title').focus(); }, 50);
  }

  function closeForm() {
    state.formOpen = false;
    clearFormError();
    $('form-wrap').classList.add('hidden');
    $('toggle-form').classList.remove('hidden');
  }

  function saveEvent() {
    var title = $('evt-title').value.trim();
    var dtRaw = $('evt-dt').value;
    var dt = parseZonedDateTime(dtRaw);

    if (!title) { showFormError('Please enter an event title.'); return; }
    if (!dt || isNaN(dt.getTime())) { showFormError('Please pick a valid date and time.'); return; }

    var ev = {
      id: uid(),
      title: title,
      datetime: dt.toISOString(),
      color: state.selectedColor,
      createdAt: Date.now()
    };
    state.events.push(ev);
    sortEvents();

    if (!persist()) {
      state.events = state.events.filter(function (e) { return e.id !== ev.id; });
      showFormError('Could not save to browser storage. Private browsing may block it.');
      return;
    }

    closeForm();
    render();
  }

  function removeEvent(id) {
    state.events = state.events.filter(function (e) { return e.id !== id; });
    persist();
    render();
  }

  /* ---------- Rendering ---------- */

  function renderCount() {
    var n = state.events.length;
    $('count-display').textContent = n === 0 ? '' : (n === 1 ? '1 event' : n + ' events');
  }

  // One copy of the card's text. Each active card holds two copies: a light
  // one on the dark card and a dark one clipped to the filled area.
  function buildLayer(ev, extraClass) {
    var layer = document.createElement('div');
    layer.className = 'card-layer ' + extraClass;

    var h = document.createElement('p');
    h.className = 'event-title';
    h.textContent = ev.title;

    var d = document.createElement('p');
    d.className = 'event-date';
    d.textContent = fmtDateDisplay(ev.datetime);

    var text = document.createElement('div');
    text.className = 'card-text';
    text.appendChild(h);
    text.appendChild(d);

    var timer = document.createElement('div');
    timer.className = 'timer';
    timer.setAttribute('data-timer', '');

    layer.appendChild(text);
    layer.appendChild(timer);
    return layer;
  }

  function buildCard(ev, now) {
    var complete = isComplete(ev, now);
    var color = ev.color || COLORS[0].hex;

    var card = document.createElement('article');
    card.className = 'event-card' +
      (complete ? ' is-complete' : '') +
      (!complete && isFinalDay(ev, now) ? ' is-final' : '');
    card.style.setProperty('--accent', color);
    card.style.setProperty('--on-accent', ON_FILL);
    card.style.setProperty('--p', complete ? '100' : String(progressPct(ev, now)));
    card.dataset.id = ev.id;

    var fill = document.createElement('div');
    fill.className = 'card-fill';
    fill.setAttribute('aria-hidden', 'true');
    card.appendChild(fill);

    if (complete) {
      card.appendChild(buildLayer(ev, 'layer-solo'));
    } else {
      card.appendChild(buildLayer(ev, 'layer-base'));
      var overlay = buildLayer(ev, 'layer-overlay');
      overlay.setAttribute('aria-hidden', 'true');
      card.appendChild(overlay);
    }

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'delete-btn';
    del.setAttribute('aria-label', 'Remove ' + ev.title);
    del.title = 'Remove event';
    del.innerHTML = '&times;';
    del.addEventListener('click', function () {
      if (window.confirm('Remove "' + ev.title + '"?')) removeEvent(ev.id);
    });
    card.appendChild(del);

    return card;
  }

  function renderList() {
    var body = $('body-area');
    var now = Date.now();

    state.completedIds = {};
    state.events.forEach(function (ev) {
      if (isComplete(ev, now)) state.completedIds[ev.id] = true;
    });

    if (state.events.length === 0) {
      body.innerHTML = '<div class="empty-state">No events yet. Tap <strong>+ Add event</strong> to create your first countdown.</div>';
      return;
    }

    var list = document.createElement('div');
    list.className = 'event-list';
    state.events.forEach(function (ev) { list.appendChild(buildCard(ev, now)); });

    body.innerHTML = '';
    body.appendChild(list);
    tickAll();
  }

  function timerHtml(ms) {
    var p = diffParts(ms);
    var units = [];
    if (p.days > 0) units.push(['Days', p.days]);
    if (p.days > 0 || p.hours > 0) units.push(['Hours', pad2(p.hours)]);
    if (p.days > 0 || p.hours > 0 || p.minutes > 0) units.push(['Minutes', pad2(p.minutes)]);
    units.push(['Seconds', pad2(p.seconds)]);
    return units.map(function (u) {
      return '<div class="timer-unit"><span class="timer-num">' + u[1] +
             '</span><span class="timer-label">' + u[0] + '</span></div>';
    }).join('');
  }

  function completeHtml(msSince) {
    return '<div class="complete-row">' + CHECK_SVG +
           '<span class="complete-label">Complete</span>' +
           '<span class="complete-ago">' + relativeAgo(msSince) + '</span></div>';
  }

  // Delete button sits on the fill once the fill reaches its center.
  function updateDeleteContrast(card, pct) {
    var btn = card.querySelector('.delete-btn');
    if (!btn) return;
    var maxPx = pct >= 100 && card.classList.contains('is-complete')
      ? card.clientWidth
      : card.clientWidth - 6;
    var fillPx = Math.min(maxPx, Math.max(4, card.clientWidth * pct / 100));
    var center = btn.offsetLeft + btn.offsetWidth / 2;
    btn.classList.toggle('on-fill', fillPx >= center);
  }

  function tickAll() {
    var now = Date.now();
    var needsResort = false;
    var byId = {};
    state.events.forEach(function (ev) { byId[ev.id] = ev; });

    document.querySelectorAll('.event-card').forEach(function (card) {
      var ev = byId[card.dataset.id];
      if (!ev) return;
      var complete = isComplete(ev, now);

      if (complete && !state.completedIds[ev.id]) {
        needsResort = true;
        return;
      }

      if (complete) {
        card.querySelector('[data-timer]').innerHTML = completeHtml(now - targetMs(ev));
        updateDeleteContrast(card, 100);
        return;
      }

      var pct = progressPct(ev, now);
      card.style.setProperty('--p', String(pct));
      card.classList.toggle('is-final', isFinalDay(ev, now));
      var html = timerHtml(targetMs(ev) - now);
      card.querySelectorAll('[data-timer]').forEach(function (t) { t.innerHTML = html; });
      updateDeleteContrast(card, pct);
    });

    if (needsResort) {
      sortEvents();
      renderList();
    }
  }

  function render() {
    renderCount();
    renderList();
  }

  /* ---------- Wiring ---------- */

  function init() {
    $('toggle-form').addEventListener('click', openForm);
    $('btn-cancel').addEventListener('click', closeForm);
    $('event-form').addEventListener('submit', function (e) {
      e.preventDefault();
      saveEvent();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.formOpen) closeForm();
    });

    $('btn-export').addEventListener('click', exportEvents);
    $('import-file').addEventListener('change', onImportFileChosen);
    // The Import control is a label (most reliable way to open the file
    // picker on iPhone); let Enter/Space open it from the keyboard too.
    $('btn-import').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        $('import-file').click();
      }
    });

    // Refresh immediately when returning to the tab or reopening the home-screen app
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) tickAll();
    });

    // Keep the delete button contrast right after rotation or resizing
    window.addEventListener('resize', tickAll);

    // Sync if events are changed in another tab
    window.addEventListener('storage', function (e) {
      if (e.key === STORAGE_KEY) { loadEvents(); render(); }
    });

    loadEvents();
    renderTimeZoneNote();
    render();
    setInterval(tickAll, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
