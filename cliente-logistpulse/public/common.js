'use strict';
/* Utilidades compartidas por las páginas de estudiante y docente. */
function el(tag, props) {
  var n = document.createElement(tag);
  if (props) for (var k in props) {
    var v = props[k]; if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'value') n.value = v;
    else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (var i = 2; i < arguments.length; i++) {
    var c = arguments[i];
    (Array.isArray(c) ? c : [c]).forEach(function (x) { if (x == null || x === false) return; n.append(x.nodeType ? x : document.createTextNode(String(x))); });
  }
  return n;
}
function mmss(sec) { sec = Math.max(0, Math.round(sec)); return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0'); }
function hhmm(ts) { try { return new Date(ts).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
var ESTADO = { en_curso: ['En curso', 'run'], completada: ['Terminó', 'done'], entregada: ['Entregó', 'sent'] };
function chipFor(est) { var e = ESTADO[est] || ['—', '']; return el('span', { class: 'chip ' + e[1] }, est === 'en_curso' ? el('span', { class: 'pulse' }) : null, e[0]); }
function transcript(turnos, inicio, nombre) {
  return el('div', { class: 'log', role: 'log' }, (turnos || []).map(function (t) {
    return el('div', { class: 'msg ' + t.r },
      el('div', { class: 'meta', text: (t.r === 'u' ? (nombre || 'Tú') : 'Marcela') + ' · ' + mmss(((t.ts || inicio) - inicio) / 1000) }),
      el('div', { class: 'b', text: t.t }));
  }));
}
/* fetch JSON; rechaza con {status, error, data} */
function api(path, opts) {
  opts = opts || {};
  var headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  return fetch(path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
    .then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) throw { status: r.status, error: data.error || 'error', data: data };
        return data;
      });
    });
}
