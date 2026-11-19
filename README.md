# Ternura

Site para vender sites, apps, softwares, design gráfico, social media e personal brand.
O cliente monta o projeto, vê a prévia, recebe o preço na hora e paga com **Pix (Mercado Pago)** ou **cartão (Stripe)**.

## Páginas
- `/`: página principal (serviços, portfólio, Blast, como funciona, modelos, contato).
- `/orcamento`: configurador. O cliente escolhe serviço, template ou do zero, estilo, cores, nome da marca, extras, prazo e forma de pagamento. A prévia muda na hora e o preço é calculado no servidor.
- `/pagar/<token>`: página de pagamento com Pix e cartão. Confirma sozinha quando o Pix cai.
- `/admin`: painel com todos os pedidos (usuário `admin`, senha `ADMIN_PASSWORD`).
- `/exemplos/...`: sites do portfólio (Blast, Underground GYN, Doce Nuvem, Lia Moreno, Sereno, Folha & Co.).

## Preços
Tudo fica em `src/precos.js`: valor base por serviço e modelo (template, personalizado, exclusivo),
acréscimo por estilo, extras, urgência (+30%) e desconto à vista (5%). Muda ali e o site inteiro acompanha.

## Rodar
```bash
npm install
cp .env.example .env   # preencha seus dados
npm start              # http://localhost:3000
```

## Mercado Pago (Pix)
1. Em mercadopago.com.br/developers, abra **Suas integrações**, crie uma aplicação e copie o **Access Token de produção** para `MP_ACCESS_TOKEN`.
2. Em **Webhooks**, cadastre `https://SEU_DOMINIO/webhook/mercadopago` com o evento **Pagamentos**. Copie a assinatura secreta para `MP_WEBHOOK_SECRET`.
3. Pronto: cada pedido gera um Pix com o valor certo, válido por 24h. Quando o cliente paga, o pedido vira "Pago" sozinho.

Sem `MP_ACCESS_TOKEN`, o site usa a chave Pix estática (`PIX_KEY`) e você marca como pago no painel.

## Stripe (cartão)
1. Em dashboard.stripe.com/apikeys, copie a **chave secreta** da sua conta para `STRIPE_SECRET_KEY`.
2. Em **Webhooks**, cadastre `https://SEU_DOMINIO/webhook/stripe` com `checkout.session.completed` e
   `checkout.session.async_payment_succeeded`, e copie o segredo para `STRIPE_WEBHOOK_SECRET`.
3. Parcelamento: `STRIPE_PARCELAS=1` (só em conta Stripe do Brasil).

## Testes
```bash
npm test
```

## Hospedagem
Os pedidos ficam em `data/db.json`. Use um servidor com disco persistente (Railway, Render com disco, VPS).
