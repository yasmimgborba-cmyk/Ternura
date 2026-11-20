// Configurador de orçamento: escolhas -> prévia ao vivo -> preço (calculado no servidor) -> pedido.
(async function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const cat = await fetch('/api/catalogo').then((r) => r.json());
  const url = new URLSearchParams(location.search);

  const estado = {
    servico: cat.servicos[url.get('servico')] ? url.get('servico') : 'site',
    modelo: cat.modelos[url.get('modelo')] ? url.get('modelo') : 'personalizado',
    estilo: 'minimalista',
    paleta: 'ternura',
    cores: [...cat.paletas.ternura.cores],
    extras: {},
    urgencia: 'normal',
    pagamento: 'entrada',
  };

  const icones = {
    site: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>',
    loja: '<path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
    app: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
    software: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
    design: '<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1.2"/><circle cx="12" cy="7.5" r="1.2"/><circle cx="15.5" cy="10" r="1.2"/><path d="M12 21a2 2 0 0 1 0-4h2a3 3 0 0 0 3-3"/>',
    social: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.3 6.7h.01"/>',
    brand: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  };
  const selosModelo = { template: 'mais barato', personalizado: 'mais escolhido', exclusivo: 'premium' };

  // ---------- montar opções ----------
  const grupo = (g) => $(`[data-grupo=${g}]`);
  function botao(campo, valor, html) {
    return `<button type="button" class="op" data-campo="${campo}" data-valor="${valor}" aria-pressed="false">${html}</button>`;
  }
  function montarOpcoes() {
    const s = cat.servicos[estado.servico];
    const m = s.mensal ? '/mês' : '';
    grupo('servico').innerHTML = Object.entries(cat.servicos).map(([k, x]) =>
      botao('servico', k, `<span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${icones[k]}</svg></span><strong>${esc(x.nome)}</strong><span>a partir de ${brl(x.base.template)}${x.mensal ? '/mês' : ''}</span>`)).join('');
    grupo('modelo').innerHTML = Object.entries(cat.modelos).map(([k, x]) =>
      botao('modelo', k, `<span class="selo-op">${selosModelo[k]}</span><strong>${esc(x.nome)}</strong><span>${esc(x.desc)}</span><span class="valor">${brl(s.base[k])}<small>${m}</small></span><span class="prazo-op">${esc(s.prazo[k])}</span>`)).join('');
    grupo('estilo').innerHTML = Object.entries(cat.estilos).map(([k, x]) =>
      botao('estilo', k, `<span class="mini m-${k}"><b>Sua marca</b><i>Saiba mais</i></span><strong>${esc(x.nome)}</strong><span>${esc(x.desc)}${x.fator > 1 ? ` +${Math.round((x.fator - 1) * 100)}%` : ''}</span>`)).join('');
    grupo('paleta').innerHTML = Object.entries(cat.paletas).map(([k, x]) =>
      botao('paleta', k, `<span class="faixas">${x.cores.map((c) => `<i style="background:${c}"></i>`).join('')}</span><strong>${esc(x.nome)}</strong>`)).join('')
      + botao('paleta', 'personalizada', `<span class="faixas" id="faixas-livres"></span><strong>Minhas cores</strong>`);
    grupo('urgencia').innerHTML = Object.entries(cat.urgencias).map(([k, x]) =>
      botao('urgencia', k, `<strong>${k === 'normal' ? 'Prazo normal' : 'Urgente'}</strong><span>${x.fator > 1 ? `prioridade · +${Math.round((x.fator - 1) * 100)}%` : 'sem acréscimo'}</span>`)).join('');
    grupo('pagamento').innerHTML = Object.entries(cat.pagamentos).map(([k, x]) =>
      botao('pagamento', k, `<strong>${k === 'entrada' ? '50% de entrada' : 'À vista'}</strong><span>${x.desconto ? `${Math.round(x.desconto * 100)}% de desconto` : 'restante na entrega'}</span>`)).join('');
    $('#op-pagamento').hidden = !!s.mensal;
    montarExtras();
    marcar();
  }
  function montarExtras() {
    const lista = cat.extras.filter((e) => e.para.includes(estado.servico));
    for (const id of Object.keys(estado.extras)) if (!lista.find((e) => e.id === id)) delete estado.extras[id];
    $('#extras').innerHTML = lista.map((e) => {
      const q = estado.extras[e.id] || 0;
      return e.qtd
        ? `<div class="extra ${q ? 'ativo' : ''}"><span class="nome">${esc(e.nome)}</span><b>${brl(e.preco)} cada</b><span class="qtd"><button type="button" data-qtd="${e.id}" data-d="-1" aria-label="menos">−</button><output>${q}</output><button type="button" data-qtd="${e.id}" data-d="1" aria-label="mais">+</button></span></div>`
        : `<label class="extra ${q ? 'ativo' : ''}"><span class="nome">${esc(e.nome)}</span><b>+${brl(e.preco)}</b><input type="checkbox" data-extra="${e.id}" ${q ? 'checked' : ''}></label>`;
    }).join('');
  }
  function marcar() {
    document.querySelectorAll('.op').forEach((b) => b.setAttribute('aria-pressed', String(estado[b.dataset.campo] === b.dataset.valor)));
    estado.cores.forEach((c, i) => { $('#c' + i).value = c; });
    const f = $('#faixas-livres');
    if (f) f.innerHTML = estado.cores.map((c) => `<i style="background:${c}"></i>`).join('');
  }

  // ---------- eventos ----------
  document.addEventListener('click', (ev) => {
    const q = ev.target.closest('[data-qtd]');
    if (q) {
      const e = cat.extras.find((x) => x.id === q.dataset.qtd);
      const v = Math.max(0, Math.min(e.max, (estado.extras[e.id] || 0) + Number(q.dataset.d)));
      if (v) estado.extras[e.id] = v; else delete estado.extras[e.id];
      q.parentElement.querySelector('output').textContent = v;
      q.closest('.extra').classList.toggle('ativo', !!v);
      return atualizar();
    }
    const b = ev.target.closest('.op');
    if (!b) return;
    const { campo, valor } = b.dataset;
    estado[campo] = valor;
    if (campo === 'paleta' && cat.paletas[valor]) estado.cores = [...cat.paletas[valor].cores];
    if (campo === 'servico') montarOpcoes(); else marcar();
    atualizar();
  });
  for (let i = 0; i < 4; i++) {
    $('#c' + i).addEventListener('input', (e) => { estado.cores[i] = e.target.value; estado.paleta = 'personalizada'; marcar(); renderPrevia(); });
  }
  $('#extras').addEventListener('change', (e) => {
    const id = e.target.dataset.extra;
    if (!id) return;
    if (e.target.checked) estado.extras[id] = 1; else delete estado.extras[id];
    e.target.closest('.extra').classList.toggle('ativo', e.target.checked);
    atualizar();
  });
  ['#negocio', '#frase'].forEach((s) => $(s).addEventListener('input', renderPrevia));

  // ---------- prévia ----------
  const textos = {
    site: 'Feito pra você se sentir em casa', loja: 'Novidades fresquinhas toda semana', app: 'Tudo na palma da mão',
    software: 'Seu negócio organizado', design: 'Identidade visual', social: 'Conteúdo que conecta', brand: 'Prazer, essa sou eu',
  };
  function renderPrevia() {
    const nome = $('#negocio').value.trim() || 'Sua Marca';
    const frase = $('#frase').value.trim() || textos[estado.servico];
    const sigla = nome.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
    const [p, a, f, t] = estado.cores;
    const tipo = cat.servicos[estado.servico].preview;
    const pv = $('#previa');
    pv.className = `previa e-${estado.estilo}`;
    pv.style.cssText = `--p:${p};--a:${a};--f:${f};--t:${t}`;
    const N = esc(nome), F = esc(frase);
    const dominio = nome.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '') || 'suamarca';
    const navegador = (dentro) => `<div class="pv-browser"><div class="pv-barra"><i></i><i></i><i></i><span>${esc(dominio)}.com.br</span></div>${dentro}</div>`;
    const nav = (links) => `<div class="pv-nav"><span class="pv-logo">${N}</span><span class="pv-links">${links.map((l) => `<span>${l}</span>`).join('')}</span></div>`;
    let html = '';
    if (tipo === 'site') {
      html = navegador(`${nav(['Início', 'Sobre', 'Serviços', 'Contato'])}
        <div class="pv-hero"><div><h4>${F}</h4><p>Uma frase curtinha explicando o que ${N} faz e por que é especial.</p><span class="pv-btn">Fale comigo</span></div><div class="pv-img"></div></div>
        <div class="pv-cards">${['Serviço um', 'Serviço dois', 'Serviço três'].map((s) => `<div class="pv-card"><b>${s}</b><div class="linha-f"></div><div class="linha-f" style="width:70%"></div></div>`).join('')}</div>`);
    } else if (tipo === 'loja') {
      html = navegador(`${nav(['Loja', 'Coleções', 'Sobre', '🛒 2'])}
        <div class="pv-hero"><div><h4>${F}</h4><p>Frete grátis acima de R$ 199 · parcele em até 6x</p><span class="pv-btn">Comprar agora</span></div><div class="pv-img"></div></div>
        <div class="pv-produtos">${['Produto 1', 'Produto 2', 'Produto 3', 'Produto 4'].map((s, i) => `<div class="pv-prod"><div class="pv-img"></div><b>${s}</b><span>R$ ${[49, 89, 129, 39][i]},90</span></div>`).join('')}</div>`);
    } else if (tipo === 'app') {
      const itens = ['Agendar', 'Meus pedidos', 'Favoritos'].map((s) => `<div class="item"><i></i><div><b>${s}</b><span>toque para abrir</span></div></div>`).join('');
      html = `<div class="pv-celulares">
        <div class="pv-cel peq"><div class="st"><span>9:41</span><span>●●●</span></div><div class="cab"><small>Olá!</small><b>${N}</b></div><div class="banner">${F}</div><div class="tabs"><i></i><i></i><i></i><i></i></div></div>
        <div class="pv-cel"><div class="st"><span>9:41</span><span>●●●</span></div><div class="cab"><small>Bem-vinda de volta</small><b>${N}</b></div>${itens}<div class="banner" style="height:44px">Novidade ✦</div><div class="tabs"><i></i><i></i><i></i><i></i></div></div></div>`;
    } else if (tipo === 'software') {
      html = navegador(`<div class="pv-soft"><div class="pv-side"><b>${N}</b><span>Painel</span><span>Clientes</span><span>Vendas</span><span>Relatórios</span><span>Ajustes</span></div>
        <div class="pv-main"><div class="pv-kpis"><div class="pv-kpi"><small>Vendas hoje</small><b>R$ 4.2k</b></div><div class="pv-kpi"><small>Clientes</small><b>1.284</b></div><div class="pv-kpi"><small>Conversão</small><b>6,4%</b></div></div>
        <div class="pv-grafico">${[40, 65, 50, 80, 55, 90, 70, 95, 60, 85].map((h) => `<i style="height:${h}%"></i>`).join('')}</div>
        <div class="pv-tabela"><div><span>Pedido #1042</span><span>Pago</span></div><div><span>Pedido #1041</span><span>Pago</span></div><div><span>Pedido #1040</span><span>Enviado</span></div></div></div></div>`);
    } else if (tipo === 'design') {
      html = `<div class="pv-design"><div class="pv-logo-grande"><div><div class="pv-selo">${esc(sigla)}</div><b>${N}</b><small>${F}</small></div></div>
        <div class="pv-cartao"><b>${N}</b><span>contato@${esc(dominio)}.com<br>(11) 99999-9999</span></div>
        <div class="pv-paleta">${estado.cores.map((c) => `<i style="background:${c}">${c.toUpperCase()}</i>`).join('')}</div></div>`;
    } else if (tipo === 'social') {
      const posts = [`${N}`, '<span class="circ"></span>', 'dica<br>da semana', 'novidade ✦', `“${F}”`, '<span class="circ"></span>', 'bastidores', 'promo<br>-20%', '♡'];
      html = `<div class="pv-insta"><div class="pv-perfil"><i></i><div><b>@${esc(dominio)}</b><span>${F}</span></div></div><div class="pv-grade">${posts.map((x) => `<div class="pv-post">${x}</div>`).join('')}</div></div>`;
    } else {
      html = `<div class="pv-brand">${navegador(`${nav(['Sobre', 'Trabalhos', 'Contato'])}<div class="pv-hero"><div><h4>${N}</h4><p>${F}</p><span class="pv-btn">Vamos conversar</span></div><div class="pv-foto"></div></div>`)}
        <div class="pv-cel"><div class="st"><span>9:41</span><span>●●●</span></div><div class="cab"><b>@${esc(dominio)}</b><small>${F}</small></div><div class="lnk">Meu site</div><div class="lnk">Portfólio</div><div class="lnk">Agende um horário</div><div class="lnk">WhatsApp</div><div class="tabs"><i></i><i></i><i></i></div></div></div>`;
    }
    pv.innerHTML = (estado.modelo === 'template' ? '<span class="selo-template">template pronto</span>' : '') + html;
    $('#previa-nota').textContent = `${cat.estilos[estado.estilo].nome} · ${cat.modelos[estado.modelo].nome}`;
  }

  // ---------- preço ----------
  let calc = null, seq = 0;
  async function atualizarPreco() {
    const meu = ++seq;
    const r = await fetch('/api/calcular', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(estado) });
    const d = await r.json();
    if (meu !== seq || !d.ok) return;
    calc = d;
    $('#resumo-itens').innerHTML = d.itens.map((i) => `<li><span>${esc(i.nome)}</span><b>${brl(i.valor)}</b></li>`).join('');
    $('#rot-total').textContent = d.mensal ? 'Total por mês' : 'Total do projeto';
    $('#v-total').textContent = brl(d.total);
    $('#v-total-m').textContent = brl(d.total);
    $('#linha-agora').hidden = d.agora === d.total;
    $('#v-agora').textContent = brl(d.agora);
    $('#prazo').textContent = `Prazo estimado: ${d.prazo}${d.urgencia === 'rapido' ? ' (com prioridade)' : ''}.`;
    $('#enviar').textContent = `Pagar ${brl(d.agora)} e começar`;
  }
  function atualizar() { renderPrevia(); atualizarPreco().catch(() => {}); }

  // ---------- enviar ----------
  $('#enviar').addEventListener('click', async () => {
    const msg = $('#msg'), btn = $('#enviar');
    const cliente = { nome: $('#nome').value.trim(), email: $('#email').value.trim(), whatsapp: $('#whatsapp').value.trim(), negocio: $('#negocio').value.trim(), obs: [$('#frase').value.trim() && `Frase: ${$('#frase').value.trim()}`, $('#obs').value.trim()].filter(Boolean).join('\n') };
    if (!cliente.nome || !cliente.email || !cliente.whatsapp) {
      msg.className = 'msg erro'; msg.textContent = 'Preencha nome, e-mail e WhatsApp na etapa 8.';
      $('#dados').scrollIntoView({ behavior: 'smooth', block: 'center' }); (!cliente.nome ? $('#nome') : !cliente.email ? $('#email') : $('#whatsapp')).focus();
      return;
    }
    btn.disabled = true; msg.className = 'msg'; msg.textContent = 'Gerando seu pedido...';
    try {
      const r = await fetch('/api/pedido', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: estado, cliente, site: $('#site').value }) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.erro);
      location.href = d.url;
    } catch (err) {
      msg.className = 'msg erro'; msg.textContent = err.message || 'Não deu certo. Tenta de novo?';
      btn.disabled = false;
    }
  });

  montarOpcoes();
  atualizar();
})();
