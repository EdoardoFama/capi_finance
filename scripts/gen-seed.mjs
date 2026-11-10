// Gera seed/seed.sql a partir de scripts/users.local.json (ou users.example.json), orçamentos e investimentos
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const ITERATIONS = 100_000;

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');
  return `pbkdf2$${ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const usersFile = existsSync(new URL('./users.local.json', import.meta.url))
  ? './users.local.json'
  : './users.example.json';

const users = JSON.parse(readFileSync(new URL(usersFile, import.meta.url), 'utf8'));

const budgetLocalPath = new URL('./budget.local.json', import.meta.url);
const budgetExamplePath = new URL('./budget.example.json', import.meta.url);
const exampleBudget = JSON.parse(readFileSync(budgetExamplePath, 'utf8'));
const localBudget = existsSync(budgetLocalPath)
  ? JSON.parse(readFileSync(budgetLocalPath, 'utf8'))
  : exampleBudget;

const invLocalPath = new URL('./investments.local.json', import.meta.url);
const invExamplePath = new URL('./investments.example.json', import.meta.url);
const exampleInvestments = JSON.parse(readFileSync(invExamplePath, 'utf8'));
const localInvestments = existsSync(invLocalPath)
  ? JSON.parse(readFileSync(invLocalPath, 'utf8'))
  : exampleInvestments;

const lines = [];

for (const user of users) {
  const u = user.username.trim().toLowerCase();
  lines.push(
    `INSERT INTO users (username, password_hash) VALUES (${q(u)}, ${q(hashPassword(user.password))}) ` +
      `ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash;`,
  );

  const budgetData = user.budget === 'local' ? localBudget : exampleBudget;

  budgetData.incomes.forEach((inc, i) => {
    lines.push(
      `INSERT OR IGNORE INTO incomes (user_id, name, amount_cents, sort_order) ` +
        `SELECT id, ${q(inc.name)}, ${inc.amount * 100}, ${i + 1} FROM users WHERE username = ${q(u)};`,
    );
  });

  budgetData.categories.forEach((cat, i) => {
    lines.push(
      `INSERT OR IGNORE INTO categories (user_id, name, budget_cents, note, sort_order) ` +
        `SELECT id, ${q(cat.name)}, ${cat.amount * 100}, ${q(cat.note || '')}, ${i + 1} FROM users WHERE username = ${q(u)};`,
    );
  });

  const invData = user.budget === 'local' ? localInvestments : exampleInvestments;

  invData.accounts.forEach((acc, i) => {
    lines.push(
      `INSERT OR IGNORE INTO investment_accounts (user_id, name, color, sort_order) ` +
        `SELECT id, ${q(acc.name)}, ${q(acc.color)}, ${i + 1} FROM users WHERE username = ${q(u)};`,
    );
  });

  for (const m of invData.months) {
    for (const [accName, rec] of Object.entries(m.records)) {
      lines.push(
        `INSERT INTO investment_snapshots (user_id, account_id, month, balance_cents, delta_cents) ` +
          `SELECT u.id, a.id, ${q(m.month)}, ${rec.balance * 100}, ${rec.delta * 100} ` +
          `FROM users u JOIN investment_accounts a ON a.user_id = u.id AND a.name = ${q(accName)} ` +
          `WHERE u.username = ${q(u)} ` +
          `ON CONFLICT(user_id, account_id, month) DO UPDATE SET balance_cents = excluded.balance_cents, delta_cents = excluded.delta_cents;`,
      );
    }
  }
}

mkdirSync(new URL('../seed/', import.meta.url), { recursive: true });
writeFileSync(new URL('../seed/seed.sql', import.meta.url), lines.join('\n') + '\n');
console.log(`seed/seed.sql gerado com sucesso usando ${usersFile}.`);
