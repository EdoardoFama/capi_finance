# 🦫 Capi Finance

Sistema moderno, serverless e de alta performance para **gestão financeira pessoal, controle de orçamento base zero e acompanhamento patrimonial**.

Desenvolvido para rodar 100% no **ecossistema gratuito da Cloudflare**: Frontend em **React 19** e API em **Hono** consolidados num único **Cloudflare Worker** com banco de dados relacional distribuído **Cloudflare D1 (SQLite)**. Sem servidor que "dorme", sem custos mensais e com latência global mínima.

---

## 🚀 Visão Geral e Filosofia do Sistema

O **Capi Finance** foi concebido com base em princípios práticos de finanças pessoais:

1. **Separação Real de Caixas (Contas & Benefícios)**:
   - Monitoramento individual de saldos abertos para a conta corrente principal (**Nubank**) e cartões de benefícios corporativos (**Pluxe Alimentação**, **Pluxe Refeição** e **Alelo**).
   - Lançamentos debitam apenas a conta selecionada, mantendo o controle transparente do saldo livre em cada benefício sem misturar com o saldo bancário.

2. **Orçamento Inteligente (Fixas vs. Por Fora)**:
   - **Categorias Fixas**: Custos estruturais essenciais (moradia, condomínio, energia, feira, etc.) com limites rígidos estipulados.
   - **Categorias Variáveis (Por Fora)**: Despesas de estilo de vida que não possuem um teto individual estrito, mas consomem em conjunto a verba livre calculada automaticamente (`Ganhos Totais − Gastos Fixos Previstos`).
   - **Gráficos de Distribuição**: Visualização em barras multicoloridas proporcionais com legendas de representatividade percentual (`%`) e valores absolutos.

3. **Central do Cartão de Crédito & Fechamento de Faturas**:
   - Acompanhamento das parcelas mês a mês e compras à vista no crédito.
   - Ação **"Pagar Fatura"**: ao liquidar a fatura do mês, o valor total é deduzido atomicamente do saldo em conta da **Nubank**, refletindo com precisão a saída do dinheiro do caixa, com opção para desfazer pagamento e restaurar o saldo.

4. **Patrimônio & Investimentos**:
   - Acompanhamento da evolução patrimonial em múltiplas instituições (Nubank, Inter, Santander, etc.).
   - Snapshots mensais de patrimônio líquido com cálculo automático de variação patrimonial mensal ($\Delta$).

5. **Extrato Cronológico & Edição Completa**:
   - Listagem dos gastos ordenada do mais recente para o mais antigo.
   - Filtros dinâmicos por categoria e busca por descrição em tempo real.
   - Modal para edição total de qualquer lançamento (título, valor, data, conta, forma de pagamento e observação), com opção para sincronizar alterações em compras parceladas de forma retroativa e futura.

6. **Exportação Pronta para IA**:
   - Geração sob demanda de arquivos **PDF formatados** e **planilhas CSV estruturadas** contendo rendas, orçamentos, investimentos e gastos para auditoria externa ou análise por modelos de IA.

---

## 🛠️ Stack Tecnológica

| Camada | Tecnologia | Descrição |
|---|---|---|
| **Frontend** | React 19, TypeScript, Tailwind CSS v4, Vite | Interface responsiva, moderna, mobile-first com tema escuro elegante |
| **Backend** | Hono v4, Cloudflare Workers | API RESTful rápida e tipada rodando na borda (*edge computing*) |
| **Banco de Dados** | Cloudflare D1 (SQLite nativo) | Banco de dados relacional distribuído com migrações versionadas |
| **Autenticação** | Cookies HttpOnly + SHA-256 + Salts | Autenticação segura sem tokens em localStorage, com proteção contra CSRF |
| **E-mails** | Cloudflare Workers Sockets + SMTP TLS | Envio direto de e-mails de confirmação e recuperação via protocolo SMTP nativo |
| **Exportação** | jsPDF, jsPDF-AutoTable | Geração local no browser de relatórios PDF com tabelas estilizadas |

---

## 📁 Estrutura do Projeto

```
capi_finance/
├── migrations/                 # Migrações versionadas do banco Cloudflare D1
│   ├── 0001_init.sql           # Schema inicial (users, categories, incomes, expenses)
│   ├── 0002_payment_installments.sql  # Parcelamentos e grupos de despesas
│   ├── 0003_investments.sql    # Contas de investimento e snapshots mensais
│   ├── 0004_expense_title.sql  # Título e descrições aprimoradas
│   ├── 0005_user_auth_email_admin.sql # Autenticação com e-mail e admin
│   ├── 0006_account_balances.sql      # Saldos de conta Nubank e benefícios
│   ├── 0007_credit_card_invoices.sql  # Rastreamento de pagamento de faturas
│   └── 0008_category_fixed_variable.sql # Categorias fixas e variáveis
├── src/                        # Código-fonte do Frontend (React 19)
│   ├── components/             # Componentes reutilizáveis (Layout, UI, Modais, Gráficos)
│   │   ├── DistributionChart.tsx      # Dashboard de barras multicoloridas e porcentagens
│   │   ├── EditExpenseModal.tsx       # Modal de edição completa de lançamentos
│   │   ├── Layout.tsx                 # Navegação responsiva (Desktop header + Mobile bottom bar)
│   │   └── ui.tsx                     # Card, Input, MonthPicker, Progress, Ícones SVG
│   ├── pages/                  # Telas da aplicação
│   │   ├── Home.tsx                   # Dashboard geral, saldos em conta, categorias fixas e variáveis
│   │   ├── Budget.tsx                 # Metas, rendas, categorias e gráfico de distribuição
│   │   ├── CreditCard.tsx             # Central de fatura do cartão de crédito e liquidação
│   │   ├── Expenses.tsx               # Lançamento rápido de gastos (débito, crédito, pix, voucher)
│   │   ├── History.tsx                # Extrato ordenado, filtros de busca e exportação
│   │   ├── Investments.tsx            # Evolução patrimonial por instituição financeira
│   │   ├── Login.tsx                  # Tela de login, cadastro e confirmação de e-mail
│   │   └── Admin.tsx                  # Painel administrativo de controle de usuários
│   ├── api.ts                  # Cliente de API e definições de tipos TypeScript
│   ├── context.tsx              # Contextos globais (Auth, Mês de referência, Toasts)
│   ├── export.ts               # Utilitários de exportação para PDF e CSV
│   └── format.ts               # Formatadores de moeda (BRL), datas e porcentagens
├── worker/                     # Backend API (Hono)
│   ├── index.ts                # Rotas da API RESTful (/api/*) e regras de negócio
│   ├── auth.ts                 # Hashing de senhas (PBKDF2/SHA-256) e sessões
│   └── mailer.ts               # Cliente SMTP via sockets nativos do Cloudflare Workers
├── scripts/                    # Scripts auxiliares de manutenção e banco de dados
├── wrangler.jsonc              # Configuração do Cloudflare Workers e bindings D1
├── package.json
└── tsconfig*.json
```

---

## ⚙️ Instalação e Desenvolvimento Local

### Pré-requisitos
- **Node.js** v20+ instalado
- **Cloudflare Wrangler CLI** (`npm install -g wrangler` ou via `npx wrangler`)

### 1. Clonar o repositório e instalar dependências
```bash
git clone https://github.com/EdoardoFama/capi_finance.git
cd capi_finance
npm install
```

### 2. Executar migrações no banco local
```bash
npx wrangler d1 migrations apply capi-finance-db --local
```

### 3. Rodar a aplicação em ambiente de desenvolvimento
```bash
npm run dev
```
O Vite iniciará o frontend em `http://localhost:5173` e o Wrangler simulará a API e o banco D1 localmente na porta `8787`.

---

## ☁️ Deploy em Produção (Cloudflare Workers)

### 1. Autenticar no Cloudflare
```bash
npx wrangler login
```

### 2. Criar o banco D1 remoto (se ainda não existir)
```bash
npx wrangler d1 create capi-finance-db
```
*Copie o `database_id` gerado e cole no arquivo `wrangler.jsonc` no campo `database_id`.*

### 3. Aplicar as migrações no banco remoto
```bash
npx wrangler d1 migrations apply capi-finance-db --remote
```

### 4. Configurar segredos do SMTP (Opcional, para envio de e-mails)
```bash
npx wrangler secret put SMTP_USER
npx wrangler secret put SMTP_PASS
```

### 5. Compilar o frontend e publicar
```bash
npm run deploy
```
A aplicação estará disponível instantaneamente na sua URL `.workers.dev`.

---

## 🛡️ Regras de Controle de Versão (Git)

- Alterações em branches remotas ou comandos como `git commit` e `git push` **exigem estrita autorização prévia** do mantenedor do projeto.
- O histórico da branch principal `main` dispara o deploy de produção de forma contínua.

---

## 📄 Licença

Projeto pessoal e proprietário desenvolvido com 💚 para o controle financeiro independente e sustentável.
