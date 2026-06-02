export function printDashboard(results, config = {}) {
  const label = config.displayName || config.profileName || 'default';
  console.log(`\nJob AI Agent - ${label}\n`);
  if (results.length === 0) {
    console.log('No jobs found.');
    return;
  }

  console.table(
    results.map((result) => ({
      'Job title': result.title,
      Source: result.source || '',
      Score: result.score,
      Decision: result.decision,
      Status: result.status
    }))
  );
}
