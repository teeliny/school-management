const formatter = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" });

export function formatCurrency(amount: number): string {
  return formatter.format(amount);
}
