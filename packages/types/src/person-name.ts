// School convention (register/report-card style): "LASTNAME FIRSTNAME", upper case.
export function formatPersonName(person: { firstName: string; lastName: string }): string {
  return `${person.lastName} ${person.firstName}`.toUpperCase();
}

// Matches formatPersonName's order: last-name initial, then first-name initial.
export function personInitials(person: { firstName: string; lastName: string }): string {
  return `${person.lastName[0] ?? ""}${person.firstName[0] ?? ""}`.toUpperCase();
}
