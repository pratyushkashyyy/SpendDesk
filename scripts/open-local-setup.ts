import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const config=JSON.parse(await readFile('.local/config.json','utf8'));
spawn('open',[`http://127.0.0.1:3000/setup#${config.SETUP_TOKEN}`],{stdio:'ignore'});
console.log('Private local setup link opened.');
