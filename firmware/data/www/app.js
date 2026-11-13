(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let lastEpoch = 0;

  function badge(id, text, cls) {
    const el = $(id);
    el.textContent = text;
    el.className = 'badge ' + cls;
  }

  function fmtTime(epoch) {
    if (!epoch) return 'syncing...';
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'medium'
      }).format(new Date(epoch * 1000));
    } catch (e) {
      return new Date(epoch * 1000).toUTCString();
    }
  }

  function tickClock() {
    $('clock').textContent = fmtTime(lastEpoch);
  }

  function render(s) {
    lastEpoch = s.time || 0;
    document.title = s.status === 'FIRE' ? 'FIRE - ' + (s.room || '') : 'Smart Classroom - Local Status';
    $('banner').classList.toggle('show', s.status === 'FIRE');
    $('room').textContent = s.room || '(unset)';
    badge('status', s.status, s.status === 'SAFE' ? 'ok' : (s.status === 'WARNING' ? 'warn' : 'bad'));
    $('temp').textContent = s.temp_c == null ? '--' : s.temp_c.toFixed(1) + ' C';
    $('rh').textContent = s.rh == null ? '--' : s.rh.toFixed(0) + ' %';
    $('hi').textContent = s.heat_index_c == null ? '--' : s.heat_index_c.toFixed(1) + ' C';
    $('trend').textContent = s.trend || 'UNKNOWN';
    badge('flame', s.flame ? 'FLAME' : 'Clear', s.flame ? 'bad' : 'ok');
    badge('door', s.door, s.door === 'UNLOCKED' ? 'warn' : 'ok');
    $('card').textContent = s.last_card_uid === 'none' ? 'none' : s.last_card_uid + ' (' + s.last_card_role + ')';
    $('rssi').textContent = s.wifi ? s.rssi + ' dBm' : 'offline';
    $('chip').textContent = s.chip_temp_c == null ? '--' : s.chip_temp_c.toFixed(1) + ' C';
    $('fw').textContent = s.fw;
    $('ip').textContent = s.ip || '--';
    $('host').textContent = s.host || '--';
    $('devid').textContent = s.device_id;
    $('uptime').textContent = s.uptime_s + ' s';
    $('conn').textContent = s.wifi
      ? 'Wi-Fi connected' + (s.backend ? ' - cloud online' : ' - cloud offline (buffering)')
      : 'Wi-Fi offline';
    $('foot').textContent = 'Panic: ' + (s.panic ? 'ACTIVE' : 'clear') +
      ' | Fire latch: ' + (s.fire_latched ? 'latched' : 'clear') +
      ' | Quality: ' + s.quality +
      ' | Reset reason: ' + s.reset_reason +
      ' | Heap: ' + s.heap_kb + ' KB' +
      ' | Spool: ' + s.spool;
    tickClock();
  }

  async function poll() {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      render(await res.json());
    } catch (err) {
      $('conn').textContent = 'Local page connection lost (' + err.message + ')';
    }
  }

  poll();
  setInterval(poll, 2000);
  setInterval(tickClock, 1000);
})();
