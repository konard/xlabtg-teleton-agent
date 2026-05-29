export function formatDate(input: string | number | null | undefined, epochScale = 1): string {
  if (input == null) return '\u2014';
  const date = typeof input === 'number' ? new Date(input * epochScale) : new Date(input);
  return date.toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(input: string | number | null | undefined, epochScale = 1): string {
  if (input == null) return '\u2014';
  const date = typeof input === 'number' ? new Date(input * epochScale) : new Date(input);
  return date.toLocaleString('fr-FR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
