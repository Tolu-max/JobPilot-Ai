const fs = require('fs');

const path = 'src/automation.js';
let content = fs.readFileSync(path, 'utf-8');

const functionsToMark = [
  'fillAtsPlatformFields',
  'findApplyControl',
  'findFinalSubmitControl',
  'findContinueControl',
  'findAnySubmitControl',
  'findSkipControl',
  'findLastResortButton',
  'navigateMultiStepForm',
  'fillRequiredEmptyFields',
  'fillSelectDropdowns'
];

functionsToMark.forEach(fn => {
  const regex = new RegExp(\`(async function \${fn}\\(|function \${fn}\\()\`, 'g');
  content = content.replace(regex, '// TODO: extract to adapter\\n$1');
});

fs.writeFileSync(path, content, 'utf-8');
console.log('Marked dead code in automation.js');
