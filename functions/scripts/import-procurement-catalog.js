#!/usr/bin/env node
// Trusted Admin import; dry-run by default. Existing cards and inventory are preserved.
const fs = require('node:fs');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { validateCatalogItem } = require('../lib/procurementLogic');
const { runProcurementAction } = require('../lib/procurement');

const option = name => process.argv[process.argv.indexOf(name) + 1];
async function main() {
  const project = option('--project'), file = option('--file');
  if (!process.argv.includes('--project') || project !== 'coolservice-crm' || !process.argv.includes('--file') || !file) throw new Error('Use --project coolservice-crm --file <private catalogue.json> [--execute]');
  if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('This release import requires the explicit production project, without an emulator.');
  const bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (bundle.schema !== 'coolservice-procurement-v1' || !Array.isArray(bundle.items) || !bundle.items.length || bundle.items.length > 10000) throw new Error('Invalid catalogue bundle');
  const items = bundle.items.map(validateCatalogItem);
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('Duplicate catalogue IDs');
  initializeApp({ projectId: project });
  const db = getFirestore();
  const existing = await db.collection('procurementCatalog').select().get();
  const known = new Set(existing.docs.map(doc => doc.id));
  const execute = process.argv.includes('--execute');
  console.log(JSON.stringify({ project, execute, items: items.length, sourceRows: items.reduce((sum, item) => sum + item.sources.length, 0), existing: existing.size, toCreate: items.filter(item => !known.has(item.id)).length }));
  if (!execute) return;
  let imported = 0, skipped = 0;
  for (let index = 0; index < items.length; index += 25) {
    const result = await db.runTransaction(tx => runProcurementAction(tx, 'importCatalog', { items: items.slice(index, index + 25) }, 'admin-release-import'));
    imported += result.imported; skipped += result.skipped;
  }
  const final = await db.collection('procurementCatalog').select('sources').get();
  const finalIds = new Set(final.docs.map(doc => doc.id));
  if (items.some(item => !finalIds.has(item.id))) throw new Error('Import verification failed');
  console.log(JSON.stringify({ verified: true, imported, skipped, catalogueDocuments: final.size, sourceRows: final.docs.reduce((sum, doc) => sum + (doc.data().sources?.length ?? 0), 0), stockChanged: false, cashflowChanged: false }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
