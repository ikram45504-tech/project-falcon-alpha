const { spawn } = require('child_process');
const path = require('path');

const keyPath = "C:\\Users\\LAPTOOL TECHNOLOGY\\.gemini\\antigravity-ide\\brain\\b03a6a05-97c1-4aec-92ed-0a1ac88ef97d\\scratch\\tauri.key";

const child = spawn('npx', ['tauri', 'signer', 'generate', '-w', `"${keyPath}"`], {
    shell: true,
    cwd: 'C:\\Users\\LAPTOOL TECHNOLOGY\\travel-accounting'
});

child.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(output);
    if (output.includes('password')) {
        // Send a blank password (twice: once for prompt, once for confirmation)
        child.stdin.write('\n\n');
    }
});

child.stderr.on('data', (data) => {
    console.error(data.toString());
});

child.on('close', (code) => {
    console.log(`Process exited with code ${code}`);
});
