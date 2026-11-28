import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

let initialized = 0;
let offerRequests = 0;
let explicitOpens = 0;
let sdkOptions;
const context = vm.createContext({ console, window: { location: { origin: 'https://podpilot.space' } } });
const sdk = new vm.SyntheticModule(['initializePaddle'], function () {
  this.setExport('initializePaddle', async (options) => {
    initialized++;
    sdkOptions = options;
    return { Checkout: { open() { explicitOpens++; } } };
  });
}, { context });
const config = new vm.SyntheticModule(['PADDLE_CONFIG', 'isPaddleConfigured', 'getPaddlePriceId', 'isAnnualPaddleConfigured'], function () {
  this.setExport('PADDLE_CONFIG', { environment: 'production', clientToken: 'public-test-fixture' });
  this.setExport('isPaddleConfigured', () => true);
  this.setExport('getPaddlePriceId', () => '');
  this.setExport('isAnnualPaddleConfigured', () => true);
}, { context });
const api = new vm.SyntheticModule(['getCheckoutConfig'], function () {
  this.setExport('getCheckoutConfig', () => { offerRequests++; throw new Error('Payment links must not resolve offers'); });
}, { context });
const source = await readFile(new URL('../src/lib/paddle.js', import.meta.url), 'utf8');
const module = new vm.SourceTextModule(source, { context, initializeImportMeta(meta) { meta.env = {}; } });
await module.link((name) => name.includes('paddle-js') ? sdk : name.includes('config/paddle') ? config : api);
await module.evaluate();
let received = 0;
const remove = await module.namespace.initializePaddlePaymentLink(() => { received++; });
assert.equal(initialized, 1);
assert.equal(offerRequests, 0);
assert.equal(explicitOpens, 0); // Let Paddle.js process _ptxn, never override with new items.
sdkOptions.eventCallback({ name: 'checkout.loaded' });
assert.equal(received, 1);
remove();
sdkOptions.eventCallback({ name: 'checkout.loaded' });
assert.equal(received, 1);
const removeSecond = await module.namespace.initializePaddlePaymentLink(() => {});
assert.equal(initialized, 1);
removeSecond();
console.log('PASS payment-link SDK initialization, no new offer or item checkout, event dispatch, cleanup and single-flight');
