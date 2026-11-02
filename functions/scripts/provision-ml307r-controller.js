// Scoped, create-only provisioning for the separately authorized ML307R bench.
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {randomBytes} = require('node:crypto');
const {initializeApp} = require('firebase-admin/app');
const {getFirestore, Timestamp} = require('firebase-admin/firestore');
const {createDeviceCredentialHash} = require('../lib/telemetryKey');
const id = 'coolmonitor-ml307r-001';
const projectId = 'coolservice-crm';
const expectedOutput = path.resolve('C:/Users/Admin/Documents/ChatGPT/ESP32/firmware/ml307r_direct_status/device_config.h');
async function main() {
  if (!process.argv.includes('--execute')) throw Error('Explicit --execute is required');
  const index = process.argv.indexOf('--config-output');
  if (index < 0 || path.resolve(process.argv[index+1] || '') !== expectedOutput) throw Error('Only the scoped ignored device_config.h is permitted');
  if (fs.existsSync(expectedOutput)) throw Error('Configuration already exists; refusing to replace credential');
  execFileSync('git',['check-ignore','--quiet',expectedOutput],{cwd:'C:/Users/Admin/Documents/ChatGPT/ESP32'});
  initializeApp({projectId});
  const db=getFirestore();
  const device=db.doc(`monitoringDevices/${id}`);
  const credential=db.doc(`monitoringDeviceCredentials/${id}`);
  const key=randomBytes(32).toString('base64url');
  fs.mkdirSync(path.dirname(expectedOutput),{recursive:true});
  fs.writeFileSync(expectedOutput,`#pragma once\n#define CONTROLLER_ID "${id}"\n#define CRM_DEVICE_KEY "${key}"\n`,{encoding:'utf8',flag:'wx',mode:0o600});
  try {
    await db.runTransaction(async tx=>{
      const [d,c]=await Promise.all([tx.get(device),tx.get(credential)]);
      if(d.exists||c.exists) throw Error('Device or credential exists; no changes made');
      const now=Timestamp.now();
      tx.create(device,{name:'CoolMonitoring ML307R — стенд',enabled:true,isTest:true,transport:'https',createdAt:now,updatedAt:now});
      tx.create(credential,{active:true,...createDeviceCredentialHash(id,key),createdAt:now});
    });
  } catch(error) { fs.unlinkSync(expectedOutput); throw error; }
  console.log(JSON.stringify({created:id,name:'CoolMonitoring ML307R — стенд',keyStoredLocally:true,keyDisclosed:false,oldDeviceModified:false}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
