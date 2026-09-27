import { encryptSecret, decryptSecret, createTokenFingerprint, redactSecrets, hashGatewayKey } from '../server/security/vault.js';
import { analyzeZipBuffer } from '../server/deployment/zip.analyzer.js';
import { verifyGitHubRenderRelationship } from '../server/deployment/relationship.engine.js';
import { evaluateCostPolicy } from '../server/free-service/cost-guard.js';

async function runTests() {
  console.log('--- RUNNING SECURITY & INTEGRATION TESTS ---');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}`);
      failed++;
    }
  }

  // Test 1: AES-256-GCM Vault Encryption & Decryption
  try {
    const rawSecret = 'ghp_secretTokenTest1234567890abcdefghijklmnopqrstuvwxyz';
    const encrypted = encryptSecret(rawSecret);
    assert(encrypted.includes(':'), 'Vault generates iv:tag:ciphertext format');
    const decrypted = decryptSecret(encrypted);
    assert(decrypted === rawSecret, 'Vault correctly decrypts to original plaintext');
  } catch (err: any) {
    assert(false, `Vault encryption error: ${err.message}`);
  }

  // Test 2: Token Fingerprinting for Duplicate Detection
  try {
    const tokenA = 'rnd_exampleApiKey12345';
    const tokenB = 'rnd_exampleApiKey12345';
    const tokenC = 'rnd_differentKey67890';
    const fpA = createTokenFingerprint(tokenA);
    const fpB = createTokenFingerprint(tokenB);
    const fpC = createTokenFingerprint(tokenC);
    assert(fpA === fpB, 'Identical tokens produce identical HMAC fingerprint');
    assert(fpA !== fpC, 'Different tokens produce unique fingerprints');
  } catch (err: any) {
    assert(false, `Fingerprinting error: ${err.message}`);
  }

  // Test 3: Secret Redaction in Logs
  try {
    const logString = 'Connecting with Bearer ghp_secret1234567890abcdefghijklmnopqr and rnd_abc1234567890defghij';
    const redacted = redactSecrets(logString);
    assert(!redacted.includes('ghp_secret'), 'GitHub token redacted from log string');
    assert(!redacted.includes('rnd_abc'), 'Render API key redacted from log string');
  } catch (err: any) {
    assert(false, `Redaction error: ${err.message}`);
  }

  // Test 4: Gateway Key SHA-256 Hashing
  try {
    const rawKey = 'gw_0123456789abcdef01234567';
    const hashed1 = hashGatewayKey(rawKey);
    const hashed2 = hashGatewayKey(rawKey);
    assert(hashed1 === hashed2, 'Gateway key hash is deterministic');
    assert(hashed1.length === 64, 'SHA-256 produces 64-char hex digest');
  } catch (err: any) {
    assert(false, `Gateway hash error: ${err.message}`);
  }

  // Test 5: Cost Guard Policy
  try {
    const resultFree = evaluateCostPolicy('render', 'deploy', { plan: 'free' });
    assert(resultFree.allowed === true, 'Free tier deploy allowed under ask-before-paid');

    const resultPaid = evaluateCostPolicy('render', 'deploy', { plan: 'pro_plus' });
    assert(resultPaid.allowed === false && resultPaid.isPaid === true, 'Paid plan paused pending authorization');
  } catch (err: any) {
    assert(false, `Cost policy test error: ${err.message}`);
  }

  console.log('-------------------------------------------');
  console.log(`Test Results: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runTests();
