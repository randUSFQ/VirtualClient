'use strict';
(function () {
  var KEY = 'clp-sesion';
  var S = {
    cfg: null, reg: [], token: null, sesion: null, endsAt: 0, timerId: null,
    form: { email: '', nombre: '', equipo: '', codigo: '' }, draft: '', req: '',
    busy: false, err: '', confirmEnd: false, cargando: true, delivering: false
  };

  function guardarToken() { try { localStorage.setItem(KEY, JSON.stringify({ token: S.token, email: S.form.email })); } catch (e) {} }
  function leerToken() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function limpiarToken() { try { localStorage.removeItem(KEY); } catch (e) {} }

  function aplicar(sesion) {
    S.sesion = sesion;
    S.endsAt = Date.now() + (sesion.restante || 0) * 1000;
    if (sesion.estado === 'en_curso') startTimer(); else stopTimer();
  }
  function startTimer() { stopTimer(); tick(); S.timerId = setInterval(tick, 250); }
  function stopTimer() { if (S.timerId) { clearInterval(S.timerId); S.timerId = null; } }
  function left() { return Math.max(0, Math.ceil((S.endsAt - Date.now()) / 1000)); }
  function tick() {
    var l = left(), d = S.sesion ? S.sesion.duracion : 360;
    var c = document.getElementById('clock'); if (c) c.textContent = mmss(l);
    var b = document.getElementById('bar'); if (b) b.style.width = (l / d * 100) + '%';
    var w = document.getElementById('clockwrap'); if (w) w.classList.toggle('low', l <= 60);
    if (l <= 0 && S.sesion && S.sesion.estado === 'en_curso' && !S.busy) refrescar();
  }
  function refrescar() {
    return api('/api/sesion', { headers: { 'x-token': S.token } })
      .then(function (r) { aplicar(r.sesion); })
      .catch(function (e) { if (e.status === 401) { S.token = null; S.sesion = null; limpiarToken(); } })
      .then(render);
  }
  function cargarRegistro() { return api('/api/registro').then(function (r) { S.reg = r; }).catch(function () {}).then(render); }

  /* ---------- acciones ---------- */
  function entrar() {
    var f = S.form;
    if (!f.email.trim() || !f.nombre.trim() || !f.equipo.trim()) { S.err = 'Completa correo, nombre y equipo.'; return render(); }
    S.busy = true; S.err = ''; render();
    var guardado = leerToken();
    var token = guardado && guardado.email === f.email.trim().toLowerCase() ? guardado.token : undefined;
    api('/api/entrar', { method: 'POST', body: { email: f.email, nombre: f.nombre, equipo: f.equipo, codigo: f.codigo, token: token } })
      .then(function (r) { S.token = r.token; S.form.email = f.email.trim().toLowerCase(); guardarToken(); aplicar(r.sesion); S.err = ''; })
      .catch(function (e) {
        var m = {
          correo: 'Escribe un correo válido.',
          dominio: 'Usa tu correo institucional' + (e.data && e.data.dominio ? ' (@' + e.data.dominio + ')' : '') + '.',
          campos: 'Completa correo, nombre y equipo.',
          codigo: 'El código de clase no es correcto. Pídelo al docente.',
          ya_existe: 'Ya existe una entrevista con ese correo. Si eres tú y cambiaste de dispositivo o borraste los datos del navegador, pide al docente que la reabra.',
          demasiados_intentos: 'Demasiados intentos. Espera unos minutos.'
        };
        S.err = m[e.error] || 'No se pudo entrar. Revisa tu conexión e intenta de nuevo.';
      })
      .then(function () { S.busy = false; render(); cargarRegistro(); });
  }
  function preguntar() {
    var texto = S.draft.trim();
    if (S.busy || !texto || !S.sesion || S.sesion.estado !== 'en_curso') return;
    var previo = S.sesion;
    // Muestra la pregunta de inmediato; el servidor devuelve el estado oficial.
    S.sesion = Object.assign({}, previo, { turnos: previo.turnos.concat([{ r: 'u', t: texto, ts: Date.now() }]) });
    S.draft = ''; S.busy = true; S.err = ''; S.confirmEnd = false; render();
    api('/api/preguntar', { method: 'POST', headers: { 'x-token': S.token }, body: { texto: texto } })
      .then(function (r) { aplicar(r.sesion); })
      .catch(function (e) {
        S.sesion = previo; S.draft = texto;
        if (e.error === 'terminada' && e.data && e.data.sesion) { aplicar(e.data.sesion); S.draft = ''; S.err = 'Se acabó el tiempo.'; }
        else if (e.error === 'ocupada') S.err = 'Espera la respuesta de Marcela antes de preguntar de nuevo.';
        else if (e.error === 'limite') S.err = 'Llegaste al máximo de preguntas.';
        else if (e.status === 401) { S.token = null; limpiarToken(); S.err = 'Tu sesión ya no existe. Avisa al docente.'; }
        else S.err = 'No se pudo contactar a la clienta. Tu pregunta sigue en el cuadro; envíala de nuevo.';
      })
      .then(function () { S.busy = false; render(); if (S.sesion && S.sesion.estado === 'en_curso' && left() <= 0) refrescar(); cargarRegistro(); });
  }
  function terminar() {
    api('/api/terminar', { method: 'POST', headers: { 'x-token': S.token } })
      .then(function (r) { aplicar(r.sesion); S.confirmEnd = false; })
      .catch(function () { S.err = 'No se pudo terminar. Intenta de nuevo.'; })
      .then(function () { render(); cargarRegistro(); });
  }
  function entregar() {
    if (!S.req.trim()) { S.err = 'Escribe al menos un requisito antes de entregar.'; return render(); }
    S.delivering = true; S.err = ''; render();
    api('/api/entregar', { method: 'POST', headers: { 'x-token': S.token }, body: { requisitos: S.req } })
      .then(function (r) { aplicar(r.sesion); })
      .catch(function (e) { S.err = e.error === 'ya_entregada' ? 'Ya habías entregado.' : 'No se pudo guardar la entrega. Intenta de nuevo.'; })
      .then(function () { S.delivering = false; render(); cargarRegistro(); });
  }

  /* ---------- vistas ---------- */
  function rosterCard() {
    var list = S.reg.slice().sort(function (a, b) { return b.inicio - a.inicio; });
    return el('aside', { class: 'card', 'aria-label': 'Registro de entrevistas' },
      el('div', { class: 'rhead' }, el('h3', { text: 'Ya entrevistaron' }), el('span', { class: 'chip', text: String(list.length) })),
      list.length ? el('ul', { class: 'roster' }, list.map(function (r) {
        return el('li', null,
          el('div', null, el('div', { class: 'n', text: r.nombre }), el('div', { class: 's', text: r.equipo + ' · ' + hhmm(r.inicio) })),
          chipFor(r.estado));
      })) : el('p', { class: 'empty', text: 'Nadie ha entrevistado todavía. Quien lo haga queda registrado aquí y no puede repetir.' }));
  }
  function viewEntrar() {
    var f = S.form, c = S.cfg || {};
    return el('section', { class: 'card' },
      el('h2', { text: 'Entrevista a Marcela Paredes' }),
      el('p', { class: 'lead', text: 'Jefa de operaciones de un centro de distribución en Quito. Quiere implantar LOGISTPULSE para coordinar sus pedidos y su flota de robots. Descubre qué necesita realmente.' }),
      el('ul', { class: 'rules' },
        el('li', null, el('span', { class: 'k', text: '01' }), el('span', { text: 'Tienes ' + Math.round((c.duracion || 360) / 60) + ' minutos desde que pulsas Comenzar. El cronómetro no se detiene.' })),
        el('li', null, el('span', { class: 'k', text: '02' }), el('span', { text: 'Solo hay una entrevista por correo. Si recargas la página, retomas la misma sin reiniciar el tiempo.' })),
        el('li', null, el('span', { class: 'k', text: '03' }), el('span', { text: 'Al terminar entregas los requisitos que descubriste, cada uno con su letra FURPS.' }))),
      S.err ? el('div', { class: 'err', role: 'alert', text: S.err }) : null,
      el('div', { class: 'fields' },
        el('label', { class: 'f', 'for': 'f-email' }, 'Correo' + (c.dominio ? ' institucional' : ''), el('input', { type: 'text', id: 'f-email', inputmode: 'email', autocomplete: 'email', maxlength: '120', value: f.email, oninput: function (e) { f.email = e.target.value; } })),
        el('label', { class: 'f', 'for': 'f-nombre' }, 'Tu nombre', el('input', { type: 'text', id: 'f-nombre', autocomplete: 'name', maxlength: '60', value: f.nombre, oninput: function (e) { f.nombre = e.target.value; } })),
        el('label', { class: 'f', 'for': 'f-equipo' }, 'Tu equipo', el('input', { type: 'text', id: 'f-equipo', maxlength: '40', value: f.equipo, oninput: function (e) { f.equipo = e.target.value; } })),
        c.pideCodigo ? el('label', { class: 'f', 'for': 'f-codigo' }, 'Código de clase', el('input', { type: 'text', id: 'f-codigo', autocomplete: 'off', maxlength: '40', value: f.codigo, oninput: function (e) { f.codigo = e.target.value; } })) : null),
      el('button', { class: 'btn primary', type: 'button', disabled: S.busy, onclick: entrar }, S.busy ? 'Entrando…' : 'Comenzar entrevista'),
      el('p', { class: 'note', text: 'No necesitas cuenta de Claude. Si ya empezaste y recargaste la página, escribe el mismo correo para retomar.' }));
  }
  function viewEntrevista() {
    var s = S.sesion, l = left(), d = s.duracion;
    var log = el('div', { class: 'log', id: 'log', role: 'log', 'aria-live': 'polite' }, s.turnos.map(function (t) {
      return el('div', { class: 'msg ' + t.r },
        el('div', { class: 'meta', text: (t.r === 'u' ? 'Tú' : 'Marcela') + ' · ' + mmss((t.ts - s.inicio) / 1000) }),
        el('div', { class: 'b', text: t.t }));
    }).concat(S.busy ? [el('div', { class: 'typing', text: 'Marcela está respondiendo…' })] : []));
    var n = s.turnos.filter(function (t) { return t.r === 'u'; }).length;
    return el('section', { class: 'card' },
      el('div', { class: 'callhead' },
        el('div', { class: 'who' }, el('div', { class: 'avatar', 'aria-hidden': 'true', text: 'MP' }), el('div', null, el('b', { text: 'Marcela Paredes' }), el('span', { text: 'Jefa de operaciones' }))),
        el('div', { class: 'clock' + (l <= 60 ? ' low' : ''), id: 'clockwrap' }, el('div', { class: 't', id: 'clock', text: mmss(l), role: 'timer' }), el('div', { class: 'lbl', text: 'Tiempo restante' }))),
      el('div', { class: 'meter', 'aria-hidden': 'true' }, el('i', { id: 'bar', style: 'width:' + (l / d * 100) + '%' })),
      S.err ? el('div', { class: 'err', role: 'alert', text: S.err }) : null,
      log,
      el('div', { class: 'composer' },
        el('textarea', { id: 'q', rows: '2', maxlength: '500', 'aria-label': 'Tu pregunta', placeholder: 'Escribe tu pregunta a Marcela…', value: S.draft, disabled: S.busy,
          oninput: function (e) { S.draft = e.target.value; },
          onkeydown: function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); preguntar(); } } }),
        el('button', { class: 'btn primary', type: 'button', disabled: S.busy, onclick: preguntar }, 'Preguntar')),
      el('div', { class: 'endrow' },
        el('span', { text: n + (n === 1 ? ' pregunta' : ' preguntas') + ' · Enter envía, Shift+Enter salta de línea' }),
        S.confirmEnd
          ? el('span', { class: 'acts' }, el('button', { class: 'btn sm danger', type: 'button', onclick: terminar }, 'Sí, terminar'), el('button', { class: 'btn sm', type: 'button', onclick: function () { S.confirmEnd = false; render(); } }, 'Seguir'))
          : el('button', { class: 'btn sm', type: 'button', onclick: function () { S.confirmEnd = true; render(); } }, 'Terminar ahora')));
  }
  function viewEntrega() {
    var s = S.sesion, sent = s.estado === 'entregada';
    var dur = s.fin ? mmss((s.fin - s.inicio) / 1000) : '—';
    return el('section', { class: 'card' },
      el('h2', { text: sent ? 'Entrega registrada' : 'Entrevista terminada' }),
      el('p', { class: 'lead', text: sent ? 'Tu entrevista y tus requisitos ya están con el docente.' : 'Ahora escribe los requisitos que descubriste. Una línea por requisito, con su letra FURPS y, cuando puedas, un número que lo haga medible.' }),
      el('div', { class: 'stats' }, el('div', null, el('b', { text: String(s.preguntas) }), el('span', { text: 'Preguntas' })), el('div', null, el('b', { text: dur }), el('span', { text: 'Duración' }))),
      el('details', { class: 'tr' }, el('summary', { text: 'Ver transcripción' }), transcript(s.turnos, s.inicio, 'Tú')),
      S.err ? el('div', { class: 'err', role: 'alert', text: S.err }) : null,
      sent
        ? [el('h3', { text: 'Requisitos entregados' }), el('pre', { class: 'req', text: s.requisitos || '' }), el('div', { class: 'okmsg', text: 'Entregado a las ' + hhmm(s.entregado) + '. Ya no se puede editar.' })]
        : [el('label', { class: 'f', 'for': 'req' }, 'Requisitos descubiertos',
            el('textarea', { id: 'req', rows: '7', maxlength: '4000', placeholder: 'F — El supervisor ve en un mapa qué robot lleva cada pedido, en vivo\nR — Si un robot falla, el pedido se reasigna en menos de 10 s\n…', value: S.req, oninput: function (e) { S.req = e.target.value; } })),
           el('div', { style: 'margin-top:12px' }, el('button', { class: 'btn primary', type: 'button', disabled: S.delivering, onclick: entregar }, S.delivering ? 'Guardando…' : 'Entregar requisitos'))]);
  }

  function render() {
    var root = document.getElementById('app');
    var ae = document.activeElement, fid = ae && ae.id, ss = ae && ae.selectionStart, se = ae && ae.selectionEnd;
    var main;
    if (S.cargando) main = el('section', { class: 'card' }, el('h2', { text: 'Un momento' }), el('p', { class: 'lead', text: 'Conectando…' }));
    else if (!S.sesion) main = viewEntrar();
    else if (S.sesion.estado === 'en_curso') main = viewEntrevista();
    else main = viewEntrega();
    root.replaceChildren(
      el('header', { class: 'top' }, el('div', { class: 'brand' }, el('h1', { text: 'Cliente LOGISTPULSE' }), el('p', { text: 'Elicitación de requisitos · una entrevista por persona' }))),
      el('div', { class: 'grid' }, main, rosterCard()));
    root.removeAttribute('aria-busy');
    if (fid) { var n = document.getElementById(fid); if (n && !n.disabled) { n.focus(); try { if (ss != null) n.setSelectionRange(ss, se); } catch (e) {} } }
    var lg = document.getElementById('log'); if (lg) lg.scrollTop = lg.scrollHeight;
    if (S.sesion && S.sesion.estado === 'en_curso') { tick(); if (!fid && !S.busy) { var q = document.getElementById('q'); if (q) q.focus(); } }
  }

  /* ---------- arranque ---------- */
  var guardado = leerToken();
  if (guardado) { S.token = guardado.token; S.form.email = guardado.email || ''; }
  render();
  api('/api/config').then(function (c) { S.cfg = c; }).catch(function () {})
    .then(function () { return S.token ? api('/api/sesion', { headers: { 'x-token': S.token } }).then(function (r) { aplicar(r.sesion); }).catch(function () { S.token = null; limpiarToken(); }) : null; })
    .then(function () { S.cargando = false; render(); return cargarRegistro(); });
  setInterval(cargarRegistro, 10000);
})();
