const dateOnlyFields = new Set(['date_of_birth', 'follow_up_date', 'appointment_date']);

export function normalizeRows(rows = []) {
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => {
    const name = key.toLowerCase();
    if (value instanceof Date) {
      if (dateOnlyFields.has(name)) {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(value);
        const part = type => parts.find(item => item.type === type).value;
        return [name, `${part('year')}-${part('month')}-${part('day')}`];
      }
      return [name, value.toISOString()];
    }
    return [name, value];
  })));
}
