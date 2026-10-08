'use strict';
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { abrir } = require('./db');
const { crear, MODELOS, ETIQUETAS } = require('./llm');
const prompts = require('./prompts');

function cfgDesdeEnv(env = process.env) {
  const keys = { openai: env.OPENAI_API_KEY || '', gemini: env.GEMINI_API_KEY || '', anthropic: env.ANTHROPIC_API_KEY || '' };
  return {
    port: Number(env.PORT) || 3000,
    dbPath: env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db'),
    adminPassword: env.ADMIN_PASSWORD || '',
    accessCode: env.ACCESS_CODE || '',
    domain: (env.ALLOWED_EMAIL_DOMAIN || '').toLowerCase().replace(/^@/, ''),
    duracion: Number(env.DURACION_SEG) || 360,
    maxPreguntas: Number(env.MAX_PREGUNTAS) || 40,
    mock: env.MOCK_LLM === '1',
    provider: env.LLM_PROVIDER || (keys.anthropic ? 'anthropic' : keys.openai ? 'openai' : keys.gemini ? 'gemini' : 'anthropic'),
    keys,
    clientModel: env.CLIENT_MODEL || 'claude-3-5-haiku-latest',
    evalModel: env.EVAL_MODEL || 'claude-3-7-sonnet-latest',
  };
}

const safeEqual = (a, b) => {
  const h = x => crypto.createHash('sha256').update(String(x)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
};

function crearApp(cfg, inyectado = {}) {
  if (!cfg.adminPassword || cfg.adminPassword.length < 6) throw new Error('Define ADMIN_PASSWORD (mínimo 6 caracteres).');
  if (!cfg.mock && !Object.values(cfg.keys || {}).some(Boolean) && !inyectado.llm) throw new Error('Define OPENAI_API_KEY, GEMINI_API_KEY o ANTHROPIC_API_KEY; también puedes usar MOCK_LLM=1.');

  const guion = JSON.parse(fs.readFileSync(path.join(__dirname, 'guion.json'), 'utf8'));
  const db = abrir(cfg.dbPath);
  const active = { provider: cfg.provider, clientModel: cfg.clientModel, evalModel: cfg.evalModel };
  const getLlm = () => inyectado.llm || crear({ mock: cfg.mock, provider: active.provider, apiKey: cfg.keys?.[active.provider], clientModel: active.clientModel, evalModel: active.evalModel, guion });
  const llm = { cliente: (...a) => getLlm().cliente(...a), evaluar: (...a) => getLlm().evaluar(...a) };

  const q = {
    porEmail: db.prepare('SELECT * FROM sesiones WHERE email = ?'),
    porToken: db.prepare('SELECT * FROM sesiones WHERE token = ?'),
    porId: db.prepare('SELECT * FROM sesiones WHERE id = ?'),
    todas: db.prepare('SELECT * FROM sesiones ORDER BY inicio DESC'),
    insertar: db.prepare('INSERT INTO sesiones (email, nombre, equipo, token, estado, inicio, turnos) VALUES (?,?,?,?,?,?,?)'),
    guardar: db.prepare('UPDATE sesiones SET estado=?, fin=?, motivo=?, turnos=?, requisitos=?, entregado=?, evaluacion=? WHERE id=?'),
    borrar: db.prepare('DELETE FROM sesiones WHERE id = ?'),
  };
  const fila = r => r && Object.assign({}, r, { turnos: JSON.parse(r.turnos), evaluacion: r.evaluacion ? JSON.parse(r.evaluacion) : null });
  const guardar = s => q.guardar.run(s.estado, s.fin ?? null, s.motivo ?? null, JSON.stringify(s.turnos), s.requisitos || '', s.entregado ?? null, s.evaluacion ? JSON.stringify(s.evaluacion) : null, s.id);

  const restante = s => Math.max(0, Math.ceil((s.inicio + cfg.duracion * 1000 - Date.now()) / 1000));
  const nPreguntas = s => s.turnos.filter(t => t.r === 'u').length;

  function cerrar(s, motivo) {
    const fin = motivo === 'tiempo' ? s.inicio + cfg.duracion * 1000 : Date.now();
    s.turnos.push({ r: 'c', t: guion.cierre, ts: fin });
    s.estado = 'completada'; s.fin = fin; s.motivo = motivo;
    guardar(s);
  }
  function cerrarSiVencida(s) {
    if (s.estado === 'en_curso' && restante(s) === 0) cerrar(s, 'tiempo');
    return s;
  }
  const vista = s => ({
    nombre: s.nombre, equipo: s.equipo, estado: s.estado, inicio: s.inicio, fin: s.fin ?? null,
    duracion: cfg.duracion, restante: s.estado === 'en_curso' ? restante(s) : 0,
    turnos: s.turnos, preguntas: nPreguntas(s), requisitos: s.requisitos, entregado: s.entregado ?? null,
  });

  // Historial para el modelo: sin el saludo inicial, roles alternados y empezando por el estudiante.
  function mensajes(turnos) {
    const out = [];
    for (const t of turnos.slice(1)) {
      const role = t.r === 'u' ? 'user' : 'assistant';
      if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += '\n' + t.t;
      else out.push({ role, content: t.t });
    }
    while (out.length && out[0].role !== 'user') out.shift();
    return out;
  }

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '20kb' }));
  app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'no-referrer'); next(); });

  const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => { console.error(e); res.status(500).json({ error: 'interno' }); });

  // Limitador sencillo por IP para /api/entrar (el salón suele compartir una sola IP, por eso el tope es alto).
  const intentos = new Map();
  function limitarEntrar(req, res, next) {
    const ahora = Date.now(), ventana = 10 * 60 * 1000;
    const lista = (intentos.get(req.ip) || []).filter(t => ahora - t < ventana);
    if (lista.length >= 150) return res.status(429).json({ error: 'demasiados_intentos' });
    lista.push(ahora); intentos.set(req.ip, lista);
    next();
  }

  // ---------- estudiantes ----------
  app.get('/api/config', (_req, res) => res.json({ duracion: cfg.duracion, pideCodigo: !!cfg.accessCode, dominio: cfg.domain || null, saludo: guion.saludo }));

  app.get('/api/registro', (_req, res) => {
    const lista = q.todas.all().map(fila).map(cerrarSiVencida);
    res.json(lista.map(s => ({ nombre: s.nombre, equipo: s.equipo, estado: s.estado, inicio: s.inicio })));
  });

  app.post('/api/entrar', limitarEntrar, (req, res) => {
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase().slice(0, 120);
    const nombre = String(b.nombre || '').trim().slice(0, 60);
    const equipo = String(b.equipo || '').trim().slice(0, 40);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'correo' });
    if (cfg.domain && !email.endsWith('@' + cfg.domain)) return res.status(400).json({ error: 'dominio', dominio: cfg.domain });
    const ex = fila(q.porEmail.get(email));
    if (ex && b.token && safeEqual(b.token, ex.token)) {
      cerrarSiVencida(ex);
      return res.json({ token: ex.token, sesion: vista(ex) });
    }
    if (!nombre || !equipo) return res.status(400).json({ error: 'campos' });
    if (cfg.accessCode && !safeEqual(b.codigo || '', cfg.accessCode)) return res.status(403).json({ error: 'codigo' });
    if (ex) return res.status(409).json({ error: 'ya_existe' });
    const token = crypto.randomBytes(24).toString('hex');
    const inicio = Date.now();
    try {
      q.insertar.run(email, nombre, equipo, token, 'en_curso', inicio, JSON.stringify([{ r: 'c', t: guion.saludo, ts: inicio }]));
    } catch (e) {
      if (/UNIQUE|constraint/i.test(String(e.message))) return res.status(409).json({ error: 'ya_existe' });
      throw e;
    }
    res.json({ token, sesion: vista(fila(q.porEmail.get(email))) });
  });

  function auth(req, res, next) {
    const token = req.get('x-token') || '';
    const s = token ? fila(q.porToken.get(token)) : null;
    if (!s) return res.status(401).json({ error: 'sin_sesion' });
    req.s = cerrarSiVencida(s);
    next();
  }

  app.get('/api/sesion', auth, (req, res) => res.json({ sesion: vista(req.s) }));

  const ocupadas = new Set();
  app.post('/api/preguntar', auth, wrap(async (req, res) => {
    const s = req.s;
    if (s.estado !== 'en_curso') return res.status(409).json({ error: 'terminada', sesion: vista(s) });
    const texto = typeof (req.body || {}).texto === 'string' ? req.body.texto.trim().slice(0, 500) : '';
    if (!texto) return res.status(400).json({ error: 'vacia' });
    if (nPreguntas(s) >= cfg.maxPreguntas) return res.status(429).json({ error: 'limite' });
    if (ocupadas.has(s.id)) return res.status(429).json({ error: 'ocupada' });
    ocupadas.add(s.id);
    try {
      const turnoU = { r: 'u', t: texto, ts: Date.now() };
      let reply;
      try {
        reply = await llm.cliente(prompts.sistemaCliente(guion), mensajes([...s.turnos, turnoU]));
      } catch (e) {
        console.error('LLM:', e.message);
        return res.status(502).json({ error: 'llm' });
      }
      const fresco = fila(q.porId.get(s.id));
      if (!fresco || fresco.estado !== 'en_curso') return res.status(409).json({ error: 'terminada', sesion: fresco && vista(fresco) });
      fresco.turnos.push(turnoU, { r: 'c', t: String(reply).slice(0, 800), ts: Date.now() });
      guardar(fresco);
      cerrarSiVencida(fresco);
      res.json({ sesion: vista(fresco) });
    } finally { ocupadas.delete(s.id); }
  }));

  app.post('/api/terminar', auth, (req, res) => {
    if (req.s.estado === 'en_curso') cerrar(req.s, 'manual');
    res.json({ sesion: vista(req.s) });
  });

  app.post('/api/entregar', auth, (req, res) => {
    const s = req.s;
    if (s.estado === 'en_curso') return res.status(409).json({ error: 'en_curso' });
    if (s.estado === 'entregada') return res.status(409).json({ error: 'ya_entregada', sesion: vista(s) });
    const requisitos = typeof (req.body || {}).requisitos === 'string' ? req.body.requisitos.trim().slice(0, 4000) : '';
    if (!requisitos) return res.status(400).json({ error: 'vacia' });
    s.requisitos = requisitos; s.entregado = Date.now(); s.estado = 'entregada';
    guardar(s);
    res.json({ sesion: vista(s) });
  });

  // ---------- docente ----------
  function admin(req, res, next) {
    if (!safeEqual(req.get('x-admin-password') || '', cfg.adminPassword)) return res.status(401).json({ error: 'no_autorizado' });
    next();
  }
  const adminVista = s => Object.assign(vista(s), { id: s.id, email: s.email, motivo: s.motivo ?? null, evaluacion: s.evaluacion });

  app.get('/api/admin/llm', admin, (_req, res) => res.json({ provider: active.provider, clientModel: active.clientModel, evalModel: active.evalModel,
    providers: Object.keys(MODELOS).map(id => ({ id, name: ETIQUETAS[id], models: MODELOS[id], configured: !!cfg.keys?.[id] })) }));
  app.post('/api/admin/llm', admin, wrap(async (req, res) => {
    const b = req.body || {}, provider = String(b.provider || ''), clientModel = String(b.clientModel || '').trim(), evalModel = String(b.evalModel || '').trim();
    if (!MODELOS[provider]) return res.status(400).json({ error: 'proveedor' });
    if (!cfg.keys?.[provider]) return res.status(400).json({ error: 'sin_clave', provider: ETIQUETAS[provider] });
    if (!clientModel || !evalModel || clientModel.length > 100 || evalModel.length > 100) return res.status(400).json({ error: 'modelo' });
    const candidate = crear({ mock: false, provider, apiKey: cfg.keys[provider], clientModel, evalModel, guion });
    try { await candidate.probar(); } catch (e) { return res.status(502).json({ error: 'conexion', message: String(e.message).slice(0, 300) }); }
    active.provider = provider; active.clientModel = clientModel; active.evalModel = evalModel;
    res.json({ ok: true, provider, providerName: ETIQUETAS[provider], clientModel, evalModel });
  }));

  app.get('/api/admin/sesiones', admin, (_req, res) => {
    res.json({ sesiones: q.todas.all().map(fila).map(cerrarSiVencida).map(adminVista), guion: { necesidades: guion.necesidades.map(({ id, tipo, texto }) => ({ id, tipo, texto })), contradiccion: guion.contradiccion } });
  });

  async function evaluarSesion(s) {
    const ev = await llm.evaluar(prompts.promptEvaluacion(guion, s));
    const validos = guion.necesidades.map(n => n.id);
    let ids = (Array.isArray(ev.descubiertas) ? ev.descubiertas : []).map(Number);
    ids = ids.filter((x, i) => validos.includes(x) && ids.indexOf(x) === i);
    const acota = (v, max) => Math.max(0, Math.min(max, Number(v) || 0));
    const calidad = acota(ev.calidad_preguntas, 4), traduccion = acota(ev.traduccion_requisitos, 4);
    const cobertura = Math.round(Math.min(ids.length / 6, 1) * 4 * 10) / 10;
    const contradiccion = ev.contradiccion_detectada ? 4 : 0;
    const evaluacion = {
      descubiertas: ids, preguntas: ev.preguntas || {}, calidad, traduccion, cobertura, contradiccion,
      total: Math.round((calidad + traduccion + cobertura + contradiccion) * 10) / 10,
      comentario: String(ev.comentario || '').slice(0, 600), ts: Date.now(),
    };
    const fresco = fila(q.porId.get(s.id));
    fresco.evaluacion = evaluacion; guardar(fresco);
    return evaluacion;
  }

  app.post('/api/admin/evaluar/:id', admin, wrap(async (req, res) => {
    const s = fila(q.porId.get(Number(req.params.id)));
    if (!s) return res.status(404).json({ error: 'no_existe' });
    cerrarSiVencida(s);
    if (s.estado === 'en_curso') return res.status(409).json({ error: 'en_curso' });
    try { res.json({ evaluacion: await evaluarSesion(s) }); }
    catch (e) { console.error('Evaluación:', e.message); res.status(502).json({ error: 'llm' }); }
  }));

  app.post('/api/admin/evaluar-pendientes', admin, wrap(async (_req, res) => {
    const pendientes = q.todas.all().map(fila).map(cerrarSiVencida).filter(s => s.estado !== 'en_curso' && !s.evaluacion);
    let hechas = 0, fallidas = 0;
    for (const s of pendientes) { try { await evaluarSesion(s); hechas++; } catch (e) { console.error('Evaluación:', e.message); fallidas++; } }
    res.json({ hechas, fallidas });
  }));

  app.delete('/api/admin/sesiones/:id', admin, (req, res) => {
    const r = q.borrar.run(Number(req.params.id));
    res.json({ borradas: r.changes });
  });

  app.get('/api/admin/export.csv', admin, (_req, res) => {
    const celda = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const filas = [['Nombre', 'Correo', 'Equipo', 'Estado', 'Preguntas', 'Duracion (s)', 'Necesidades descubiertas', 'Cobertura /4', 'Calidad preguntas /4', 'Requisitos /4', 'Contradiccion /4', 'Total /16', 'Comentario', 'Requisitos entregados']];
    for (const s of q.todas.all().map(fila).map(cerrarSiVencida).sort((a, b) => a.equipo.localeCompare(b.equipo) || a.nombre.localeCompare(b.nombre))) {
      const e = s.evaluacion;
      filas.push([s.nombre, s.email, s.equipo, s.estado, nPreguntas(s), s.fin ? Math.round((s.fin - s.inicio) / 1000) : '', e ? e.descubiertas.length : '', e ? e.cobertura : '', e ? e.calidad : '', e ? e.traduccion : '', e ? e.contradiccion : '', e ? e.total : '', e ? e.comentario : '', s.requisitos]);
    }
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="resultados-cliente-logistpulse.csv"');
    res.send('﻿' + filas.map(f => f.map(celda).join(',')).join('\r\n'));
  });

  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'no_existe' }));

  app.locals.db = db;
  return app;
}

if (require.main === module) {
  const cfg = cfgDesdeEnv();
  let app;
  try { app = crearApp(cfg); } catch (e) { console.error('\n' + e.message + '\nRevisa tu archivo .env (ver .env.example).\n'); process.exit(1); }
  app.listen(cfg.port, () => console.log(`Cliente LOGISTPULSE en http://localhost:${cfg.port}  (modo ${cfg.mock ? 'SIMULADO, sin IA' : 'IA real: ' + cfg.clientModel})`));
}
module.exports = { crearApp, cfgDesdeEnv };
