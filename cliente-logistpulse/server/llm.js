'use strict';

function parseJson(text) {
  const t = String(text || '').trim(), tries = [t];
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence) tries.push(fence[1]);
  const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a >= 0 && b > a) tries.push(t.slice(a, b + 1));
  for (const x of tries) { try { return JSON.parse(x); } catch (_) {} }
  throw new Error('La evaluación no devolvió JSON válido');
}

const MODELOS = {
  openai: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
  anthropic: ['claude-3-5-haiku-latest', 'claude-3-7-sonnet-latest', 'claude-sonnet-4-20250514'],
};
const ETIQUETAS = { openai: 'OpenAI', gemini: 'Google Gemini', anthropic: 'Anthropic Claude' };

function crearReal({ provider, apiKey, clientModel, evalModel }) {
  if (!apiKey) throw new Error(`Falta la clave API para ${ETIQUETAS[provider] || provider}`);
  async function request(url, headers, body) {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error?.message || data.error?.status || `API respondió HTTP ${r.status}`);
    return data;
  }
  async function call(model, system, messages, maxTokens) {
    if (provider === 'openai') {
      const data = await request('https://api.openai.com/v1/chat/completions', { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, {
        model, max_completion_tokens: maxTokens, messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages],
      });
      return data.choices?.[0]?.message?.content?.trim() || '';
    }
    if (provider === 'gemini') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const contents = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
      const data = await request(url, { 'Content-Type': 'application/json' }, {
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents,
        generationConfig: { maxOutputTokens: maxTokens },
      });
      return data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim() || '';
    }
    const data = await request('https://api.anthropic.com/v1/messages', {
      'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json',
    }, { model, max_tokens: maxTokens, ...(system ? { system } : {}), messages });
    return data.content?.filter(p => p.type === 'text').map(p => p.text).join('').trim() || '';
  }
  return {
    async cliente(system, messages) { const out = await call(clientModel, system, messages, 500); if (!out) throw new Error('Respuesta vacía'); return out; },
    async evaluar(prompt) { return parseJson(await call(evalModel, '', [{ role: 'user', content: prompt }], 1600)); },
    async probar() { const out = await call(clientModel, 'Responde únicamente: conexión correcta.', [{ role: 'user', content: 'Prueba de conexión.' }], 30); if (!out) throw new Error('La API respondió sin texto'); return true; },
  };
}

function crearMock(guion) {
  const cerrada = /^\s*(¿\s*)?(usa|usan|tiene|tienen|quiere|quieren|es|son|puede|pueden|hay|necesita|necesitan)\b/i;
  return {
    async cliente(_system, messages) {
      const previas = messages.filter(m => m.role === 'assistant').map(m => m.content).join(' '), q = messages[messages.length - 1].content;
      if (cerrada.test(q) && q.length < 60) return 'Sí, supongo.';
      if (/prioridad|plazo|tipo de pedido|tipos de pedido/i.test(q)) return 'Bueno, en realidad hay tres tipos: express, que debe salir en 2 horas; normal, en 24 horas; y reposición, en 72 horas.';
      for (const n of guion.necesidades) if (new RegExp(n.claves, 'i').test(q) && !previas.includes(n.texto)) return 'Mire, le cuento: ' + n.texto;
      return 'Todos nuestros pedidos son urgentes, la verdad. Lo que necesito es que el caos termine.';
    },
    async evaluar(prompt) {
      const asistente = (prompt.split('TRANSCRIPCIÓN\n')[1] || '').split('\n\nREQUISITOS ENTREGADOS')[0];
      const clienta = asistente.split('\n').filter(l => l.startsWith('CLIENTA:')).join(' '), est = asistente.split('\n').filter(l => l.startsWith('ESTUDIANTE:'));
      const descubiertas = guion.necesidades.filter(n => clienta.includes(n.texto)).map(n => n.id), abiertas = est.filter(l => /(qu[eé]|c[oó]mo|cu[eé]ntame|cu[aá]l|por qu[eé]|d[oó]nde|cu[aá]ndo|qui[eé]n)/i.test(l)).length;
      return { descubiertas, contradiccion_detectada: est.some(l => /prioridad|diferen|aclar|niveles|tipos de pedido/i.test(l)), preguntas: { abiertas, profundizacion: 0, cerradas: est.length - abiertas }, calidad_preguntas: est.length ? Math.round((abiertas / est.length) * 40) / 10 : 0, traduccion_requisitos: /\b[FURPS]\b/.test(prompt.split('REQUISITOS ENTREGADOS POR EL ESTUDIANTE\n')[1] || '') ? 2 : 0, comentario: 'Evaluación simulada (modo MOCK_LLM): no usa IA, solo reglas simples.' };
    },
  };
}
function crear({ mock, provider = 'anthropic', apiKey, clientModel, evalModel, guion }) { return mock ? crearMock(guion) : crearReal({ provider, apiKey, clientModel, evalModel }); }
module.exports = { crear, crearReal, parseJson, MODELOS, ETIQUETAS };
