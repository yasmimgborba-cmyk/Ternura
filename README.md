# Ternura

Site para vender sites, apps, softwares, design gráfico, social media e personal brand.
O cliente monta o projeto, vê a prévia, recebe o preço na hora e paga com **Pix ou cartão (Stripe)**.

## Páginas
- `/`: página principal (serviços, portfólio, Blast, como funciona, modelos, contato).
- `/orcamento`: configurador. O cliente escolhe serviço, template ou do zero, estilo, cores, nome da marca, extras, prazo e forma de pagamento. A prévia muda na hora e o preço é calculado no servidor.
- `/pagar/<token>`: página de pagamento com Pix e cartão. Confirma sozinha quando o Pix cai.
- `/admin`: painel com todos os pedidos (usuário `admin`, senha `ADMIN_PASSWORD`).
- `/exemplos/...`: sites do portfólio (Blast, Underground GYN, Doce Nuvem, Lia Moreno, Sereno, Folha & Co.).

## Preços
Tudo fica em `src/precos.js`: valor base por serviço e modelo (template, personalizado, exclusivo),
acréscimo por estilo, extras, urgência (+30%) e desconto à vista (5%). Muda ali e o site inteiro acompanha.

## No ar
**https://ternura.pages.dev** · Cloudflare Pages (grátis) + banco D1 `ternura`.

Painel: `/admin` (usuário `admin`, senha no segredo `ADMIN_PASSWORD`).

### Chaves (Cloudflare > Workers e Pages > ternura > Configurações > Variáveis e segredos)
Adicione como **Segredo** e depois publique de novo:

- `STRIPE_SECRET_KEY`: chave secreta da Stripe (`sk_live_...`).
- `STRIPE_WEBHOOK_SECRET`: segredo do webhook da Stripe (`whsec_...`).

Webhook da Stripe → `https://ternura.pages.dev/webhook/stripe` (`checkout.session.completed`, `checkout.session.async_payment_succeeded`).
Pix e cartão são pela Stripe (`STRIPE_METHODS=card,pix`, parcelamento com `STRIPE_PARCELAS=1`). Se o Pix ainda não estiver ativo na Stripe, o checkout cai só pro cartão.
Mesmo sem webhook o pagamento é confirmado na volta do checkout e enquanto a página do pedido está aberta.
Sem `STRIPE_SECRET_KEY`, o cliente vê "Pedido recebido" e você chama ele pelo WhatsApp que ele deixou.

## Publicar
```bash
./publicar.sh
```
Da nuvem do Claude o `wrangler pages deploy` falha (401 nos assets): o script embute `public/` no `_worker.js`
e a publicação é feita pela API (`POST /pages/projects/ternura/deployments` com `manifest={}` e o `_worker.js`).

## Rodar no computador
```bash
npm run dev     # http://localhost:3000 (usa node:sqlite no lugar do D1)
npm test
```
