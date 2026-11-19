// Catálogo e cálculo de preços do configurador de orçamento.
// O navegador recebe este catálogo para mostrar a prévia, mas o valor final
// SEMPRE é recalculado aqui no servidor.

const servicos = {
  site:     { nome: 'Site / landing page',      icone: '🌐', grupo: 'dev',    preview: 'site',     base: { template: 290,  personalizado: 790, exclusivo: 1490 },  prazo: { template: '5 dias', personalizado: '2 a 3 semanas', exclusivo: '4 a 6 semanas' } },
  loja:     { nome: 'Loja virtual',              icone: '🛍️', grupo: 'dev',    preview: 'loja',     base: { template: 890, personalizado: 1790, exclusivo: 3490 },  prazo: { template: '10 dias', personalizado: '3 a 4 semanas', exclusivo: '6 a 8 semanas' } },
  app:      { nome: 'App (Android e iPhone)',    icone: '📱', grupo: 'dev',    preview: 'app',      base: { template: 1990, personalizado: 3990, exclusivo: 7990 }, prazo: { template: '3 semanas', personalizado: '6 a 8 semanas', exclusivo: '10 a 14 semanas' } },
  software: { nome: 'Sistema / software',        icone: '⚙️', grupo: 'dev',    preview: 'software', base: { template: 1490, personalizado: 3490, exclusivo: 7990 }, prazo: { template: '3 semanas', personalizado: '6 a 10 semanas', exclusivo: '3 a 4 meses' } },
  design:   { nome: 'Design gráfico',            icone: '🎨', grupo: 'design', preview: 'design',   base: { template: 190,  personalizado: 450,  exclusivo: 890 },  prazo: { template: '3 dias', personalizado: '1 semana', exclusivo: '2 semanas' } },
  social:   { nome: 'Social media (mensal)',     icone: '💌', grupo: 'design', preview: 'social',   base: { template: 290,  personalizado: 590,  exclusivo: 990 },  prazo: { template: 'começa em 3 dias', personalizado: 'começa em 5 dias', exclusivo: 'começa em 7 dias' }, mensal: true },
  brand:    { nome: 'Personal brand',            icone: '✨', grupo: 'design', preview: 'brand',    base: { template: 590,  personalizado: 1290, exclusivo: 2490 },  prazo: { template: '1 semana', personalizado: '2 a 3 semanas', exclusivo: '4 semanas' } },
};

const modelos = {
  template:      { nome: 'Template pronto', desc: 'Um modelo nosso adaptado com sua marca. Mais barato e rápido.' },
  personalizado: { nome: 'Personalizado',   desc: 'Layout feito pra você a partir do estilo escolhido.' },
  exclusivo:     { nome: 'Exclusivo',       desc: 'Do zero, com pesquisa, protótipo e rodadas de ajuste.' },
};

const estilos = {
  minimalista: { nome: 'Minimalista', desc: 'Limpo, muito respiro, tipografia fina.',       fator: 1 },
  fofo:        { nome: 'Fofo',        desc: 'Arredondado, laços, corações e cores doces.',   fator: 1.05 },
  exagerado:   { nome: 'Exagerado',   desc: 'Maximalista: cores fortes, formas, movimento.', fator: 1.15 },
  elegante:    { nome: 'Elegante',    desc: 'Serifas, detalhes finos, cara de marca cara.',  fator: 1.05 },
  tech:        { nome: 'Dark / tech', desc: 'Fundo escuro, brilho neon, cara de software.',  fator: 1 },
  zine:        { nome: 'Zine',        desc: 'Underground: recorte, xerox, fita adesiva.',    fator: 1.1 },
};

const paletas = {
  ternura: { nome: 'Ternura',        cores: ['#8AD0BB', '#E66684', '#FBF9F7', '#5A2E1E'] },
  nude:    { nome: 'Nude',           cores: ['#C8A288', '#8B5E4A', '#FAF5F0', '#3A2A22'] },
  oceano:  { nome: 'Oceano',         cores: ['#2B7A9B', '#F2B544', '#F4FAFB', '#0E2A36'] },
  lavanda: { nome: 'Lavanda',        cores: ['#A88BEB', '#F5A3C7', '#FBF8FF', '#2E2244'] },
  neon:    { nome: 'Noite neon',     cores: ['#7CFF3B', '#FF2E88', '#0F0F14', '#F2EDE1'] },
  pb:      { nome: 'Preto & branco', cores: ['#111111', '#E5484D', '#FFFFFF', '#111111'] },
};

const extras = [
  { id: 'paginas',     nome: 'Páginas extras',                preco: 90, qtd: true, max: 20, para: ['site', 'loja'] },
  { id: 'blog',        nome: 'Blog',                          preco: 190, para: ['site', 'loja', 'brand'] },
  { id: 'agenda',      nome: 'Agendamento online',            preco: 290, para: ['site', 'app', 'software'] },
  { id: 'login',       nome: 'Área de membros / login',       preco: 490, para: ['site', 'app', 'software'] },
  { id: 'pagamento',   nome: 'Pagamento Pix e cartão',        preco: 390, para: ['site', 'app', 'software'] },
  { id: 'idiomas',     nome: 'Versão em inglês/espanhol',     preco: 250, para: ['site', 'loja', 'app', 'software'] },
  { id: 'seo',         nome: 'SEO (aparecer no Google)',      preco: 190, para: ['site', 'loja', 'brand'] },
  { id: 'textos',      nome: 'Textos prontos (copywriting)',  preco: 190, para: ['site', 'loja', 'brand', 'app'] },
  { id: 'logo',        nome: 'Logo simples',                  preco: 120, para: ['site', 'loja', 'app', 'software', 'social'] },
  { id: 'dominio',     nome: 'Domínio + hospedagem (1 ano)',  preco: 180, para: ['site', 'loja', 'brand'] },
  { id: 'admin',       nome: 'Painel administrativo',         preco: 590, para: ['app', 'software', 'loja'] },
  { id: 'push',        nome: 'Notificações no celular',       preco: 290, para: ['app'] },
  { id: 'lojas',       nome: 'Publicação na Play Store e App Store', preco: 350, para: ['app'] },
  { id: 'relatorios',  nome: 'Relatórios e gráficos',         preco: 390, para: ['software', 'app'] },
  { id: 'manual',      nome: 'Manual da marca',               preco: 190, para: ['design', 'brand'] },
  { id: 'papelaria',   nome: 'Cartão de visita + papelaria',  preco: 120, para: ['design', 'brand'] },
  { id: 'kitposts',    nome: 'Kit com 12 templates de post',  preco: 190, para: ['design', 'brand'] },
  { id: 'reels',       nome: 'Reels (4 por mês)',             preco: 190, para: ['social', 'brand'] },
  { id: 'stories',     nome: 'Stories diários',               preco: 120, para: ['social'] },
  { id: 'anuncios',    nome: 'Gestão de anúncios',            preco: 290, para: ['social'] },
  { id: 'biolink',     nome: 'Página de links na bio',        preco: 90, para: ['social', 'brand', 'design'] },
  { id: 'suporte',     nome: '3 meses de suporte extra',      preco: 190, para: ['site', 'loja', 'app', 'software'] },
];

const urgencias = {
  normal: { nome: 'Prazo normal', fator: 1 },
  rapido: { nome: 'Urgente (prioridade na fila)', fator: 1.25 },
};

const pagamentos = {
  entrada: { nome: '50% agora, 50% na entrega' },
  total:   { nome: 'À vista com 5% de desconto', desconto: 0.05 },
};

const round = (v) => Math.round(v * 100) / 100;

// Recebe a escolha do cliente e devolve itens, total e quanto cobrar agora.
function calcular(cfg = {}) {
  const s = servicos[cfg.servico];
  if (!s) throw new Error('Escolha um serviço.');
  const modelo = modelos[cfg.modelo] ? cfg.modelo : 'personalizado';
  const estilo = estilos[cfg.estilo] ? cfg.estilo : 'minimalista';
  const urg = urgencias[cfg.urgencia] ? cfg.urgencia : 'normal';
  const pag = pagamentos[cfg.pagamento] ? cfg.pagamento : 'entrada';

  const itens = [];
  const base = s.base[modelo];
  itens.push({ nome: `${s.nome} · ${modelos[modelo].nome}`, valor: base });
  const fatorEstilo = estilos[estilo].fator;
  if (fatorEstilo !== 1) itens.push({ nome: `Estilo ${estilos[estilo].nome}`, valor: Math.round(base * (fatorEstilo - 1)) });

  const escolhidos = cfg.extras && typeof cfg.extras === 'object' ? cfg.extras : {};
  for (const e of extras) {
    if (!e.para.includes(cfg.servico)) continue;
    let q = Number(escolhidos[e.id] || 0);
    if (!e.qtd) q = q ? 1 : 0;
    q = Math.max(0, Math.min(e.max || 1, Math.floor(q)));
    if (q) itens.push({ nome: e.qtd ? `${e.nome} (${q}x)` : e.nome, valor: e.preco * q });
  }

  let subtotal = itens.reduce((t, i) => t + i.valor, 0);
  if (urgencias[urg].fator !== 1) {
    const add = Math.round(subtotal * (urgencias[urg].fator - 1));
    itens.push({ nome: urgencias[urg].nome, valor: add });
    subtotal += add;
  }

  let total = subtotal;
  if (pagamentos[pag].desconto) {
    const d = Math.round(subtotal * pagamentos[pag].desconto);
    itens.push({ nome: 'Desconto à vista', valor: -d });
    total -= d;
  }
  total = round(total);
  const agora = s.mensal || pag === 'total' ? total : round(total / 2);

  return {
    servico: cfg.servico, modelo, estilo, urgencia: urg, pagamento: s.mensal ? 'total' : pag,
    itens, total, agora, mensal: !!s.mensal,
    prazo: s.prazo[modelo],
    titulo: `${s.nome} ${modelos[modelo].nome.toLowerCase()} · estilo ${estilos[estilo].nome.toLowerCase()}`,
  };
}

module.exports = { servicos, modelos, estilos, paletas, extras, urgencias, pagamentos, calcular };
