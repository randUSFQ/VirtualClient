'use strict';
(function () {
  var KEY = 'clp-admin';
  var S = { pass: '', input: '', sesiones: [], guion: null, llm: null, llmProvider: '', llmClient: '', llmEval: '', llmBusy: false, selId: null, sort: 'recientes', evaluando: null, bulk: false, confirmReopen: null, msg: '', err: '', logged: false, cargando: false };

  function H() { return { 'x-admin-password': S.pass }; }
  function nQ(s) { return s.turnos.filter(function (t) { return t.r === 'u'; }).length; }

  function cargar() {
    return api('/api/admin/sesiones', { headers: H() }).then(function (r) {
      S.sesiones = r.sesiones; S.guion = r.guion; S.logged = true;
      return api('/api/admin/llm', { headers: H() }).then(function (c) { S.llm = c; S.llmProvider = S.llmProvider || c.provider; S.llmClient = S.llmClient || c.clientModel; S.llmEval = S.llmEval || c.evalModel; });
      try { sessionStorage.setItem(KEY, S.pass); } catch (e) {}
    }).catch(function (e) {
      if (e.status === 401) { S.logged = false; S.pass = ''; try { sessionStorage.removeItem(KEY); } catch (x) {} S.err = 'Contraseña incorrecta.'; }
      else S.err = 'No se pudo cargar. Revisa la conexión.';
    }).then(render);
  }
  function configurarLLM() {
    S.llmBusy = true; S.err = ''; S.msg = ''; render();
    api('/api/admin/llm', { method: 'POST', headers: H(), body: { provider: S.llmProvider, clientModel: S.llmClient, evalModel: S.llmEval } })
      .then(function (r) { S.msg = 'Conexión correcta con ' + r.providerName + '. Configuración activa.'; S.llm.provider = r.provider; S.llm.clientModel = r.clientModel; S.llm.evalModel = r.evalModel; })
      .catch(function (e) { S.err = e.error === 'sin_clave' ? 'No hay clave configurada para ese proveedor. Agrégala al .env del servidor y reinicia la aplicación.' : 'Falló la prueba de conexión: ' + ((e.data && e.data.message) || e.error || 'revisa la clave y el modelo.'); })
      .then(function () { S.llmBusy = false; render(); });
  }
  function entrar() { S.pass = S.input; S.err = ''; S.cargando = true; render(); cargar().then(function () { S.cargando = false; render(); }); }

  function evaluar(id) {
    S.evaluando = id; S.msg = ''; S.err = ''; render();
    return api('/api/admin/evaluar/' + id, { method: 'POST', headers: H() })
      .catch(function (e) { S.err = e.error === 'llm' ? 'No se pudo evaluar (error del modelo). Intenta de nuevo.' : e.error === 'en_curso' ? 'Esa entrevista sigue en curso.' : 'No se pudo evaluar.'; })
      .then(function () { S.evaluando = null; return cargar(); });
  }
  function evaluarPendientes() {
    S.bulk = true; S.msg = ''; S.err = ''; render();
    api('/api/admin/evaluar-pendientes', { method: 'POST', headers: H() })
      .then(function (r) { S.msg = 'Evaluadas ' + r.hechas + (r.hechas === 1 ? ' entrevista' : ' entrevistas') + (r.fallidas ? '; ' + r.fallidas + ' fallaron.' : '.'); })
      .catch(function () { S.err = 'No se pudo evaluar.'; })
      .then(function () { S.bulk = false; return cargar(); });
  }
  function reabrir(id) {
    if (S.confirmReopen !== id) { S.confirmReopen = id; return render(); }
    S.confirmReopen = null;
    api('/api/admin/sesiones/' + id, { method: 'DELETE', headers: H() })
      .then(function () { S.msg = 'Entrevista reabierta: esa persona puede volver a entrevistar.'; if (S.selId === id) S.selId = null; })
      .catch(function () { S.err = 'No se pudo reabrir.'; })
      .then(cargar);
  }
  function exportar() {
    fetch('/api/admin/export.csv', { headers: H() }).then(function (r) { if (!r.ok) throw 0; return r.blob(); }).then(function (b) {
      var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'resultados-cliente-logistpulse.csv';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }).catch(function () { S.err = 'No se pudo exportar.'; render(); });
  }

  function viewLogin() {
    return el('section', { class: 'card login' },
      el('h2', { text: 'Panel docente' }),
      el('p', { class: 'lead', text: 'Escribe la contraseña de administrador definida en el archivo .env.' }),
      S.err ? el('div', { class: 'err', role: 'alert', text: S.err }) : null,
      el('label', { class: 'f', 'for': 'pw' }, 'Contraseña', el('input', { type: 'password', id: 'pw', autocomplete: 'current-password', value: S.input, oninput: function (e) { S.input = e.target.value; }, onkeydown: function (e) { if (e.key === 'Enter') entrar(); } })),
      el('div', { style: 'margin-top:14px' }, el('button', { class: 'btn primary', type: 'button', disabled: S.cargando, onclick: entrar }, S.cargando ? 'Entrando…' : 'Entrar')));
  }

  function viewPanel() {
    var prov = S.llm && S.llm.providers.find(function (p) { return p.id === S.llmProvider; });
    var llmCard = S.llm ? el('section', { class: 'card', style: 'margin-bottom:20px' },
      el('h2', { text: 'Modelo de lenguaje' }), el('p', { class: 'lead', text: 'Las claves se configuran en el servidor (.env). Elige proveedor y modelos; Guardar prueba la conexión antes de activarlos.' }),
      el('div', { class: 'toolbar' },
        el('label', { class: 'f' }, 'Proveedor', el('select', { id: 'llm-provider', value: S.llmProvider, onchange: function (e) { S.llmProvider = e.target.value; var p = S.llm.providers.find(function (x) { return x.id === S.llmProvider; }); S.llmClient = p.models[0]; S.llmEval = p.models[Math.min(1, p.models.length - 1)]; render(); } }, S.llm.providers.map(function (p) { return el('option', { value: p.id, text: p.name + (p.configured ? '' : ' · falta clave'), selected: p.id === S.llmProvider }); }))),
        el('label', { class: 'f' }, 'Modelo para entrevista', el('input', { id: 'llm-client', list: 'llm-models', value: S.llmClient, oninput: function (e) { S.llmClient = e.target.value; } })),
        el('label', { class: 'f' }, 'Modelo para evaluación', el('input', { id: 'llm-eval', list: 'llm-models', value: S.llmEval, oninput: function (e) { S.llmEval = e.target.value; } })),
        el('datalist', { id: 'llm-models' }, (prov ? prov.models : []).map(function (m) { return el('option', { value: m }); })),
        el('button', { class: 'btn primary', type: 'button', disabled: S.llmBusy, onclick: configurarLLM }, S.llmBusy ? 'Probando conexión…' : 'Probar y activar')),
      el('p', { class: 'note', text: 'Activo: ' + (S.llm.providers.find(function (p) { return p.id === S.llm.provider; }) || {}).name + ' · ' + S.llm.clientModel + ' / ' + S.llm.evalModel })) : null;
    var ses = S.sesiones.slice().sort(function (a, b) {
      if (S.sort === 'puntaje') { var ta = a.evaluacion ? a.evaluacion.total : -1, tb = b.evaluacion ? b.evaluacion.total : -1; if (tb !== ta) return tb - ta; }
      return b.inicio - a.inicio;
    });
    var pend = ses.filter(function (s) { return s.estado !== 'en_curso' && !s.evaluacion; }).length;
    var ent = ses.filter(function (s) { return s.estado === 'entregada'; }).length;
    var run = ses.filter(function (s) { return s.estado === 'en_curso'; }).length;
    var nNec = S.guion ? S.guion.necesidades.length : 10;
    var sel = ses.find(function (s) { return s.id === S.selId; });
    var rows = ses.map(function (s) {
      var e = s.evaluacion;
      return el('tr', { class: s.id === S.selId ? 'sel' : '' },
        el('td', null, el('div', { text: s.nombre }), el('div', { class: 's', style: 'font:400 12px var(--f-mono);color:var(--muted)', text: s.email })),
        el('td', { text: s.equipo }), el('td', null, chipFor(s.estado)),
        el('td', { class: 'num', text: String(nQ(s)) }),
        el('td', { class: 'num', text: e ? e.descubiertas.length + '/' + nNec : '—' }),
        el('td', { class: 'num' }, e ? el('b', { text: e.total + ' / 16' }) : '—'),
        el('td', null, el('div', { class: 'acts' },
          el('button', { class: 'btn sm', type: 'button', onclick: function () { S.selId = s.id === S.selId ? null : s.id; render(); } }, s.id === S.selId ? 'Cerrar' : 'Ver'),
          el('button', { class: 'btn sm', type: 'button', disabled: !!S.evaluando || S.bulk || s.estado === 'en_curso', onclick: function () { evaluar(s.id); } }, S.evaluando === s.id ? 'Evaluando…' : (e ? 'Reevaluar' : 'Evaluar')),
          el('button', { class: 'btn sm danger', type: 'button', onclick: function () { reabrir(s.id); } }, S.confirmReopen === s.id ? 'Confirmar' : 'Reabrir'))));
    });
    var detail = null;
    if (sel) {
      var e = sel.evaluacion, found = e ? e.descubiertas : [];
      detail = el('section', { class: 'card', style: 'margin-top:20px' },
        el('h2', { text: sel.nombre + ' · ' + sel.equipo }),
        e ? el('div', null,
          el('div', { class: 'score' },
            el('div', null, el('b', { text: e.total + ' / 16' }), el('span', { text: 'Total' })),
            el('div', null, el('b', { text: String(e.cobertura) }), el('span', { text: 'Cobertura /4' })),
            el('div', null, el('b', { text: String(e.calidad) }), el('span', { text: 'Preguntas /4' })),
            el('div', null, el('b', { text: String(e.traduccion) }), el('span', { text: 'Requisitos /4' })),
            el('div', null, el('b', { text: String(e.contradiccion) }), el('span', { text: 'Contradicción /4' }))),
          el('p', { class: 'lead', text: e.comentario || '' })) : el('p', { class: 'lead', text: 'Sin evaluar. Cuando la entrevista termine, pulsa Evaluar.' }),
        el('h3', { text: 'Guion del cliente' }),
        el('ul', { class: 'needs' }, (S.guion ? S.guion.necesidades : []).map(function (n) {
          var hit = found.indexOf(n.id) >= 0;
          return el('li', { class: e ? (hit ? 'hit' : 'miss') : '' }, el('span', { class: 'm', text: e ? (hit ? '✓' : '—') : n.tipo }), el('span', { text: (e ? '[' + n.tipo + '] ' : '') + n.texto }));
        })),
        el('h3', { text: 'Requisitos entregados' }),
        el('pre', { class: 'req', text: sel.requisitos && sel.requisitos.trim() ? sel.requisitos : '(sin entrega)' }),
        el('details', { class: 'tr' }, el('summary', { text: 'Transcripción (' + nQ(sel) + ' preguntas)' }), transcript(sel.turnos, sel.inicio, sel.nombre)));
    }
    return el('div', null, llmCard,
      el('section', { class: 'card' },
        el('div', { class: 'toolbar' },
          el('div', { class: 'stats', style: 'margin:0' },
            el('div', null, el('b', { text: String(ses.length) }), el('span', { text: 'Entrevistas' })),
            el('div', null, el('b', { text: String(run) }), el('span', { text: 'En curso' })),
            el('div', null, el('b', { text: String(ent) }), el('span', { text: 'Entregadas' }))),
          el('div', { class: 'acts' },
            el('div', { class: 'seg', role: 'group', 'aria-label': 'Orden' },
              el('button', { type: 'button', 'aria-pressed': String(S.sort === 'recientes'), onclick: function () { S.sort = 'recientes'; render(); } }, 'Recientes'),
              el('button', { type: 'button', 'aria-pressed': String(S.sort === 'puntaje'), onclick: function () { S.sort = 'puntaje'; render(); } }, 'Mejor puntaje')),
            el('button', { class: 'btn primary', type: 'button', disabled: !pend || S.bulk || !!S.evaluando, onclick: evaluarPendientes }, S.bulk ? 'Evaluando…' : 'Evaluar pendientes' + (pend ? ' (' + pend + ')' : '')),
            el('button', { class: 'btn', type: 'button', disabled: !ses.length, onclick: exportar }, 'Exportar CSV'),
            el('button', { class: 'btn', type: 'button', onclick: function () { S.msg = ''; S.err = ''; cargar(); } }, 'Actualizar'))),
        S.msg ? el('div', { class: 'okmsg', role: 'status', text: S.msg }) : null,
        S.err ? el('div', { class: 'err', role: 'alert', text: S.err }) : null,
        ses.length ? el('div', { class: 'tbl' }, el('table', null,
          el('thead', null, el('tr', null, el('th', { text: 'Participante' }), el('th', { text: 'Equipo' }), el('th', { text: 'Estado' }), el('th', { class: 'num', text: 'Preg.' }), el('th', { class: 'num', text: 'Necesid.' }), el('th', { class: 'num', text: 'Total' }), el('th', { text: 'Acciones' }))),
          el('tbody', null, rows)))
          : el('p', { class: 'empty', text: 'Aún no hay entrevistas. Aparecerán aquí en cuanto alguien comience.' })),
      detail);
  }

  function render() {
    var root = document.getElementById('app');
    var ae = document.activeElement, fid = ae && ae.id;
    root.replaceChildren(
      el('header', { class: 'top' }, el('div', { class: 'brand' }, el('h1', { text: 'Panel docente' }), el('p', { text: 'Cliente LOGISTPULSE · entrevistas y puntajes' })),
        el('a', { href: '/', class: 'btn sm', style: 'text-decoration:none' }, 'Ir a la entrevista')),
      S.logged ? viewPanel() : viewLogin());
    root.removeAttribute('aria-busy');
    if (fid) { var n = document.getElementById(fid); if (n) n.focus(); }
  }

  try { S.pass = sessionStorage.getItem(KEY) || ''; } catch (e) {}
  render();
  if (S.pass) cargar();
  setInterval(function () { if (S.logged && !S.evaluando && !S.bulk) cargar(); }, 15000);
})();
