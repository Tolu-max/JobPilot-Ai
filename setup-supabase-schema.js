/**
 * Setup Supabase schema - creates tables if they don't exist
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

// Read the schema file
const schema = fs.readFileSync('./src/api/schema.sql', 'utf8');

console.log('Applying Supabase schema...');
console.log('Note: This uses the Supabase SQL endpoint');

// Split schema into individual statements
const statements = schema
  .split(';')
  .map(s => s.trim())
  .filter(s => s && !s.startsWith('--'));

let successCount = 0;
let errorCount = 0;

for (const statement of statements) {
  if (!statement) continue;

  try {
    // Use the Supabase RPC to execute SQL
    const { error } = await supabase.rpc('exec_sql', { sql: statement });

    if (error) {
      console.error(`Error executing statement: ${error.message}`);
      errorCount++;
    } else {
      successCount++;
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    errorCount++;
  }
}

console.log(`\n✓ Schema setup complete!`);
console.log(`  Success: ${successCount} statements`);
console.log(`  Errors: ${errorCount} statements`);

if (errorCount > 0) {
  console.log('\nNote: Some errors are expected if tables already exist.');
}
