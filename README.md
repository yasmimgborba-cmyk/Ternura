# Ternura Studio

Site para vender sites e softwares **sob orçamento**, com pagamento por **Stripe** (cartão) e **Pix**.

## Como funciona
1. O cliente preenche o pedido de orçamento no site.
2. Você abre o painel `/admin`, escreve a proposta e o valor → gera o **link de pagamento**.
3. Manda o link (tem botão de WhatsApp pronto).
4. O cliente paga:
   - **Cartão (Stripe)**: o pedido vira "Pago" sozinho (via webhook).
   - **Pix**: QR Code + copia e cola com o valor certo. Você confere e clica em "Marcar como pago".

## Rodar
```bash
npm install
cp .env.example .env   # preencha seus dados
npm start              # http://localhost:3000
```
Painel: `http://localhost:3000/admin` (usuário `admin`, senha = `ADMIN_PASSWORD`).

## Stripe
- Chave em https://dashboard.stripe.com/apikeys → `STRIPE_SECRET_KEY`.
- Webhook apontando para `https://SEU_DOMINIO/webhook/stripe` com os eventos
  `checkout.session.completed` e `checkout.session.async_payment_succeeded` → `STRIPE_WEBHOOK_SECRET`.
- Se sua conta Stripe tiver Pix ativado, use `STRIPE_METHODS=card,pix`.

## Testes
```bash
npm test
```

## Observação
Os pedidos ficam em `data/db.json`. Para hospedar, use um servidor com disco persistente (Railway, Render com disco, VPS) ou troque por um banco.
