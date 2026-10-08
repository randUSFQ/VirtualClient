'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearApp, cfgDesdeEnv } = require('../server/index.js');

function arrancar(extra = {}) {
  const cfg = Object.assign(cfgDesdeEnv({}), { dbPath: ':memory:', mock: true, adminPassword: 'secreto123', accessCode: 'clase1', domain: 'usfq.edu.ec', duracion: 360 }, extra);
  const app = crearApp(cfg);
  return new Promise(res => {
    const srv = app.listen(0, () => {
      const base = `http://127.0.0.1:${srv.address().port}`;
      const llamar = async (ruta, { metodo = 'GET', cuerpo, token, admin } = {}) => {
        const r = await fetch(base + ruta, {
          method: metodo,
          headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'x-token': token } : {}, admin ? { 'x-admin-password': admin } : {}),
          body: cuerpo ? JSON.stringify(cuerpo) : undefined,
        });
        const tipo = r.headers.get('content-type') || '';
        return { status: r.status, data: tipo.includes('json') ? await r.json() : await r.text() };
      };
      res({ srv, llamar, app });
    });
  });
}
const alta = (n, extra) => Object.assign({ email: `est${n}@usfq.edu.ec`, nombre: `Estudiante ${n}`, equipo: 'Alfa', codigo: 'clase1' }, extra);

test('flujo completo de un estudiante', async () => {
  const { srv, llamar } = await arrancar();
  try {
    const e = await llamar('/api/entrar', { metodo: 'POST', cuerpo: alta(1) });
    assert.equal(e.status, 200);
    assert.ok(e.data.token);
    assert.equal(e.data.sesion.estado, 'en_curso');
    assert.ok(e.data.sesion.restante > 355 && e.data.sesion.restante <= 360);
    assert.equal(e.data.sesion.turnos.length, 1); // solo el saludo

    // pregunta abierta sobre picos: la clienta revela la necesidad 1
    const p = await llamar('/api/preguntar', { metodo: 'POST', token: e.data.token, cuerpo: { texto: '¿Cuáles son las temporadas con más pedidos?' } });
    assert.equal(p.status, 200);
    const ult = p.data.sesion.turnos.at(-1);
    assert.equal(ult.r, 'c');
    assert.match(ult.t, /triplican/);

    // pregunta cerrada: respuesta vaga
    const c = await llamar('/api/preguntar', { metodo: 'POST', token: e.data.token, cuerpo: { texto: '¿Usa React?' } });
    assert.equal(c.data.sesion.turnos.at(-1).t, 'Sí, supongo.');

    // no puede entregar antes de terminar
    const antes = await llamar('/api/entregar', { metodo: 'POST', token: e.data.token, cuerpo: { requisitos: 'R — algo' } });
    assert.equal(antes.status, 409);

    const t = await llamar('/api/terminar', { metodo: 'POST', token: e.data.token });
    assert.equal(t.data.sesion.estado, 'completada');
    assert.equal(t.data.sesion.preguntas, 2);

    // tras terminar ya no se puede preguntar
    const tarde = await llamar('/api/preguntar', { metodo: 'POST', token: e.data.token, cuerpo: { texto: 'una más' } });
    assert.equal(tarde.status, 409);

    const d = await llamar('/api/entregar', { metodo: 'POST', token: e.data.token, cuerpo: { requisitos: 'R — Soportar el triple de pedidos en diciembre' } });
    assert.equal(d.data.sesion.estado, 'entregada');
    const otra = await llamar('/api/entregar', { metodo: 'POST', token: e.data.token, cuerpo: { requisitos: 'otra cosa' } });
    assert.equal(otra.status, 409);
  } finally { srv.close(); }
});

test('una entrevista por correo; retomar solo con el token', async () => {
  const { srv, llamar } = await arrancar();
  try {
    const a = await llamar('/api/entrar', { metodo: 'POST', cuerpo: alta(2) });
    assert.equal(a.status, 200);
    // mismo correo sin token: bloqueado
    const b = await llamar('/api/entrar', { metodo: 'POST', cuerpo: alta(2) });
    assert.equal(b.status, 409);
    assert.equal(b.data.error, 'ya_existe');
    // mismo correo con otro token: bloqueado
    const c = await llamar('/api/entrar', { metodo: 'POST', cuerpo: alta(2, { token: 'x'.repeat(48) }) });
    assert.equal(c.status, 409);
    // con su token: retoma la misma sesión sin reiniciar el tiempo
    const d = await llamar('/api/entrar', { metodo: 'POST', cuerpo: alta(2, { token: a.data.token, codigo: '' }) });
    assert.equal(d.status, 200);
    assert.equal(d.data.sesion.inicio, a.data.sesion.inicio);
    // correo en distinto uso de mayúsculas cuenta como el mismo
    const e = await llamar('/api/entrar', { metodo: 'POST', cuerpo: alta(2, { email: 'EST2@USFQ.EDU.EC' }) });
    assert.equal(e.status, 409);
  } finally { srv.close(); }
});

test('validaciones de acceso: código, dominio y campos', async () => {
  const { srv, llamar } = await arrancar();
  try {
    assert.equal((await llamar('/api/entrar', { metodo: 'POST', cuerpo: alta(3, { codigo: 'mal' }) })).data.error, 'codigo');
    assert.equal((await llamar('/api/entrar', { metodo: 'POST', cuerpo: alta(3, { email: 'x@gmail.com' }) })).data.error, 'dominio');
    assert.equal((await llamar('/api/entrar', { metodo: 'POST', cuerpo: alta(3, { email: 'no-es-correo' }) })).data.error, 'correo');
    assert.equal((await llamar('/api/entrar', { metodo: 'POST', cuerpo: alta(3, { nombre: '' }) })).data.error, 'campos');
    assert.equal((await llamar('/api/sesion', { token: 'inventado' })).status, 401);
    // el registro público no filtra correos ni transcripciones
    await llamar('/api/entrar', { metodo: 'POST', cuerpo: alta(3) });
    const reg = await llamar('/api/registro');
    assert.deepEqual(Object.keys(reg.data[0]).sort(), ['equipo', 'estado', 'inicio', 'nombre']);
  } finally { srv.close(); }
});

test('el tiempo se controla en el servidor', async () => {
  const { srv, llamar } = await arrancar({ duracion: 1 });
  try {
    const e = await llamar('/api/entrar', { metodo: 'POST', cuerpo: alta(4) });
    await new Promise(r => setTimeout(r, 1300));
    const p = await llamar('/api/preguntar', { metodo: 'POST', token: e.data.token, cuerpo: { texto: '¿Qué problemas tienen?' } });
    assert.equal(p.status, 409);
    assert.equal(p.data.error, 'terminada');
    assert.equal(p.data.sesion.estado, 'completada');
    assert.equal(p.data.sesion.preguntas, 0);
    assert.match(p.data.sesion.turnos.at(-1).t, /reunión/); // cierre de la clienta
    // y no puede reiniciar entrando otra vez
    const otra = await llamar('/api/entrar', { metodo: 'POST', cuerpo: alta(4) });
    assert.equal(otra.status, 409);
  } finally { srv.close(); }
});

test('panel docente: contraseña, evaluación, exportación y reabrir', async () => {
  const { srv, llamar } = await arrancar();
  try {
    const e = await llamar('/api/entrar', { metodo: 'POST', cuerpo: alta(5) });
    const T = e.data.token;
    await llamar('/api/preguntar', { metodo: 'POST', token: T, cuerpo: { texto: '¿Cómo supervisan hoy dónde está cada pedido?' } });
    await llamar('/api/preguntar', { metodo: 'POST', token: T, cuerpo: { texto: '¿Qué prioridades o tipos de pedido manejan?' } });
    await llamar('/api/terminar', { metodo: 'POST', token: T });
    await llamar('/api/entregar', { metodo: 'POST', token: T, cuerpo: { requisitos: 'F — Mapa en vivo de robots' } });

    assert.equal((await llamar('/api/admin/sesiones')).status, 401);
    assert.equal((await llamar('/api/admin/sesiones', { admin: 'incorrecta' })).status, 401);
    const lista = await llamar('/api/admin/sesiones', { admin: 'secreto123' });
    assert.equal(lista.status, 200);
    assert.equal(lista.data.sesiones.length, 1);
    assert.equal(lista.data.sesiones[0].email, 'est5@usfq.edu.ec');
    assert.ok(!JSON.stringify(lista.data.guion).includes('claves')); // el guion interno no se filtra

    const id = lista.data.sesiones[0].id;
    const ev = await llamar(`/api/admin/evaluar/${id}`, { metodo: 'POST', admin: 'secreto123' });
    assert.equal(ev.status, 200);
    assert.ok(ev.data.evaluacion.descubiertas.includes(3));
    assert.equal(ev.data.evaluacion.contradiccion, 4);
    assert.equal(ev.data.evaluacion.total, ev.data.evaluacion.cobertura + ev.data.evaluacion.calidad + ev.data.evaluacion.traduccion + ev.data.evaluacion.contradiccion);

    const csv = await llamar('/api/admin/export.csv', { admin: 'secreto123' });
    assert.equal(csv.status, 200);
    assert.match(csv.data, /Estudiante 5/);

    const pend = await llamar('/api/admin/evaluar-pendientes', { metodo: 'POST', admin: 'secreto123' });
    assert.equal(pend.data.hechas, 0);

    // reabrir borra y permite repetir
    await llamar(`/api/admin/sesiones/${id}`, { metodo: 'DELETE', admin: 'secreto123' });
    const de_nuevo = await llamar('/api/entrar', { metodo: 'POST', cuerpo: alta(5) });
    assert.equal(de_nuevo.status, 200);
  } finally { srv.close(); }
});

test('no evalúa entrevistas en curso y falla con claridad si la IA falla', async () => {
  const llmRoto = { cliente: async () => { throw new Error('caída'); }, evaluar: async () => { throw new Error('caída'); } };
  const cfg = Object.assign(cfgDesdeEnv({}), { dbPath: ':memory:', adminPassword: 'secreto123', accessCode: '', domain: '' });
  const app = crearApp(cfg, { llm: llmRoto });
  const srv = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const j = (ruta, o = {}) => fetch(base + ruta, { method: o.m || 'GET', headers: Object.assign({ 'Content-Type': 'application/json' }, o.h || {}), body: o.b ? JSON.stringify(o.b) : undefined }).then(async r => ({ status: r.status, data: await r.json() }));
  try {
    const e = await j('/api/entrar', { m: 'POST', b: { email: 'a@b.co', nombre: 'A', equipo: 'X' } });
    const p = await j('/api/preguntar', { m: 'POST', h: { 'x-token': e.data.token }, b: { texto: 'hola' } });
    assert.equal(p.status, 502);
    const s = await j('/api/sesion', { h: { 'x-token': e.data.token } });
    assert.equal(s.data.sesion.preguntas, 0); // la pregunta fallida no se guarda
    const id = (await j('/api/admin/sesiones', { h: { 'x-admin-password': 'secreto123' } })).data.sesiones[0].id;
    const ev = await j(`/api/admin/evaluar/${id}`, { m: 'POST', h: { 'x-admin-password': 'secreto123' } });
    assert.equal(ev.status, 409); // sigue en curso
  } finally { srv.close(); }
});

test('exige contraseña de administrador y clave de API', () => {
  assert.throws(() => crearApp(Object.assign(cfgDesdeEnv({}), { dbPath: ':memory:', mock: true, adminPassword: '' })), /ADMIN_PASSWORD/);
  assert.throws(() => crearApp(Object.assign(cfgDesdeEnv({}), { dbPath: ':memory:', mock: false, apiKey: '', adminPassword: 'secreto123' })), /ANTHROPIC_API_KEY/);
});
