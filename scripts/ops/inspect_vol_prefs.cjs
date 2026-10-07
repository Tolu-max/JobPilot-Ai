const fs = require('fs');
const p = JSON.parse(fs.readFileSync('/app/data/profiles/tolu/preferences.json', 'utf8'));
console.log('enabledSites:', JSON.stringify(p.enabledSites));
console.log('siteLimits:', JSON.stringify(p.siteLimits));
console.log('sitePriority:', JSON.stringify(p.sitePriority));
