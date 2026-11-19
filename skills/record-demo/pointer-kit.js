// Pointer kit for record-harness.js: makes a recorded demo read like a person using the app.
//
// Playwright's recordVideo never shows a mouse cursor, so a viewer sees pages change on their
// own. This kit draws a pointer that glides to every target before it is clicked, rings and
// outlines what was clicked, shows keycaps (Enter, Tab), draws a dropdown list for native
// <select>s (their popups are not captured) and outlines results (an error, a toast, a saved
// value).
//
// The harness installs it on the browser context (every page and navigation) and exposes the
// helpers on the scene ctx: ctx.click, ctx.type, ctx.choose, ctx.press, ctx.mark ...
// Every helper takes a Playwright Locator or a CSS selector string.
'use strict';

const DEFAULT_ACCENT = '#2563eb';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs in every page before its own scripts (context.addInitScript). Draws the pointer,
// restores the caption bar after a navigation and applies the presentation CSS.
function demoInit({ accent, css }) {
  if (window.__demoKit) return;
  window.__demoKit = true;
  const base = `
    #demo-pointer{position:fixed;left:0;top:0;width:30px;height:30px;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.5));transition:opacity .25s}
    .demo-ripple{position:fixed;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;border:3px solid ${accent};background:${accent}40;z-index:2147483646;pointer-events:none;animation:demoRipple .7s ease-out forwards}
    @keyframes demoRipple{to{transform:scale(4);opacity:0}}
    .demo-target{outline:3px solid ${accent} !important;outline-offset:2px !important;box-shadow:0 0 0 7px ${accent}4d !important}
    .demo-mark{outline:3px solid ${accent} !important;outline-offset:3px !important;box-shadow:0 0 0 8px ${accent}38 !important;border-radius:4px}
    tr.demo-mark{outline:none !important;box-shadow:none !important}
    tr.demo-mark>*{box-shadow:inset 0 3px 0 ${accent},inset 0 -3px 0 ${accent} !important}
    tr.demo-mark>:first-child{box-shadow:inset 3px 0 0 ${accent},inset 0 3px 0 ${accent},inset 0 -3px 0 ${accent} !important}
    tr.demo-mark>:last-child{box-shadow:inset -3px 0 0 ${accent},inset 0 3px 0 ${accent},inset 0 -3px 0 ${accent} !important}
    #demo-keycap{position:fixed;z-index:2147483645;pointer-events:none;background:#1f2933;color:#fff;font:600 20px/1 -apple-system,Segoe UI,Arial;padding:10px 14px;border-radius:9px;box-shadow:0 6px 16px rgba(0,0,0,.35);border-bottom:4px solid #0b1015;animation:demoPop .18s ease-out}
    @keyframes demoPop{from{transform:scale(.7);opacity:0}}
    .demo-dd{position:fixed;z-index:2147483644;background:#fff;border:1px solid #9aa5b1;border-radius:6px;box-shadow:0 10px 26px rgba(0,0,0,.25);font:15px/1.2 -apple-system,Segoe UI,Arial;color:#1f2933;padding:4px 0;overflow:hidden}
    .demo-dd div{padding:8px 14px;white-space:nowrap}
    .demo-dd div.on{background:#1967d2;color:#fff}
    .demo-dd div.cur{font-weight:600}
    #demo-caption{z-index:2147483640 !important}
    #demo-titlecard{z-index:2147483641 !important}
  `;
  // Styles go in as soon as the root element exists, so app chrome hidden by `css` never flashes.
  const addStyle = () => {
    if (!document.documentElement) return false;
    const st = document.createElement('style');
    st.textContent = base + (css || '');
    document.documentElement.appendChild(st);
    return true;
  };
  if (!addStyle()) {
    const mo = new MutationObserver(() => { if (addStyle()) mo.disconnect(); });
    mo.observe(document, { childList: true });
  }
  const install = () => {
    if (document.getElementById('demo-pointer')) return;
    const p = document.createElement('div');
    p.id = 'demo-pointer';
    p.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M4 2 L4 19 L8.6 14.9 L11.6 21.6 L14.6 20.3 L11.7 13.7 L18 13.4 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    let pos = { x: Math.round(innerWidth / 2), y: Math.round(innerHeight / 2) };
    try { pos = JSON.parse(sessionStorage.getItem('demoPointer')) || pos; } catch (e) { /* no storage */ }
    p.style.transform = 'translate(' + (pos.x - 4) + 'px,' + (pos.y - 2) + 'px)';
    p.dataset.x = pos.x;
    p.dataset.y = pos.y;
    try { if (sessionStorage.getItem('demoPointerHidden')) p.style.opacity = '0'; } catch (e) { /* no storage */ }
    document.documentElement.appendChild(p);
    let cap = null;
    try { cap = JSON.parse(sessionStorage.getItem('demoCaption')); } catch (e) { /* no storage */ }
    if (cap && !document.getElementById('demo-caption')) {
      // The stored markup was serialized from nodes the harness built with textContent.
      const bar = document.createElement('div');
      bar.id = 'demo-caption';
      bar.style.cssText = cap.css;
      bar.innerHTML = cap.html;
      document.body.appendChild(bar);
    }
  };
  if (document.body) install(); else document.addEventListener('DOMContentLoaded', install);
}

function createPointerKit(page, opts = {}) {
  const accent = opts.accent || DEFAULT_ACCENT;
  const k = {};
  const loc = (t) => (typeof t === 'string' ? page.locator(t).first() : t);

  k.install = (context) => context.addInitScript(demoInit, { accent, css: opts.css || '' });

  // Glide the pointer to (x, y) in viewport pixels; the speed follows the distance.
  k.moveTo = async (x, y, ms) => {
    await page.evaluate(({ x, y, ms }) => new Promise((resolve) => {
      const p = document.getElementById('demo-pointer');
      if (!p) return resolve();
      const sx = parseFloat(p.dataset.x), sy = parseFloat(p.dataset.y);
      const dur = ms || Math.min(1100, Math.max(380, 280 + Math.hypot(x - sx, y - sy) * 0.55));
      const t0 = performance.now();
      const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      const step = (now) => {
        const t = Math.min(1, (now - t0) / dur), e = ease(t);
        p.style.transform = 'translate(' + (sx + (x - sx) * e - 4) + 'px,' + (sy + (y - sy) * e - 2) + 'px)';
        if (t < 1) return requestAnimationFrame(step);
        p.dataset.x = x;
        p.dataset.y = y;
        try { sessionStorage.setItem('demoPointer', JSON.stringify({ x, y })); } catch (e) { /* no storage */ }
        resolve();
      };
      requestAnimationFrame(step);
    }), { x, y, ms });
    await page.mouse.move(x, y); // real hover styles follow the drawn pointer
  };

  // Scroll the target into view when it is hidden under the caption bar or off screen.
  k.box = async (target) => {
    const l = loc(target);
    await l.evaluate((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < 80 || r.bottom > window.innerHeight - 20) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    await sleep(450);
    const b = await l.boundingBox();
    if (!b) throw new Error('pointer-kit: target is not visible: ' + l);
    return b;
  };

  // Point at the target's centre ({ left: true } for text fields: near the left edge).
  k.point = async (target, o = {}) => {
    const b = await k.box(target);
    const x = o.x !== undefined ? b.x + o.x : b.x + (o.left ? Math.min(40, b.width / 2) : b.width / 2);
    await k.moveTo(Math.round(x), Math.round(b.y + b.height / 2));
    return b;
  };

  k.ripple = () => page.evaluate(() => {
    const p = document.getElementById('demo-pointer');
    if (!p) return;
    const r = document.createElement('div');
    r.className = 'demo-ripple';
    r.style.left = p.dataset.x + 'px';
    r.style.top = p.dataset.y + 'px';
    document.documentElement.appendChild(r);
    setTimeout(() => r.remove(), 800);
  });

  k.flash = (target, ms = 1100) => loc(target)
    .evaluate((el, ms) => { el.classList.add('demo-target'); setTimeout(() => el.classList.remove('demo-target'), ms); }, ms)
    .catch(() => {});

  // Glide to the target, outline it, ripple, then click it for real.
  k.click = async (target, o = {}) => {
    const l = loc(target);
    await k.point(l, o);
    await k.flash(l, o.flashMs || 1100);
    await sleep(260);
    await k.ripple();
    await l.click({ position: o.position, force: !!o.force });
    await sleep(o.after !== undefined ? o.after : 650);
  };

  k.keycap = (label, ms = 1100) => page.evaluate(({ label, ms }) => {
    const p = document.getElementById('demo-pointer');
    const old = document.getElementById('demo-keycap');
    if (old) old.remove();
    const kc = document.createElement('div');
    kc.id = 'demo-keycap';
    kc.textContent = label;
    kc.style.left = ((p ? parseFloat(p.dataset.x) : innerWidth / 2) + 26) + 'px';
    kc.style.top = ((p ? parseFloat(p.dataset.y) : innerHeight / 2) + 22) + 'px';
    document.documentElement.appendChild(kc);
    setTimeout(() => kc.remove(), ms);
  }, { label, ms });

  // Click a field, clear it and type at a human pace.
  k.type = async (target, text, o = {}) => {
    await k.click(target, { left: true, after: 200, ...o });
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(String(text), { delay: o.delay || 45 });
    await sleep(o.settle !== undefined ? o.settle : 450);
  };

  // A key press with its keycap, e.g. press('Enter', '↵ Enter').
  k.press = async (key, label) => {
    await k.keycap(label || key);
    await sleep(250);
    await page.keyboard.press(key);
    await sleep(700);
  };

  // A native <select>: draw its list under it, glide to the option, pick it.
  k.choose = async (target, value, o = {}) => {
    const l = loc(target);
    await k.point(l);
    await k.flash(l, 1600);
    await sleep(220);
    await k.ripple();
    await l.focus();
    const b = await l.boundingBox();
    const info = await l.evaluate((el, { value, bx, by, bw, bh }) => {
      document.querySelectorAll('.demo-dd').forEach((d) => d.remove());
      const opts = [...el.options].filter((op) => !op.disabled || op.value === value).map((op) => ({ v: op.value, t: op.textContent.trim() || ' ' }));
      const i = opts.findIndex((op) => op.v === value);
      if (i < 0) throw new Error('pointer-kit: no option ' + value);
      const cur = opts.findIndex((op) => op.v === el.value);
      const start = Math.max(0, Math.min(i - 3, opts.length - 8));
      const shown = opts.slice(start, start + 8);
      const dd = document.createElement('div');
      dd.className = 'demo-dd';
      dd.style.left = bx + 'px';
      dd.style.minWidth = Math.max(bw, 160) + 'px';
      const below = by + bh + 12 + shown.length * 33 < window.innerHeight;
      dd.style.top = (below ? by + bh + 2 : by - 12 - shown.length * 33) + 'px';
      shown.forEach((op, n) => { const d = document.createElement('div'); d.textContent = op.t; if (start + n === cur) d.className = 'cur'; dd.appendChild(d); });
      document.documentElement.appendChild(dd);
      const row = dd.children[i - start].getBoundingClientRect();
      return { x: row.left + Math.min(60, row.width / 2), y: row.top + row.height / 2, n: i - start };
    }, { value, bx: b.x, by: b.y, bw: b.width, bh: b.height });
    await sleep(350);
    await k.moveTo(Math.round(info.x), Math.round(info.y), 520);
    await page.evaluate((n) => { const dd = document.querySelector('.demo-dd'); if (dd) dd.children[n].className = 'on'; }, info.n);
    await sleep(250);
    await k.ripple();
    await sleep(150);
    await page.evaluate(() => document.querySelectorAll('.demo-dd').forEach((d) => d.remove()));
    await l.selectOption(value);
    await sleep(o.after !== undefined ? o.after : 650);
  };

  // Outline a result (an error, a toast, a saved value) until unmark(). Outline only: a
  // background tint would wipe out white text on coloured buttons and badges. A table row
  // cannot show an outline of its own (its cells paint over it), so a marked <tr> is boxed
  // by inset lines drawn on its cells instead.
  k.mark = async (target) => {
    if (typeof target === 'string') {
      await page.evaluate((sel) => document.querySelectorAll(sel).forEach((e) => e.classList.add('demo-mark')), target);
    } else {
      await target.evaluate((e) => e.classList.add('demo-mark')).catch(() => {});
    }
  };
  k.unmark = () => page.evaluate(() => document.querySelectorAll('.demo-mark').forEach((e) => e.classList.remove('demo-mark')));

  // `instant` skips the fade, so a full-screen card never shows a fading pointer.
  k.pointerVisible = (on, instant = false) => page.evaluate(({ on, instant }) => {
    try { if (on) sessionStorage.removeItem('demoPointerHidden'); else sessionStorage.setItem('demoPointerHidden', '1'); } catch (e) { /* no storage */ }
    const p = document.getElementById('demo-pointer');
    if (!p) return;
    p.style.transition = instant ? 'none' : '';
    p.style.opacity = on ? '1' : '0';
  }, { on, instant });

  // Keep the caption bar across navigations (the init script redraws it from sessionStorage).
  k.persistCaption = () => page.evaluate(() => {
    const bar = document.getElementById('demo-caption');
    try { if (bar) sessionStorage.setItem('demoCaption', JSON.stringify({ css: bar.style.cssText, html: bar.innerHTML })); } catch (e) { /* no storage */ }
  });
  k.clearCaption = () => page.evaluate(() => {
    const bar = document.getElementById('demo-caption');
    if (bar) bar.remove();
    try { sessionStorage.removeItem('demoCaption'); } catch (e) { /* no storage */ }
  });

  k.goto = async (url) => {
    await page.goto(url);
    await page.waitForLoadState('networkidle').catch(() => {});
  };

  return k;
}

module.exports = { createPointerKit, demoInit, DEFAULT_ACCENT };
