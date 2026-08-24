import fs from 'fs';
import path from 'path';

const srcDir = './src';
const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.ts') || f.endsWith('.tsx'));

for (const file of files) {
  const filePath = path.join(srcDir, file);
  let content = fs.readFileSync(filePath, 'utf-8');

  if (content.includes('async function db() {') && content.includes('Database.load(DB_PATH)')) {
    if (!content.includes('isTauri = "__TAURI_INTERNALS__" in window')) {
      const regex = /async function db\(\) \{[\s\S]*?return databasePromise;\r?\n\}/;
      const dbFuncMatch = content.match(regex);
      
      if (dbFuncMatch) {
        const safeDbFunc = `async function db() {
  if (!databasePromise) {
    const isTauri = "__TAURI_INTERNALS__" in window;
    if (isTauri) {
      databasePromise = Database.load(DB_PATH);
    } else {
      console.warn("Running in Web Mode. Local database is not available for " + DB_PATH);
      databasePromise = Promise.resolve({
        execute: async () => ({ lastInsertId: 0, rowsAffected: 0 }),
        select: async () => [],
      } as any);
    }
  }
  return databasePromise;
}`;
        content = content.replace(regex, safeDbFunc);
        fs.writeFileSync(filePath, content, 'utf-8');
        console.log(`Patched ${file}`);
      } else {
        console.log(`Failed regex for ${file}`);
      }
    }
  }
}
