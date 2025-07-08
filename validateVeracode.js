// validateVeracode.js
// Script para validar correcciones de vulnerabilidades Veracode específicas

const fs = require('fs');
const path = require('path');

const targets = [
  { file: 'src/wdio-service/wdio-service.ts', checks: ['console.'] },
  { file: 'src/usbmux.ts', checks: ['console.'] },
  { file: 'src/proxy/wd-command-proxy.ts', checks: ['console.'] },
  { file: 'src/plugin.ts', checks: ['console.', 'http.Agent', 'rejectUnauthorized'] },
  { file: 'src/data-service/device-service.ts', checks: ['console.'] },
  { file: 'src/auth/middleware/auth.middleware.ts', checks: ['console.'] },
  { file: 'src/app/routers/grid.ts', checks: ['response.send', 'response.json'] },
  { file: 'src/auth/services/user.service.ts', checks: ['defaultAdminPassword', 'createInitialAdminIfNeeded'] },
  { file: 'test/e2e/plugin-harness.ts', checks: ['console.'] },
  { file: 'test/e2e/e2ehelper.ts', checks: ['console.'] },
  { file: 'AndroidManifest.xml', checks: ['android:exported'] }
];

function analyzeFile(target) {
  const filePath = path.join(__dirname, target.file);
  if (!fs.existsSync(filePath)) {
    console.warn(`[NO ENCONTRADO] ${target.file}`);
    return;
  }

  const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);
  let flagged = false;
  lines.forEach((line, i) => {
    target.checks.forEach(term => {
      if (line.includes(term) && !line.includes('sanitizeLog') && !line.includes('// ok')) {
        console.log(`[⚠️ Posible revisión] ${target.file}:${i + 1} => ${line.trim()}`);
        flagged = true;
      }
    });
  });

  if (!flagged) {
    console.log(`[✅ Validado] ${target.file}`);
  }
}

console.log('\n=== Verificación de Correcciones Veracode ===\n');
targets.forEach(analyzeFile);
