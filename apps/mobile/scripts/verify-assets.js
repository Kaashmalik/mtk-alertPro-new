#!/usr/bin/env node
/**
 * MTK AlertPro - Asset Verification Script
 * Checks if all required assets exist before building
 */

const fs = require('node:fs');
const path = require('node:path');

const ASSETS_DIR = path.join(__dirname, '../assets');

const REQUIRED_ASSETS = [
  { name: 'icon.png', purpose: 'Main app icon (iOS/Android)' },
  { name: 'splash-icon.png', purpose: 'Splash screen' },
  { name: 'adaptive-icon.png', purpose: 'Android adaptive icon' },
  { name: 'favicon.png', purpose: 'Web favicon' },
  { name: 'notification-icon.png', purpose: 'Push notification icon' },
];

console.log('MTK AlertPro - Asset Verification\n');
console.log('Checking assets in:', ASSETS_DIR, '\n');

let allExist = true;
const warnings = [];

for (const asset of REQUIRED_ASSETS) {
  const filePath = path.join(ASSETS_DIR, asset.name);
  const exists = fs.existsSync(filePath);

  if (exists) {
    const stats = fs.statSync(filePath);
    const sizeKB = (stats.size / 1024).toFixed(2);
    console.log(
      `OK    ${asset.name.padEnd(25)} (${sizeKB} KB) - ${asset.purpose}`,
    );

    if (stats.size < 1000) {
      warnings.push(
        `WARN  ${asset.name} is very small (${sizeKB} KB) - might be a placeholder`,
      );
    }
  } else {
    console.log(`MISS  ${asset.name.padEnd(25)} MISSING - ${asset.purpose}`);
    allExist = false;
  }
}

console.log('');

if (warnings.length > 0) {
  console.log('Warnings:\n');
  for (const warning of warnings) console.log(warning);
  console.log('');
}

if (allExist) {
  console.log('All required assets are present!\n');
  process.exit(0);
} else {
  console.log('Some assets are missing!\n');
  console.log(
    'Please save your uploaded images to apps/mobile/assets/ with these names:',
  );
  console.log('  - splash-icon.png');
  console.log('  - icon.png');
  console.log('  - adaptive-icon.png');
  console.log('  - favicon.png');
  process.exit(1);
}
