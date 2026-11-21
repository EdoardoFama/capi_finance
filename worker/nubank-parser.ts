export interface ParsedNubankEvent {
  type: 'expense' | 'inflow' | 'refund' | 'ignore';
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

export function cleanEstablishmentName(name: string): string {
  if (!name) return '';
  let s = name;
  // Remove sufixos de cartão, final, modalidade e mensagens do app
  s = s.replace(/\s+(?:para|no|com)\s+(?:o\s+)?(?:cart[aã]o\s+)?(?:virtual\s+)?(?:com\s+)?final\s+\d+.*$/i, '');
  s = s.replace(/\s+(?:com|no)\s+(?:o\s+)?cart[aã]o(?:\s+virtual)?(?:\s+final\s+\d+)?.*$/i, '');
  s = s.replace(/\s+(?:para\s+o\s+cart[aã]o).*$/i, '');
  s = s.replace(/\s+(?:com\s+final\s+\d+|final\s+\d+).*$/i, '');
  s = s.replace(/\s+no\s+(?:cr[eé]dito|d[eé]bito).*$/i, '');
  s = s.replace(/\s+(?:mas\s+voc[eê]\s+pode|pelo\s+app).*$/i, '');
  s = s.replace(/^[\s\.\-_:,]+|[\s\.\-_:,]+$/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

export function isMarketingOrPromo(text: string): boolean {
  const lower = text.toLowerCase();
  // Ofertas, descontos, promoções, cupons, cashback, resgate
  if (/\b(?:off|desconto|descontos|cupom|cupons|cashback|promoção|promocao|oferta|ofertas|resgate|resgatar)\b/i.test(lower)) {
    return true;
  }
  // Campanhas de marketing e parcerias
  if (/\b(?:só cliente|so cliente|cliente nubank|aproveite|experimente|saiba mais|conheça|conheca)\b/i.test(lower)) {
    return true;
  }
  // Empréstimos e simulações de crédito pessoal
  if (/\b(?:empréstimo|emprestimo|simule|simulação|simulacao|sujeito à análise|sujeito a analise)\b/i.test(lower)) {
    return true;
  }
  // Avisos de limite (aumento, oferta pré-aprovada, etc.)
  if (/\b(?:aumento de limite|aumentar seu limite|novo limite|limite pré-aprovado|limite pre-aprovado|ajuste seu limite)\b/i.test(lower)) {
    return true;
  }
  // Caixinhas, rendimentos e seguros
  if (/\b(?:guarde seu dinheiro|caixinha|rendeu|rendimento|seguro vida|seguro celular|seguro auto)\b/i.test(lower)) {
    return true;
  }
  // Produtos e serviços Nubank
  if (/\b(?:nucel|nu shopping|shopping nubank|shopping do nu|nucoins?|pontos rewards)\b/i.test(lower)) {
    return true;
  }
  // Programas de indicação, sorteios, etc.
  if (/\b(?:indique amigos|indique um amigo|sorteio|concorra|antecipe suas parcelas|antecipar parcelas)\b/i.test(lower)) {
    return true;
  }
  return false;
}

export function isInvoiceNotice(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('fatura') &&
    (lower.includes('fechou') ||
     lower.includes('fechada') ||
     lower.includes('fechamento') ||
     lower.includes('vencimento') ||
     lower.includes('aberta') ||
     lower.includes('paga') ||
     lower.includes('pagamento'))
  );
}

export function isDeniedOrCanceled(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('negada') ||
    lower.includes('negado') ||
    lower.includes('recusada') ||
    lower.includes('recusado') ||
    lower.includes('não autorizada') ||
    lower.includes('nao autorizada') ||
    lower.includes('não autorizado') ||
    lower.includes('nao autorizado') ||
    lower.includes('limite insuficiente') ||
    lower.includes('não aprovada') ||
    lower.includes('nao aprovada') ||
    lower.includes('bloqueada') ||
    lower.includes('bloqueado') ||
    lower.includes('cancelada') ||
    lower.includes('cancelado') ||
    lower.includes('não concluída') ||
    lower.includes('nao concluida') ||
    lower.includes('tentativa de compra')
  );
}

export function parseNubankNotification(titleInput = '', textInput = ''): ParsedNubankEvent {
  const fullText = `${titleInput} ${textInput}`.trim();
  const lower = fullText.toLowerCase();

  // 1. Extração do Valor em R$
  const amountMatch =
    fullText.match(/R\$\s*([\d\.]+(?:,\d{1,2})?)/i) ||
    fullText.match(/(?:valor|total|de)\s*([\d\.]+,\d{2})/i) ||
    fullText.match(/R\$\s*(\d+)/i) ||
    fullText.match(/(\d+,\d{2})/i);
  const amount_cents = amountMatch ? parseBrlCents(amountMatch[1]) : 0;

  // 1.1 Filtrar e ignorar compras negadas, recusadas, canceladas ou bloqueadas
  if (isDeniedOrCanceled(fullText)) {
    return {
      type: 'ignore',
      amount_cents,
      title: 'Compra Negada/Recusada',
      description: 'Notificação de compra negada, não autorizada ou cancelada (ignorada)',
      payment_method: 'credit',
      installments: 1,
      raw_text: fullText,
    };
  }

  // 1.2 Filtrar e ignorar avisos de fatura (fechamento, vencimento ou pagamento para não duplicar despesas)
  if (isInvoiceNotice(fullText)) {
    return {
      type: 'ignore',
      amount_cents,
      title: 'Aviso de Fatura',
      description: 'Notificação de fatura Nubank (ignorada para evitar duplicidade ou falso lançamento)',
      payment_method: 'credit',
      installments: 1,
      raw_text: fullText,
    };
  }

  // 1.3 Filtrar e ignorar notificações promocionais, ofertas, marketing, empréstimos e produtos
  if (isMarketingOrPromo(fullText)) {
    return {
      type: 'ignore',
      amount_cents,
      title: 'Notificação Promocional/Marketing',
      description: 'Notificação de oferta, marketing ou produto Nubank (ignorada)',
      payment_method: 'debit',
      installments: 1,
      raw_text: fullText,
    };
  }

  // 1.4 Detectar Transferência entre Contas Próprias / Mesma Titularidade (Item 06)
  const isSelfTransfer =
    lower.includes('mesma titularidade') ||
    lower.includes('entre suas contas') ||
    lower.includes('conta própria') ||
    lower.includes('conta propria') ||
    (lower.includes('edoardo') && (lower.includes('transferiu') || lower.includes('pix enviado')));

  if (isSelfTransfer) {
    return {
      type: 'ignore',
      amount_cents,
      title: 'Transferência Entre Contas Próprias',
      description: 'Transferência interna entre contas da mesma titularidade (ignorada para não duplicar saldo)',
      payment_method: 'pix',
      installments: 1,
      raw_text: fullText,
    };
  }

  // 1.5 Detectar Estorno / Reembolso / Devolução (Item 02)
  const isRefund =
    lower.includes('estorno') ||
    lower.includes('estornada') ||
    lower.includes('estornado') ||
    lower.includes('reembolso') ||
    lower.includes('reembolsada') ||
    lower.includes('reembolsado') ||
    lower.includes('devolução') ||
    lower.includes('devolucao') ||
    lower.includes('pix devolvido') ||
    lower.includes('compra cancelada e estornada');

  if (isRefund && amount_cents > 0) {
    let estab = 'Estorno';
    const estabMatch =
      fullText.match(/(?:em|no|na|de)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9\s\.\*\-_]+?)(?:\s*(?:foi|no\s+valor|\.|$))/i);
    if (estabMatch && estabMatch[1].trim()) {
      estab = cleanEstablishmentName(estabMatch[1].trim());
    }
    return {
      type: 'refund',
      amount_cents,
      title: estab.slice(0, 120),
      description: `Estorno/Reembolso automático (${estab})`,
      payment_method: lower.includes('pix') ? 'pix' : 'credit',
      installments: 1,
      raw_text: fullText,
    };
  }

  // 2. Se for recebimento (Inflow)
  const isInflow =
    lower.includes('recebeu') ||
    lower.includes('recebido') ||
    lower.includes('recebemos sua transferência') ||
    lower.includes('recebemos sua transferencia') ||
    lower.includes('te enviou') ||
    lower.includes('transferência recebida') ||
    lower.includes('transferencia recebida') ||
    lower.includes('pix recebido') ||
    lower.includes('crédito em conta') ||
    lower.includes('credito em conta') ||
    lower.includes('enviou um pix pra você') ||
    lower.includes('enviou um pix pra voce') ||
    lower.includes('fez um pix') ||
    lower.includes('mandou um pix');

  if (isInflow && amount_cents > 0) {
    let sender = 'Transferência Recebida';
    const senderMatch =
      fullText.match(/(?:de|por)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9\s\.\-_]+?)(?:\s*(?:via|no\s+valor|\.|$))/i) ||
      fullText.match(/([A-Za-zÀ-ÖØ-öø-ÿ\s]+?)\s+(?:te enviou|fez um pix|enviou|mandou)/i);
    if (senderMatch && senderMatch[1].trim()) {
      sender = senderMatch[1].trim().replace(/\.+$/, '');
      if (sender.toLowerCase().startsWith('nubank ')) {
        sender = sender.slice(7).trim();
      }
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

  // 3. Pix enviado
  const isPixSent =
    lower.includes('você transferiu') ||
    lower.includes('voce transferiu') ||
    lower.includes('transferência enviada') ||
    lower.includes('transferencia enviada') ||
    lower.includes('pix enviado') ||
    lower.includes('você enviou um pix') ||
    lower.includes('voce enviou um pix') ||
    lower.includes('transferência realizada') ||
    lower.includes('transferencia realizada');

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

  // 4. Compra aprovada no cartão (Crédito ou Débito)
  const isCardPurchase =
    (lower.includes('compra') && (lower.includes('aprovada') || lower.includes('crédito') || lower.includes('credito') || lower.includes('débito') || lower.includes('debito') || lower.includes('no valor') || lower.includes('no cartão') || lower.includes('no cartao'))) ||
    lower.includes('compra aprovada') ||
    lower.includes('compra no crédito aprovada') ||
    lower.includes('compra no débito aprovada') ||
    lower.includes('você pagou') ||
    lower.includes('voce pagou');

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
      fullText.match(/aprovada\s+(?:em|no|na)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9\s\.\*\-_]+?)(?:\s*(?:no\s+valor|com\s+o|para\s+o|no\s+cart[aã]o|\.|$))/i) ||
      fullText.match(/compra\s+de\s+r\$\s*[\d\.,]+\s+(?:aprovada\s+)?(?:em|no|na)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9\s\.\*\-_]+?)(?:\s*(?:no\s+valor|para\s+o|com\s+o|no\s+cart[aã]o|\.|$))/i) ||
      fullText.match(/(?:em|no|na)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9\s\.\*\-_]+?)(?:\s+(?:com|para)\s+o\s+cartão|\.|$)/i) ||
      fullText.match(/estabelecimento\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9\s\.\*\-_]+)/i);

    if (estabMatch && estabMatch[1].trim()) {
      establishment = cleanEstablishmentName(estabMatch[1].trim());
    } else {
      establishment = cleanEstablishmentName(establishment);
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

  // 5. Pagamento de boleto
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

  // 6. Mensagens não reconhecidas como transação financeira válida -> IGNORAR
  // (Evita que mensagens com números, ofertas como "R$ 500 OFF", propagandas ou avisos virem despesas)
  return {
    type: 'ignore',
    amount_cents,
    title: titleInput ? cleanEstablishmentName(titleInput) : '',
    description: 'Notificação não reconhecida como transação financeira válida (ignorada)',
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
