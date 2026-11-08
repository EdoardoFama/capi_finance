# Capi Finance

Controle de gastos pessoais. Front (React + Vite + Tailwind, PWA) e API (Hono) rodando num único **Cloudflare Worker**, com banco **Cloudflare D1** (SQLite). Tudo no plano gratuito, sem servidor que "dorme".

## Estrutura

```
src/          Front-end React (telas: Início, Orçamento, Lançar)
worker/       API Hono (/api/*) — auth, orçamento, lançamentos, dashboard
migrations/   Schema do D1
scripts/      gen-seed.mjs (usuários + orçamento inicial), gen-icons.mjs
```

## Rodar localmente

```bash
npm install
npm run seed:gen            # gera seed/seed.sql a partir de scripts/users.local.json
npm run db:migrate:local
npm run db:seed:local
npm run dev                 # http://localhost:5173
```

## Deploy (Cloudflare)

```bash
npx wrangler login
npx wrangler d1 create capi-finance-db     # copie o database_id para wrangler.jsonc
npm run db:migrate:remote
npm run db:seed:remote
npm run deploy
```

## Usuários

Os usuários ficam em `scripts/users.local.json` (fora do Git). Para criar/alterar senha:
edite o arquivo, rode `npm run seed:gen` e depois `npm run db:seed:local` / `db:seed:remote`.
O seed não duplica categorias existentes e atualiza a senha de usuários já criados.

