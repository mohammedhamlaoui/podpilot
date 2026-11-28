import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(new URL('../package.json', import.meta.url));
const { transform } = require('esbuild');
const React = require('react');
const jsxRuntime = require('react/jsx-runtime');
const { renderToStaticMarkup } = require('react-dom/server');
const source = (await transform(await readFile(new URL('../src/components/CheckoutPage.jsx', import.meta.url), 'utf8'),
  { loader: 'jsx', jsx: 'automatic', format: 'esm' })).code;

async function scenario({ status, credits = false, failPortal = false, missingBillingAccount = false }) {
  const values = [], effects = [];
  let cursor = 0, portalOpens = 0, destination, manageClick, portalFailure = failPortal;
  const context = vm.createContext({ console, URLSearchParams,
    window: { location: { search: credits ? '?plan=ai-credits&credits=1000' : '?plan=redbubble&billing=annual',
      assign(url) { destination = url; } }, setTimeout() { return 1; }, clearTimeout() {} } });
  const exportsFor = (values) => new vm.SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  }, { context });
  const noOp = () => {};
  const modules = {
    react: exportsFor({ useState(initial) {
      const index = cursor++;
      if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [values[index], (value) => { values[index] = typeof value === 'function' ? value(values[index]) : value; }];
    }, useEffect(effect) { effects.push(effect); }, useCallback: (fn) => fn, useRef: () => ({ current: null }) }),
    'react/jsx-runtime': exportsFor({ ...jsxRuntime, jsx(type, props, key) {
      if (type === 'button' && props.children?.[1] === 'Manage subscription') manageClick = props.onClick;
      return jsxRuntime.jsx(type, props, key);
    }, jsxs(type, props, key) {
      if (type === 'button' && props.children?.[1] === 'Manage subscription') manageClick = props.onClick;
      return jsxRuntime.jsxs(type, props, key);
    } }),
    'lucide-react': exportsFor(Object.fromEntries(['ArrowLeft','CheckCircle2','ShieldCheck','Check','Sparkles','Mail','HelpCircle','Settings2'].map(k => [k, () => null]))),
    '../auth/AuthContext': exportsFor({ useAuth: () => ({ loading: false, user: { id: 'fixture', email: 'fixture@example.com' } }) }),
    '../lib/paddle': exportsFor({ CHECKOUT_CONFIGURATION_ERROR_MESSAGE: 'Configuration error', closePaddleCheckout: noOp,
      isCheckoutConfigurationError: () => false, openPaddleCheckout: async () => noOp,
      initializePaddlePaymentLink: async () => noOp, isPaddleConfigured: () => true }),
    '../lib/pendingCheckout': exportsFor({ setPendingCheckoutPlan: noOp }),
    '../api/client': exportsFor({ getCheckoutConfig: async () => {
      if (status) throw { response: { status, data: { detail: 'Test checkout response' } } };
      return { selected_price_id: 'pri_fixture' };
    }, createBillingPortalSession: async () => {
      portalOpens++;
      if (portalFailure) {
        if (missingBillingAccount) throw { response: { data: { detail: {
          code: 'BILLING_ACCOUNT_RECONCILIATION_REQUIRED', message: 'Contact support to reconcile your subscription.' } } } };
        throw new Error('Temporary portal outage');
      }
      return { url: 'https://customer-portal.paddle.com/fixture' };
    } }),
    './Icon': exportsFor({ default: () => null }),
    '../config/commercial': exportsFor({ GUARANTEE_CONFIRMED: false }),
    './PublicHeader': exportsFor({ default: () => null }),
    './PublicFooter': exportsFor({ default: () => null }),
    '../utils/useSeo': exportsFor({ useSeo: noOp }),
  };
  const module = new vm.SourceTextModule(source, { context, initializeImportMeta(meta) { meta.env = {}; } });
  await module.link(name => modules[name]); await module.evaluate();
  function render() { cursor = 0; return renderToStaticMarkup(React.createElement(module.namespace.default, {})); }
  render();
  for (const effect of effects.splice(0)) effect();
  await new Promise(resolve => setImmediate(resolve));
  const html = render();
  if (status === 409 && !credits) {
    assert.match(html, /Manage subscription/);
    assert.doesNotMatch(html, /Checkout is temporarily unavailable|class="paddle-checkout-frame"/);
    assert.equal(portalOpens, 0); // Never auto-redirect or create a portal session on render.
    await manageClick();
    assert.equal(portalOpens, 1);
    if (failPortal) {
      assert.equal(destination, undefined);
      assert.match(render(), /role="alert"/);
      if (missingBillingAccount) assert.match(render(), /Contact support to reconcile your subscription/);
      portalFailure = false;
      await manageClick();
      assert.equal(portalOpens, 2);
      assert.equal(destination, 'https://customer-portal.paddle.com/fixture');
    } else {
      assert.equal(destination, 'https://customer-portal.paddle.com/fixture');
    }
  } else if (status) {
    assert.match(html, /Checkout is temporarily unavailable/);
    assert.doesNotMatch(html, /Manage subscription/);
  } else {
    assert.match(html, /class="paddle-checkout-frame"/);
    assert.doesNotMatch(html, /Manage subscription|Checkout is temporarily unavailable/);
  }
}
await scenario({ status: 409 });
await scenario({ status: 409, failPortal: true });
await scenario({ status: 409, failPortal: true, missingBillingAccount: true });
await scenario({ status: 503 });
await scenario({ status: 409, credits: true });
await scenario({ status: 0 });
console.log('PASS existing subscriber management, portal redirect/retry, other errors, AI-credit compatibility and new checkout');
