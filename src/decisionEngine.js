export function decide(score) {
  if (score >= 95) return 'instant_apply';
  if (score >= 88) return 'auto_apply';
  if (score >= 75) return 'review';
  return 'ignore';
}
