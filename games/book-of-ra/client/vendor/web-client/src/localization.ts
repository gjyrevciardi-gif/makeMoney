import IntlMessageFormat from "intl-messageformat";

export class MessageCatalog {
  readonly locale: string;
  readonly fallbackLocale: string;
  readonly messages: Record<string, string>;
  readonly fallback: Record<string, string>;

  constructor(locale: string, messages: Record<string, string>, fallbackLocale = "en", fallback: Record<string, string> = {}) {
    this.locale = locale;
    this.messages = messages;
    this.fallbackLocale = fallbackLocale;
    this.fallback = fallback;
  }

  format(key: string, values: Record<string, unknown> = {}): string {
    const message = this.messages[key] ?? this.fallback[key] ?? key;
    const locale = this.messages[key] ? this.locale : this.fallbackLocale;
    return String(new IntlMessageFormat(message, locale).format(values));
  }

  money(minorUnits: string, currency = "GBP"): string {
    return new Intl.NumberFormat(this.locale, { style: "currency", currency }).format(Number(BigInt(minorUnits)) / 100);
  }
}
