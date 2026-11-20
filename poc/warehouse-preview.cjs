/* Isolated browser transport. No hosted checkout configuration changes. */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

// Use the same visible, installed Chrome for manual previews and regression tests.
// BigCommerce rejects session sync from crawler/headless-shell identities.
// Do not spoof headers or disable browser security to work around that check.
async function launchPreviewBrowser() {
    return chromium.launch({
        headless: false,
        ...(process.env.CHROME_EXECUTABLE
            ? { executablePath: process.env.CHROME_EXECUTABLE }
            : { channel: 'chrome' }),
    });
}

async function attachPreview(context, page, options) {
    const storefrontOrigin = new URL(options.storefrontUrl).origin;
    const buildDir = options.buildDir || path.resolve(__dirname, '../build');
    if (!fs.existsSync(path.join(buildDir, 'auto-loader-dev.js'))) {
        throw new Error('Build checkout assets with npm run dev before launching the preview.');
    }
    let phase = 'storefront', checkoutOrigin, shell, lastHandoff;
    const events = [], errors = [];
    let readyResolve, readyReject;
    let ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    ready.catch(() => {});
    const scriptJson = value => JSON.stringify(value).replace(/</g, '\\u003c');
    const htmlAttribute = value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    page.on('requestfailed', request => {
        if (new URL(request.url()).pathname === '/api/warehouse/validate') events.push({path:'/api/warehouse/validate',failed:request.failure()?.errorText});
    });
    page.on('pageerror', error => { if (phase !== 'session') errors.push(error.message); });
    async function bootstrap(handoff) {
        lastHandoff = handoff;
        if (handoff.protocol !== 'warehouse-preview-v2' || !handoff.warehouseCheckout?.preview) throw new Error('Invalid preview handoff');
        checkoutOrigin = new URL(handoff.checkoutUrl).origin;
        if (!checkoutOrigin.startsWith('https://')) throw new Error('Checkout must use HTTPS');
        phase = 'bootstrap';
        const validationUrl = new URL(handoff.warehouseCheckout.validation.endpoint);
        if (validationUrl.origin === storefrontOrigin && ['localhost', '127.0.0.1'].includes(validationUrl.hostname)) {
            // Scope local-network permission to this isolated checkout origin only.
            // CORS and capability authentication still apply to every validation call.
            await context.grantPermissions(['local-network-access'], { origin: checkoutOrigin });
        }
        // The browser has already followed the handoff into the hosted checkout session.
        const hosted = await page.evaluate(() => ({ language: window.language, styles: [...document.querySelectorAll('link[rel="stylesheet"]')].map(link => link.href) }));
        if (options.customer) {
            phase = 'sdk';
            await page.setContent('<p>Preparing isolated checkout preview…</p>');
            await page.addScriptTag({ url: 'https://checkout-sdk.bigcommerce.com/v1/loader.js' });
            await page.evaluate(async ({ cartId, customer }) => {
                const sdk = await checkoutKitLoader.load('checkout-sdk');
                const service = sdk.createCheckoutService();
                await service.loadCheckout(cartId);
                await service.signInCustomer(customer);
            }, { cartId: handoff.warehouseCheckout.cartId, customer: options.customer });
        }
        const config = { containerId: 'checkout-app', checkoutId: handoff.warehouseCheckout.cartId, publicPath: checkoutOrigin + '/__warehouse_preview/' };
        shell = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Warehouse checkout preview</title>' + hosted.styles.map(url => '<link rel="stylesheet" href="' + htmlAttribute(url) + '">').join('') + '</head><body><header style="padding:16px 24px;border-bottom:1px solid #ddd;font:16px sans-serif">Isolated checkout preview · Order submission disabled · <a href="' + htmlAttribute(options.storefrontUrl + '/cart/') + '">Return to cart</a></header><div id="checkout-app"></div><script>window.checkoutConfig=' + scriptJson(config) + ';window.warehouseCheckout=' + scriptJson(handoff.warehouseCheckout) + ';window.language=' + scriptJson(hosted.language || { locale: 'en', locales: {}, translations: {} }) + ';</script><script src="/__warehouse_preview/auto-loader-dev.js"></script></body></html>';
        phase = 'app';
        await page.goto(checkoutOrigin + '/checkout', { waitUntil: 'domcontentloaded' });
        await page.locator('.checkout-steps').waitFor({ timeout: 60000 });
        readyResolve(handoff.warehouseCheckout);
    }
    let pendingHandoff;
    page.on('response', response => {
        const url = new URL(response.url());
        if (url.pathname === '/session-sync') {
            const token = url.searchParams.get('jwt');
            let ageSeconds;
            try { ageSeconds = Math.floor(Date.now()/1000) - JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).iat; } catch {}
            const headers = response.request().headers();
            const crawlerBrowser = /HeadlessChrome/i.test((headers['user-agent'] || '') + (headers['sec-ch-ua'] || ''));
            events.push({path:url.pathname,status:response.status(),ageSeconds,crawlerBrowser});
            if (response.status() >= 400) {
                const message = crawlerBrowser
                    ? 'Session sync rejected this headless browser. Use launchPreviewBrowser() or the visible Chrome preview command.'
                    : `BigCommerce session sync returned HTTP ${response.status()}. Return to the cart before retrying.`;
                errors.push(message);
                readyReject(new Error(message));
                if (options.onError) options.onError(message);
            }
        }
        if (response.request().isNavigationRequest() && url.origin === storefrontOrigin && /(?:^|\/)checkout\/?$/.test(url.pathname) && response.headers()['content-type']?.includes('application/json')) {
            pendingHandoff = response.json();
        }
    });
    page.on('domcontentloaded', async () => {
        try {
            const url = new URL(page.url());
            if (pendingHandoff && url.origin === storefrontOrigin && /(?:^|\/)checkout\/?$/.test(url.pathname)) {
                const handoff = await pendingHandoff;
                pendingHandoff = undefined;
                if (handoff.protocol !== 'warehouse-preview-v2') return;
                lastHandoff = handoff;
                checkoutOrigin = new URL(handoff.checkoutUrl).origin;
                phase = 'session';
                ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
                ready.catch(() => {});
                // Use the browser's navigation and cookie handling, including partitioned auth cookies.
                await page.evaluate(url => location.replace(url), handoff.checkoutUrl);
            } else if (phase === 'session' && url.origin === checkoutOrigin && url.pathname.replace(/\/$/, '') === '/checkout' && lastHandoff) {
                phase = 'bootstrap';
                await bootstrap(lastHandoff);
            }
        } catch (error) {
            errors.push(error.message.replace(/(?:jwt|token)=[^&\s"]+/g, 'credential=[redacted]'));
            readyReject(error);
        }
    });
    await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(request.method());
        const forbidden = /(^|\/)(orders?|payments?)(\/|$)/i.test(url.pathname) || url.hostname === 'payments.bigcommerce.com';
        if (forbidden && (mutating || url.hostname === 'payments.bigcommerce.com')) {
            events.push({ blocked: true, reason: 'order_or_payment', method: request.method(), path: url.pathname });
            return route.abort();
        }
        if (mutating && url.origin !== storefrontOrigin) {
            const allowed = url.origin === checkoutOrigin && (/^\/session-sync(?:\/|$)/.test(url.pathname) || /^\/api\/storefront\/(checkouts|customers|carts)(\/|$)/.test(url.pathname) || /^\/internalapi\/v1\/checkout\/(customer|billing|shipping|consignments)/.test(url.pathname));
            events.push({ blocked: !allowed, method: request.method(), path: url.pathname });
            if (!allowed) return route.abort();
        }
        if (url.origin === checkoutOrigin && url.pathname.startsWith('/__warehouse_preview/')) {
            const file = path.resolve(buildDir, url.pathname.slice('/__warehouse_preview/'.length));
            if (!file.startsWith(path.resolve(buildDir) + path.sep) || !fs.existsSync(file)) return route.abort();
            return route.fulfill({ path: file, contentType: file.endsWith('.css') ? 'text/css' : 'application/javascript' });
        }
        if (phase === 'app' && request.isNavigationRequest() && url.origin === checkoutOrigin && url.pathname === '/checkout') return route.fulfill({ contentType: 'text/html', body: shell });
        if (phase === 'session' && request.resourceType() === 'script' && new URL(request.frame().url()).pathname.replace(/\/$/, '') === '/checkout') return route.abort();
        if (url.origin === storefrontOrigin && request.isNavigationRequest() && request.method() === 'GET' && /(?:^|\/)checkout\/?$/.test(url.pathname)) {
            url.searchParams.set('handoff', 'json');
            return route.continue({ url: url.href });
        }
        return route.continue();
    });
    async function openHandoff(handoff) {
        lastHandoff = handoff;
        checkoutOrigin = new URL(handoff.checkoutUrl).origin;
        phase = 'session';
        await page.goto(handoff.checkoutUrl, {waitUntil:'domcontentloaded'});
    }
    return { events, errors, openHandoff, get handoff() { return lastHandoff?.warehouseCheckout; }, waitUntilReady: () => ready };
}
module.exports = { attachPreview, launchPreviewBrowser };

if (require.main === module) {
    (async () => {
        const storefrontUrl = process.env.STOREFRONT_URL || 'http://localhost:3011';
        const browser = await launchPreviewBrowser();
        const context = await browser.newContext({ serviceWorkers: 'block' });
        const page = await context.newPage();
        await attachPreview(context, page, { storefrontUrl, onError: message => console.error(message) });
        await page.goto(storefrontUrl);
        console.log('Warehouse preview browser ready. Closing this browser stops the preview.');
        await new Promise(resolve => browser.on('disconnected', resolve));
    })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
