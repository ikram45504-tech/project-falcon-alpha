const { spawnSync } = require('child_process');

const passwords = ['travel123', 'travel1123', ''];

for (const pw of passwords) {
  console.log(`Testing password: "${pw}"`);
  const res = spawnSync('npx.cmd', ['tauri', 'signer', 'sign', '-p', pw, 'package.json'], {
    env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: process.cwd() + '\\tauri.keys' }
  });
  
  if (res.status === 0) {
    console.log(`✅ MATCH FOUND! The password is: "${pw}"`);
    process.exit(0);
  }
}
console.log(`❌ None of those passwords matched.`);
