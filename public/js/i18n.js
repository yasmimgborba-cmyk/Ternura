// Idiomas do site (PT, EN, ES). O texto do HTML fica em português e é trocado aqui.
import D from './i18n-dict.js';

const LANGS = ['pt', 'en', 'es'];
function detectar() {
  const q = new URLSearchParams(location.search).get('lang');
  if (LANGS.includes(q)) { try { localStorage.setItem('lang', q); } catch {} return q; }
  try { const s = localStorage.getItem('lang'); if (LANGS.includes(s)) return s; } catch {}
  const n = (navigator.language || 'pt').slice(0, 2).toLowerCase();
  return n === 'pt' ? 'pt' : n === 'es' ? 'es' : 'en';
}

export const lang = detectar();
const idx = { en: 0, es: 1 }[lang];
const minusc = {};
for (const k in D) minusc[k.toLowerCase()] = D[k];

export function T(s) {
  if (lang === 'pt' || s == null) return s;
  const v = D[s] || minusc[String(s).toLowerCase()];
  return v ? v[idx] : s;
}

// Nomes de itens/títulos vindos do servidor: "Site / landing page · Personalizado · Estilo Fofo", "Páginas extras (2x)".
export function item(s) {
  if (lang === 'pt') return s;
  return String(s).split(' · ').map((p) => {
    let m;
    if (D[p]) return T(p);
    if ((m = p.match(/^Estilo (.+)$/i))) return lang === 'en' ? `${T(m[1])} style` : `${T('Estilo')} ${T(m[1])}`;
    if ((m = p.match(/^(.+) \((\d+)x\)$/))) return `${T(m[1])} (${m[2]}x)`;
    return T(p);
  }).join(' · ');
}

export const locale = { pt: 'pt-BR', en: 'en-US', es: 'pt-BR' }[lang];
export const brl = (v) => Number(v).toLocaleString(locale, { style: 'currency', currency: 'BRL' });

window.T = T; window.Titem = item; window.LANG = lang; window.brl = brl;

const PULAR = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE']);
function trocarTexto(n) {
  const bruto = n.data, t = bruto.trim();
  if (!t) return;
  const v = T(t);
  if (v !== t) n.data = bruto.replace(t, v);
}
function traduzir(raiz) {
  if (lang === 'pt' || !raiz) return;
  if (raiz.nodeType === 3) return trocarTexto(raiz);
  if (raiz.nodeType !== 1 || PULAR.has(raiz.tagName)) return;
  const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (PULAR.has(n.parentNode?.tagName) ? 2 : 1) });
  let n; while ((n = w.nextNode())) trocarTexto(n);
  const els = [raiz, ...raiz.querySelectorAll('[placeholder],[title],[alt],[aria-label],[data-item],[data-prazo]')];
  for (const el of els) {
    if (!el.getAttribute) continue;
    for (const a of ['placeholder', 'title', 'alt', 'aria-label']) {
      const v = el.getAttribute(a);
      if (v && T(v) !== v) el.setAttribute(a, T(v));
    }
    if (el.hasAttribute('data-prazo') && !el.dataset.feito) { el.textContent = T('Prazo estimado: {P}, contado depois do pagamento e do briefing.').replace('{P}', T(el.dataset.prazo)); el.dataset.feito = '1'; }
    if (el.hasAttribute('data-item') && !el.dataset.feito) { el.textContent = item(el.textContent.trim()); el.dataset.feito = '1'; }
  }
}

function seletor() {
  const menu = document.querySelector('.menu');
  if (!menu || menu.querySelector('.idiomas')) return;
  const box = document.createElement('span');
  box.className = 'idiomas';
  box.innerHTML = LANGS.map((l) => `<a href="?lang=${l}${location.hash}" data-l="${l}" ${l === lang ? 'aria-current="true"' : ''}>${l.toUpperCase()}</a>`).join('');
  box.addEventListener('click', (e) => {
    const a = e.target.closest('[data-l]');
    if (!a) return;
    e.preventDefault();
    try { localStorage.setItem('lang', a.dataset.l); } catch {}
    const u = new URL(location.href); u.searchParams.set('lang', a.dataset.l); location.href = u.toString();
  });
  menu.prepend(box);
}

document.documentElement.lang = { pt: 'pt-BR', en: 'en', es: 'es' }[lang];
seletor();
if (lang !== 'pt') {
  const titulo = document.title.trim();
  if (T(titulo) !== titulo) document.title = T(titulo);
  const desc = document.querySelector('meta[name=description]');
  if (desc) desc.content = { en: 'Websites, apps, software, graphic design, social media and personal brands. Build your quote, see a preview and pay by Pix or card.', es: 'Sitios web, apps, software, diseño gráfico, redes sociales y marca personal. Arma tu presupuesto, mira la vista previa y paga con Pix o tarjeta.' }[lang];
  traduzir(document.body);
  document.querySelectorAll('.plano .preco small').forEach((el) => { el.textContent = { en: 'starting price', es: 'precio inicial' }[lang]; });
  new MutationObserver((ms) => { for (const m of ms) m.addedNodes.forEach(traduzir); })
    .observe(document.body, { childList: true, subtree: true });
}
