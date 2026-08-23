const fs = require('fs');
const path = require('path');

function extractSchema(dir) {
  let sql = [];
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      sql = sql.concat(extractSchema(fullPath));
    } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      
      // Match CREATE TABLE ... (...)
      let match;
      const regex = /CREATE TABLE IF NOT EXISTS\s+([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)/g;
      while ((match = regex.exec(content)) !== null) {
        let tableName = match[1];
        let columns = match[2];
        
        // Convert SQLite to Postgres syntax
        columns = columns.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY');
        columns = columns.replace(/TEXT PRIMARY KEY/g, 'TEXT PRIMARY KEY');
        
        sql.push(`CREATE TABLE IF NOT EXISTS ${tableName} (\n${columns}\n);`);
      }
    }
  }
  return sql;
}

const statements = extractSchema(path.join(__dirname, '..', 'src'));
fs.writeFileSync('schema.sql', statements.join('\n\n'));
console.log('Schema extracted to schema.sql');
