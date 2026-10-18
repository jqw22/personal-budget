/**
 * Reduces a raw bank description to a short payee name, so that one rule
 * ("TESCO STORES" -> Groceries) matches every visit regardless of store
 * number, payment method or date.
 */
export function merchantName(description: string): string {
  let s = description.replace(/\s+/g, ' ').trim().toUpperCase();

  // Payee is the person or company named in transfers.
  const patterns: RegExp[] = [
    /^BILL PAYMENT (?:VIA FASTER PAYMENT )?TO (.+?) REFERENCE\b/,
    /^BILL PAYMENT FROM (?:MR |MRS |MISS |MS |DR )?(.+?), REFERENCE\b/,
    /^FASTER PAYMENTS RECEIPT REF\..*? FROM (.+)$/,
    /^CREDIT FROM (.+?) ON \d{2}-\d{2}-\d{4}/,
    /^CARD PAYMENT TO (.+?)(?: ,| ON \d{2}-\d{2}-\d{4})/,
    /^(BANK GIRO CREDIT REF [^,]+)/,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) {
      s = m[1];
      break;
    }
  }

  s = s
    // Payment method and transaction date, e.g. "(VIA APPLE PAY), ON 20-05-2026".
    .replace(/\s*\(VIA [^)]*\).*$/, '')
    .replace(/,? ON \d{2}-\d{2}-\d{4}.*$/, '')
    // Card processor prefixes, e.g. "SQ *", "ZETTLE_*", "SUMUP *".
    .replace(/^(?:SQ|ZETTLE_?|SUMUP|SP|IZ|PAYPAL) ?\*+ ?/, '')
    // Reference and store numbers, e.g. "BOLT.EU/O/2605302123", "BOOTS 1200", "REVOLUT**4472*".
    .replace(/\/O\/\d+$/, '')
    .replace(/\*+\d*\*?$/, '')
    .replace(/(?:\s+\d{3,})+$/, '')
    .replace(/\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return s || description.trim().toUpperCase();
}
