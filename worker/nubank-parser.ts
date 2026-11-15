export interface ParsedNubankEvent {
  type: 'expense' | 'inflow' | 'ignore';
  amount_cents: number;
  title: string;
  description: string;
  payment_method: 'credit' | 'debit' | 'pix';
  installments: number;
  category_hint?: string;
  raw_text: string;
}

export function parseBrlCents(raw: string): number {
  if (!raw) return 0;
  // Ex: "R$ 1.234,56" -> 123456 | "120,00" -> 12000 | "45.50" -> 4550
  const clean = raw.replace(/[^\d,\.]/g, '');
  if (!clean) return 0;

  if (clean.includes(',')) {
    // Formato brasileiro: 1.250,50 ou 50,00
    const normalized = clean.replace(/\./g, '').replace(',', '.');
    return Math.round(parseFloat(normalized) * 100);
  } else if (clean.includes('.')) {
    // Formato com ponto: 1250.50
    return Math.round(parseFloat(clean) * 100);
  }
  // Apenas inteiros
  return parseInt(clean, 10) * 100;
}

export function parseNubankNotification(titleInput = '', textInput = ''): ParsedNubankEvent {
  const fullText = `${titleInput} ${textInput}`.trim();
  const lower = fullText.toLowerCase();

  // 1. Extração do Valor em R$
  const amountMatch = fullText.match(/R\$\s*([\d\.]+(?:,\d{1,2})?)/i) ||
                      fullText.match(/(?:valor|total|de)\s*([\d\.]+,\d{2})/i);
  const amount_cents = amountMatch ? parseBrlCents(amountMatch[1]) : 0;

  // 2. Se for recebimento (Inflow)
  const isInflow =
    lower.includes('recebeu uma transferência') ||
    lower.includes('recebeu um pix') ||
    lower.includes('transferência recebida') ||
    lower.includes('pix recebido') ||
    lower.includes('crédito em conta') ||
    lower.includes('te enviou um pix');

  if (isInflow && amount_cents > 0) {
    let sender = 'Transferência Recebida';
    const senderMatch = fullText.match(/(?:de|por)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9\s\.\-_]+?)(?:\s*(?:via|\.|$))/i);
    if (senderMatch && senderMatch[1].trim()) {
      sender = senderMatch[1].trim().replace(/\.+$/, '');
    }
    return {
      type: 'inflow',
      amount_cents,
      title: `Pix de ${sender}`.slice(0, 120),
      description: `Recebimento automático via Nubank (${sender})`.slice(0, 200),
      payment_method: 'pix',
      installments: 1,
      raw_text: fullText,
    };
  }

  // 3. Pagamento de fatura (opcionalmente ignorar ou registrar)
  if (lower.includes('fatura') && (lower.includes('paga') || lower.includes('pagamento'))) {
    return {
      type: 'ignore', // Evita duplicar com as despesas já lançadas no cartão
      amount_cents,
      title: 'Pagamento de Fatura',
      description: 'Pagamento de fatura Nubank (ignorado para evitar duplicidade de lançamentos do cartão)',
      payment_method: 'debit',
      installments: 1,
      raw_text: fullText,
    };
  }

  // 4. Pix enviado
  const isPixSent =
    lower.includes('você transferiu') ||
    lower.includes('transferência enviada') ||
    lower.includes('pix enviado') ||
    lower.includes('você enviou um pix') ||
    lower.includes('transferência realizada');

  if (isPixSent && amount_cents > 0) {
    let recipient = 'Destinatário Pix';
    const recipMatch = fullText.match(/para\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9\s\.\-_]+?)(?:\s*(?:via|\.|$))/i);
    if (recipMatch && recipMatch[1].trim()) {
      recipient = recipMatch[1].trim().replace(/\.+$/, '');
    }
    return {
      type: 'expense',
      amount_cents,
      title: recipient.slice(0, 120),
      description: `Pix enviado pelo Nubank para ${recipient}`.slice(0, 200),
      payment_method: 'pix',
      installments: 1,
      category_hint: resolveCategoryHint(recipient),
      raw_text: fullText,
    };
  }

  // 5. Compra aprovada no cartão (Crédito ou Débito)
  const isCardPurchase =
    lower.includes('compra') ||
    lower.includes('aprovada') ||
    lower.includes('você pagou') ||
    lower.includes('cartão');

  if (isCardPurchase && amount_cents > 0) {
    const isDebit = lower.includes('débito') || lower.includes('debito');
    const payment_method = isDebit ? 'debit' : 'credit';

    // Extrair parcelamento (ex: "em 3x", "em 10x")
    let installments = 1;
    const instMatch = fullText.match(/em\s*(\d{1,2})x/i);
    if (instMatch && instMatch[1]) {
      const parsedInst = parseInt(instMatch[1], 10);
      if (parsedInst > 1 && parsedInst <= 48) installments = parsedInst;
    }

    // Extrair estabelecimento
    let establishment = 'Compra Nubank';
    const estabMatch =
      fullText.match(/aprovada\s+(?:em|no|na)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9\s\.\*\-_]+?)(?:\s*(?:no\s+valor|com\s+o|\.|$))/i) ||
      fullText.match(/(?:em|no|na)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9\s\.\*\-_]+?)(?:\s+com\s+o\s+cartão|\.|$)/i) ||
      fullText.match(/estabelecimento\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9\s\.\*\-_]+)/i);

    if (estabMatch && estabMatch[1].trim()) {
      establishment = estabMatch[1].trim().replace(/\.+$/, '');
    }

    return {
      type: 'expense',
      amount_cents,
      title: establishment.slice(0, 120),
      description: `Compra aprovada no Nubank (${payment_method}${installments > 1 ? ` em ${installments}x` : ''})`.slice(0, 200),
      payment_method,
      installments,
      category_hint: resolveCategoryHint(establishment),
      raw_text: fullText,
    };
  }

  // 6. Pagamento de boleto
  if (lower.includes('boleto') && amount_cents > 0) {
    return {
      type: 'expense',
      amount_cents,
      title: 'Boleto Pago',
      description: 'Pagamento de boleto via Nubank',
      payment_method: 'debit',
      installments: 1,
      category_hint: 'OUTROS',
      raw_text: fullText,
    };
  }

  // Se não foi possível identificar padrão claro com valor
  if (amount_cents > 0) {
    return {
      type: 'expense',
      amount_cents,
      title: titleInput ? titleInput.slice(0, 120) : 'Lançamento Nubank',
      description: fullText.slice(0, 200),
      payment_method: 'debit',
      installments: 1,
      category_hint: 'OUTROS',
      raw_text: fullText,
    };
  }

  return {
    type: 'ignore',
    amount_cents: 0,
    title: '',
    description: '',
    payment_method: 'debit',
    installments: 1,
    raw_text: fullText,
  };
}

export function resolveCategoryHint(text: string): string {
  const s = text.toLowerCase();
  if (/lidia/i.test(s)) return 'LIDIA-F';
  if (/posto|gasolina|combust[ií]vel|ipiranga|shell|petrobras/i.test(s)) return 'GASOLINA';
  if (/uber|99app|99\s*app|99taxis|estacionamento|parking|oficina|mecanic|auto\s*pe[cç]as/i.test(s)) return 'CARRO';
  if (/mercado|supermercado|atacadao|atacad[aã]o|assai|assa[ií]|carrefour|pao\s*de\s*a[cç]ucar|hortifruti|feira|sacolao|sacol[aã]o/i.test(s)) return 'FEIRA';
  if (/mcdonald|burger|bk|pizza|ifood|habib|subway|restaurante|bar|padaria|lanche|cafeteria|choperia|sorvete|a[cç]ai/i.test(s)) return 'LANCHE/ETC';
  if (/farm[aá]cia|drogaria|drogasil|pague\s*menos|panvel|raia|droga\s*raia/i.test(s)) return 'FARMÁCIA';
  if (/condom[ií]nio/i.test(s)) return 'CONDOMÍNIO-F';
  if (/energia|enel|cpfl|cemig|copel|elektro/i.test(s)) return 'ENERGIA-F';
  if (/claro|vivo|tim|oi|recarreg/i.test(s)) return 'DADOS MÓVEIS-F';
  if (/internet|fibra|provedor/i.test(s)) return 'INTERNET-F';
  if (/netflix|spotify|amazon\s*prime|youtube|disney|hbo|apple\.com|google\s*storage/i.test(s)) return 'ASSINATURAS';
  if (/cabelo|barbearia|barbeiro|salao|sal[aã]o/i.test(s)) return 'CABELO-F';
  if (/renner|zara|c&a|riachuelo|roupa|vestuario|calcado|cal[cç]ado|centauro/i.test(s)) return 'ROUPAS';
  if (/rdb|nuinvest|tesouro|investimento|caixinha/i.test(s)) return 'INVESTIMENTO';
  if (/steam|playstation|xbox|nintendo|epic\s*games|blizzard/i.test(s)) return 'JOGOS';
  return 'OUTROS';
}
