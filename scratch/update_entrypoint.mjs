import fs from 'node:fs';

let s = fs.readFileSync('scripts/railway-entrypoint.sh', 'utf8');
const target = '[ -f "$prof_dir/candidateProfile.json" ] && cp -f "$prof_dir/candidateProfile.json" "$target/$prof_name/candidateProfile.json" 2>/dev/null || true';
const replacement = target + '\n          [ -f "$prof_dir/indeed_cookies.json" ] && cp -f "$prof_dir/indeed_cookies.json" "$target/$prof_name/indeed_cookies.json" 2>/dev/null || true\n          for cfile in "$prof_dir"/*cookies*.json; do [ -f "$cfile" ] && cp -f "$cfile" "$target/$prof_name/" 2>/dev/null || true; done';

if (s.includes(target)) {
  s = s.replace(target, replacement);
  fs.writeFileSync('scripts/railway-entrypoint.sh', s, 'utf8');
  console.log('Successfully updated scripts/railway-entrypoint.sh');
} else {
  console.log('Target string not found!');
}
