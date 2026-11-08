// Gera seed/seed.sql a partir de scripts/users.local.json (ou users.example.json) e orçamentos configurados
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
}

mkdirSync(new URL('../seed/', import.meta.url), { recursive: true });
writeFileSync(new URL('../seed/seed.sql', import.meta.url), lines.join('\n') + '\n');
console.log(`seed/seed.sql gerado com sucesso usando ${usersFile}.`);
