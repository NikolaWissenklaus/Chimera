/**
 * ═══════════════════════════════════════════════════════════════════
 *  CHIMERA v1.2.1 — três monitores de tracking em um só corpo
 * ═══════════════════════════════════════════════════════════════════
 *  Monitora, em tempo real, as 3 camadas do tracking:
 *
 *    📥 dl.push()  → window.dataLayer (pushes do site)      [amarelo]
 *    🏷️ gtm_tag    → fila interna do GTM com Container ID   [azul]
 *    📡 request    → requisições de rede do GA4 (/g/collect) [verde]
 *
 *  API no console:
 *    chimera.help()            → mostra os comandos
 *    chimera.dl()              → histórico atual do dataLayer
 *    chimera.gtm()             → histórico interno de tags do GTM
 *    chimera.req()             → histórico de hits GA4 capturados
 *    chimera.filter('compra')  → filtra logs por nome de evento (string ou RegExp)
 *    chimera.filter(null)      → remove o filtro
 *    chimera.pause() / .resume()
 *    chimera.stats()           → contagem de eventos por camada
 *    chimera.off()             → remove todos os hooks e desliga
 * ═══════════════════════════════════════════════════════════════════
 */
(function () {
    'use strict';

    if (window.chimera && window.chimera.__active) {
        console.warn('[Chimera] Já está ativa nesta página. Use chimera.off() antes de recarregar o script.');
        return;
    }

    /* ═══════════════ NÚCLEO COMPARTILHADO ═══════════════ */

    const MODULES = {
        dl:  { label: 'dl.push()', icon: '📥', color: '#ffe600' },  // amarelo
        gtm: { label: 'gtm_tag',   icon: '🏷️', color: '#2f9bff' },  // azul
        req: { label: 'request',   icon: '📡', color: '#09ff00' }   // verde
    };

    const css = {
        key:    'color: #4da6ff; font-weight: bold; font-size: 12px;',
        str:    'color: #ff9966; font-size: 12px;',
        num:    'color: #66ff66; font-size: 12px; font-weight: bold;',
        nil:    'color: #ff4d4d; font-size: 12px; font-style: italic;',
        list:   'color: #a29bfe; font-weight: bold; font-size: 13px;',
        item:   'color: #fdcb6e; font-size: 12px;',
        obj:    'color: #00cec9; font-weight: bold; font-size: 13px;',
        time:   'color: #888; font-style: italic; font-size: 11px; margin-left: 8px;',
        value:  'color: #ecf0f1; font-size: 11px;',
        muted:  'color: #95a5a6; font-style: italic;'
    };

    const badge = (module, inverted = false) => {
        const color = MODULES[module].color;
        return inverted
            ? `background: ${color}; color: #111; padding: 3px 8px; border-radius: 4px; font-weight: bold;`
            : `background: #111; color: ${color}; padding: 3px 6px; border-radius: 4px; font-weight: bold; border: 1px solid ${color};`;
    };

    const state = {
        paused: false,
        filter: null,
        seq: 0,
        history: { dl: [], gtm: [], req: [] },
        counts:  { dl: {}, gtm: {}, req: {} },
        timers: [],
        restore: []
    };

    const MAX_HISTORY = 300;
    const MAX_DEPTH = 8;

    function now() {
        const d = new Date();
        return d.toLocaleTimeString() + '.' + String(d.getMilliseconds()).padStart(3, '0');
    }

    function passesFilter(eventName) {
        if (!state.filter) return true;
        if (state.filter instanceof RegExp) return state.filter.test(eventName);
        return String(eventName).toLowerCase().includes(String(state.filter).toLowerCase());
    }

    function count(module, eventName) {
        state.counts[module][eventName] = (state.counts[module][eventName] || 0) + 1;
    }

    function remember(module, entry) {
        const h = state.history[module];
        h.push(entry);
        if (h.length > MAX_HISTORY) h.shift();
    }

    function snapshot(obj) {
        try { return structuredClone(obj); }
        catch (_) {
            try { return JSON.parse(JSON.stringify(obj)); }
            catch (_) { return obj; }
        }
    }

    function renderTree(obj, depth = 0, seen = new WeakSet()) {
        if (depth > MAX_DEPTH) { console.log('%c… (profundidade máxima)', css.muted); return; }
        if (obj !== null && typeof obj === 'object') {
            if (seen.has(obj)) { console.log('%c↻ (referência circular)', css.nil); return; }
            seen.add(obj);
        }

        for (const key of Object.keys(obj)) {
            const value = obj[key];

            if (Array.isArray(value)) {
                console.groupCollapsed(`%c📂 Lista: ${key} (${value.length} itens)`, css.list);
                value.forEach((item, index) => {
                    if (item !== null && typeof item === 'object') {
                        const itemName = item.item_name || item.name || item.id || item.item_id || `Item ${index}`;
                        console.groupCollapsed(`%c🛍️ [${index}] ${itemName}`, css.item);
                        renderTree(item, depth + 1, seen);
                        console.groupEnd();
                    } else {
                        console.log(`%c[${index}]: %c${item}`, css.key, css.str);
                    }
                });
                console.groupEnd();
            } else if (value !== null && typeof value === 'object') {
                console.groupCollapsed(`%c🧩 Objeto: ${key}`, css.obj);
                renderTree(value, depth + 1, seen);
                console.groupEnd();
            } else {
                let valueStyle = css.str;
                let display = `"${value}"`;
                if (typeof value === 'number') { valueStyle = css.num; display = value; }
                else if (value === null || value === undefined || typeof value === 'boolean') {
                    valueStyle = css.nil; display = String(value);
                }
                console.log(`%c▪ ${key}: %c${display}`, css.key, valueStyle);
            }
        }
    }

    /* ═══════════════ 📥 MÓDULO dl.push() — dataLayer ═══════════════ */

    const isArguments = (v) => Object.prototype.toString.call(v) === '[object Arguments]';

    function dlEventName(data) {
        if (data === null || data === undefined) return 'push (vazio)';
        if (isArguments(data)) return `gtag(${data[0]}${data[1] ? `, ${data[1]}` : ''})`;
        if (typeof data !== 'object') return String(data);
        return data.event || 'push (Sem Nome)';
    }

    function dlPushLog(data, index = null, live = true) {
        const eventName = dlEventName(data);
        if (live && !passesFilter(eventName)) return;

        const prefix = index !== null ? `[${index}] ` : '';
        const args = live
            ? [`%c📥 dl.push(): ${eventName} %c#${++state.seq} [${now()}]`, badge('dl'), css.time]
            : [`%c📥 ${prefix}dl.push(): ${eventName}`, badge('dl')];

        console.groupCollapsed(...args);
        if (data !== null && typeof data === 'object') {
            renderTree(isArguments(data) ? Array.from(data).reduce((acc, v, i) => (acc[i] = v, acc), {}) : data);
        } else {
            console.log('%c▪ valor:', css.key, data);
        }
        console.groupEnd();

        if (live) { count('dl', eventName); remember('dl', { t: now(), data }); }
    }

    function hookDataLayer() {
        window.dataLayer = window.dataLayer || [];

        const wrap = () => {
            const target = window.dataLayer;
            if (target.push.__chimera) return;
            const original = target.push;

            const wrapped = function (...args) {
                const result = original.apply(this, args);
                if (!state.paused) {
                    for (const arg of args) dlPushLog(snapshot(isArguments(arg) ? Array.from(arg) : arg) ?? arg);
                }
                return result;
            };
            wrapped.__chimera = true;
            wrapped.__original = original;
            target.push = wrapped;
        };

        wrap();

        const guard = setInterval(wrap, 1000);
        state.timers.push(guard);

        state.restore.push(() => {
            clearInterval(guard);
            if (window.dataLayer?.push?.__chimera) {
                window.dataLayer.push = window.dataLayer.push.__original;
            }
        });
    }

    /* ═══════════════ 🏷️ MÓDULO gtm_tag — tags do GTM ═══════════════ */

    function getContainerIdList() {
        const gtm = window.google_tag_manager || {};
        const fromGtm = Object.keys(gtm).filter(k => /^(GTM|G|GT|AW|DC|OPT)-[A-Z0-9]+$/i.test(k));
        if (fromGtm.length) return fromGtm;

        // Fallback: varre tags de script injetadas no DOM
        const scripts = Array.from(document.querySelectorAll('script[src*="googletagmanager.com/gtm.js"], script[src*="googletagmanager.com/gtag/js"]'));
        const fromDom = [];
        for (const s of scripts) {
            const match = s.src.match(/[?&]id=([A-Z0-9-]+)/i);
            if (match && match[1] && !fromDom.includes(match[1])) {
                fromDom.push(match[1]);
            }
        }
        return fromDom;
    }

    function findGTMQueues() {
        const gtm = window.google_tag_manager;
        if (!gtm) return [];

        const knownContainers = getContainerIdList();
        const defaultId = knownContainers.length === 1 ? knownContainers[0] : (knownContainers.join(', ') || null);
        const queues = [];
        const seenQueues = new Set();

        // 1. Busca direta dentro dos nós identificados como ID de contêiner
        for (const id of knownContainers) {
            const containerObj = gtm[id];
            if (containerObj && typeof containerObj === 'object') {
                for (const subKey of Object.keys(containerObj)) {
                    const target = containerObj[subKey];
                    if (Array.isArray(target) && (
                        (target.length > 0 && Object.prototype.hasOwnProperty.call(target[0], 'message')) ||
                        target.__chimera
                    )) {
                        if (!seenQueues.has(target)) {
                            seenQueues.add(target);
                            queues.push({ containerId: id, queue: target });
                        }
                    }
                }
            }
        }

        // 2. Varredura global no objeto caso esteja armazenado em nós internos (ex: gtm['mb'])
        for (const key of Object.keys(gtm)) {
            const sub = gtm[key];
            if (sub === null || typeof sub !== 'object') continue;

            const resolvedId = /^(GTM|G|GT|AW|DC|OPT)-[A-Z0-9]+$/i.test(key)
                ? key
                : (defaultId || 'GTM-Desconhecido');

            for (const subKey of Object.keys(sub)) {
                const target = sub[subKey];
                if (Array.isArray(target) && (
                    (target.length > 0 && Object.prototype.hasOwnProperty.call(target[0], 'message')) ||
                    target.__chimera
                )) {
                    if (!seenQueues.has(target)) {
                        seenQueues.add(target);
                        queues.push({ containerId: resolvedId, queue: target });
                    }
                }
            }
        }

        return queues;
    }

    function resolveGTMContainerId(entry, fallbackId) {
        if (entry && typeof entry === 'object') {
            if (entry.containerId && /^(GTM|G|GT|AW|DC|OPT)-/i.test(entry.containerId)) return entry.containerId;
            if (entry.ctid && /^(GTM|G|GT|AW|DC|OPT)-/i.test(entry.ctid)) return entry.ctid;
            if (entry.gtm_id && /^(GTM|G|GT|AW|DC|OPT)-/i.test(entry.gtm_id)) return entry.gtm_id;
        }
        if (fallbackId && /^(GTM|G|GT|AW|DC|OPT)-/i.test(fallbackId)) {
            return fallbackId;
        }
        const known = getContainerIdList();
        if (known.length === 1) return known[0];
        if (known.length > 1) return known.join(', ');
        return fallbackId || 'GTM-Desconhecido';
    }

    function gtmTagLog(entry, live = true, containerId = null) {
        if (!entry || !entry.message) return;

        const gtmContainer = resolveGTMContainerId(entry, containerId || entry.__containerId);
        const type = entry.message['0'] || 'Desconhecido';
        let eventName = entry.message['1'] || '';
        const params = entry.message['2'] || {};
        let streamId = 'Padrão da Propriedade';

        if (type === 'config') { streamId = eventName; eventName = 'config_setup'; }
        else if (params.send_to) { streamId = params.send_to; }

        if (live && !passesFilter(eventName)) return;

        const args = live
            ? [`%c🏷️ gtm_tag: ${eventName} | [${gtmContainer}] | Destino: ${streamId} %c#${++state.seq} [${now()}]`, badge('gtm'), css.time]
            : [`%c🏷️ gtm_tag: ${eventName} | [${gtmContainer}] | Destino: ${streamId}`, badge('gtm')];

        console.groupCollapsed(...args);
        console.log('%c▪ Container GTM:', 'color: #f39c12; font-weight: bold;', gtmContainer);
        console.log('%c▪ Tipo de Disparo:', 'color: #3498db; font-weight: bold;', type);
        console.log('%c▪ Nome do Evento:', 'color: #2ecc71; font-weight: bold;', eventName);
        console.log('%c▪ Destino / Stream:', 'color: #1abc9c; font-weight: bold;', streamId);

        if (Object.keys(params).length > 0) {
            console.groupCollapsed('%c📦 Parâmetros Anexados', 'color: #e67e22; font-weight: bold;');
            renderTree(params);
            console.groupEnd();
        } else {
            console.log('%c▪ Parâmetros: (Nenhum parâmetro extra enviado)', css.muted);
        }
        console.groupEnd();

        if (live) {
            count('gtm', eventName);
            remember('gtm', { t: now(), containerId: gtmContainer, entry });
        }
    }

    function hookGTM() {
        const MAX_ATTEMPTS = 60;
        let attempts = 0;
        const hookedQueues = new Set();

        const tryAttach = () => {
            const queues = findGTMQueues();
            if (!queues.length) {
                if (++attempts >= MAX_ATTEMPTS) {
                    clearInterval(poller);
                    console.warn('[Chimera/gtm_tag] GTM não encontrado após 30s. Use chimera.retryGTM() se ele carregar depois.');
                }
                return;
            }

            let newHook = false;
            for (const { containerId, queue } of queues) {
                if (queue.push.__chimera || hookedQueues.has(queue)) continue;

                const original = queue.push;
                const wrapped = function (...args) {
                    const result = original.apply(this, args);
                    if (!state.paused) args.forEach(a => gtmTagLog(a, true, containerId));
                    return result;
                };
                wrapped.__chimera = true;
                wrapped.__original = original;
                wrapped.__containerId = containerId;
                queue.push = wrapped;
                hookedQueues.add(queue);
                newHook = true;

                state.restore.push(() => {
                    if (queue.push.__chimera) queue.push = queue.push.__original;
                });
            }

            if (newHook) {
                clearInterval(poller);
                const known = getContainerIdList();
                const displayIds = known.length ? known.join(', ') : queues.map(q => q.containerId).join(', ');
                console.log(`%c🏷️ [gtm_tag] Conectado à(s) fila(s) interna(s) do GTM (${displayIds})`, badge('gtm', true));
            }
        };

        const poller = setInterval(tryAttach, 500);
        state.timers.push(poller);
        tryAttach();
        return tryAttach;
    }

    /* ═══════════════ 📡 MÓDULO request — rede GA4 ═══════════════ */

    const GA4_URL_RE = /\/(g|j)\/collect/;

    const ITEM_MAP = {
        id: 'item_id', nm: 'item_name', br: 'item_brand', af: 'affiliation',
        ca: 'item_category', c2: 'item_category2', c3: 'item_category3',
        c4: 'item_category4', c5: 'item_category5', pr: 'price',
        qt: 'quantity', ds: 'discount', cp: 'coupon', lo: 'location_id',
        li: 'item_list_id', ln: 'item_list_name', lp: 'index',
        va: 'item_variant', cu: 'currency',
        pi: 'promotion_id', pn: 'promotion_name',
        cn: 'creative_name', cs: 'creative_slot'
    };

    const PARAM_LABELS = {
        v: 'versão do protocolo', tid: 'Measurement ID', gtm: 'hash do contêiner',
        cid: 'Client ID', uid: 'User ID', sid: 'Session ID',
        sct: 'nº de sessões', seg: 'sessão engajada',
        dl: 'URL da página', dr: 'referrer', dt: 'título da página',
        ul: 'idioma', sr: 'resolução', cu: 'moeda',
        _p: 'cache buster', _s: 'nº do hit na sessão',
        _ss: 'início de sessão', _fv: 'primeira visita', _ee: 'enhanced measurement',
        _et: 'tempo de engajamento (ms)', ir: 'tráfego interno', tt: 'traffic type',
        gcs: 'consent status', gcd: 'consent default', dma: 'DMA', frm: 'frame state'
    };

    function parseGA4Item(prString) {
        const itemObj = {};
        const customKeys = {};
        for (const part of prString.split('~')) {
            if (!part) continue;
            const prefix = part.substring(0, 2);
            const value = part.substring(2);
            if (ITEM_MAP[prefix]) itemObj[ITEM_MAP[prefix]] = value;
            else if (prefix[0] === 'k') customKeys[prefix[1]] = value;
            else if (prefix[0] === 'v' && customKeys[prefix[1]]) itemObj[customKeys[prefix[1]]] = value;
            else itemObj[prefix] = value;
        }
        return itemObj;
    }

    function labeled(key) {
        return PARAM_LABELS[key] ? `${key} (${PARAM_LABELS[key]})` : key;
    }

    function requestLog(url, bodyData, method) {
        if (state.paused) return;
        try {
            const parsedUrl = new URL(url, window.location.origin);
            const urlParams = new URLSearchParams(parsedUrl.search);
            const tid = urlParams.get('tid') || 'Desconhecido';
            const events = [];

            if (bodyData && typeof bodyData === 'string' && bodyData.trim()) {
                for (const line of bodyData.trim().split(/\r?\n/)) {
                    const evt = Object.fromEntries(urlParams.entries());
                    for (const [k, v] of new URLSearchParams(line).entries()) evt[k] = v;
                    events.push(evt);
                }
            } else {
                events.push(Object.fromEntries(urlParams.entries()));
            }

            for (const evt of events) {
                const eventName = evt.en || 'page_view / config';
                if (!passesFilter(eventName)) continue;

                console.groupCollapsed(
                    `%c📡 request: ${eventName} | ID: ${tid} %c#${++state.seq} [${now()}] (${method})`,
                    badge('req'),
                    css.time
                );

                const groups = { ids: [], ups: [], ens: [], eps: [], epns: [], prs: [], others: [] };
                for (const key of Object.keys(evt)) {
                    if (['uid', 'cid', 'sid'].includes(key)) groups.ids.push(key);
                    else if (key.startsWith('up.') || key.startsWith('upn.')) groups.ups.push(key);
                    else if (key === 'en') groups.ens.push(key);
                    else if (key.startsWith('epn.')) groups.epns.push(key);
                    else if (key.startsWith('ep.')) groups.eps.push(key);
                    else if (/^pr\d+$/.test(key)) groups.prs.push(key);
                    else groups.others.push(key);
                }

                const idOrder = { uid: 1, cid: 2, sid: 3 };
                groups.ids.sort((a, b) => idOrder[a] - idOrder[b]);
                groups.ups.sort(); groups.eps.sort(); groups.epns.sort(); groups.others.sort();
                groups.prs.sort((a, b) => parseInt(a.substring(2), 10) - parseInt(b.substring(2), 10));

                const styles = {
                    ids: 'color: #3498db; font-weight: bold; font-size: 11px;',
                    ups: 'color: #9b59b6; font-weight: bold; font-size: 11px;',
                    ens: 'color: #2ecc71; font-weight: bold; font-size: 11px;',
                    eps: 'color: #e67e22; font-weight: bold; font-size: 11px;',
                    epns: 'color: #00cec9; font-weight: bold; font-size: 11px;',
                    prs: 'color: #f1c40f; font-weight: bold; font-size: 11px;',
                    others: 'color: #95a5a6; font-weight: bold; font-size: 11px;'
                };
                const printKeys = (keys, style, useLabel = false) =>
                    keys.forEach(k => console.log(`%c▪ ${useLabel ? labeled(k) : k}: %c${evt[k]}`, style, css.value));

                if (groups.ids.length || groups.ups.length) {
                    console.groupCollapsed('%c👤 Identificação e Usuário', 'color: #3498db; font-weight: bold; font-size: 12px;');
                    printKeys(groups.ids, styles.ids, true);
                    printKeys(groups.ups, styles.ups);
                    console.groupEnd();
                }

                if (groups.ens.length || groups.eps.length || groups.epns.length) {
                    console.groupCollapsed('%c🎯 Dados do Evento', 'color: #2ecc71; font-weight: bold; font-size: 12px;');
                    printKeys(groups.ens, styles.ens);
                    printKeys(groups.eps, styles.eps);
                    printKeys(groups.epns, styles.epns);
                    console.groupEnd();
                }

                if (groups.prs.length) {
                    console.groupCollapsed(`%c🛒 Produtos do E-commerce (${groups.prs.length} itens)`, 'color: #f1c40f; font-weight: bold; font-size: 12px;');
                    for (const key of groups.prs) {
                        const item = parseGA4Item(evt[key]);
                        console.groupCollapsed(`%c📦 ${key}: ${item.item_name || 'Item sem nome'}`, styles.prs);
                        for (const [pk, pv] of Object.entries(item)) {
                            console.log(`%c▪ ${pk}: %c${pv}`, styles.prs, css.value);
                        }
                        console.groupEnd();
                    }
                    console.groupEnd();
                }

                if (groups.others.length) {
                    console.groupCollapsed('%c⚙️ Outros Parâmetros', 'color: #7f8c8d; font-weight: bold; font-size: 12px;');
                    printKeys(groups.others, styles.others, true);
                    console.groupEnd();
                }

                console.groupEnd();
                count('req', eventName);
                remember('req', { t: now(), method, tid, event: evt });
            }
        } catch (e) {
            console.error('[Chimera/request] Erro ao decodificar:', e);
        }
    }

    function extractBody(body, url, method) {
        if (body == null) return requestLog(url, null, method);
        if (typeof body === 'string') return requestLog(url, body, method);
        if (body instanceof Blob) return body.text().then(t => requestLog(url, t, method)).catch(() => requestLog(url, null, method));
        if (body instanceof URLSearchParams) return requestLog(url, body.toString(), method);
        if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
            try { return requestLog(url, new TextDecoder().decode(body), method); }
            catch (_) { return requestLog(url, null, method); }
        }
        return requestLog(url, null, method);
    }

    function hookNetwork() {
        const originalFetch = window.fetch;
        window.fetch = function (input, init) {
            try {
                const url = typeof input === 'string' ? input
                    : input instanceof URL ? input.href
                    : input?.url;
                if (url && GA4_URL_RE.test(url)) {
                    if (init?.body != null) extractBody(init.body, url, 'Fetch');
                    else if (typeof Request !== 'undefined' && input instanceof Request) {
                        input.clone().text()
                            .then(t => requestLog(url, t || null, 'Fetch'))
                            .catch(() => requestLog(url, null, 'Fetch'));
                    } else {
                        requestLog(url, null, 'Fetch');
                    }
                }
            } catch (_) {}
            return originalFetch.apply(this, arguments);
        };
        state.restore.push(() => { window.fetch = originalFetch; });

        const originalBeacon = navigator.sendBeacon?.bind(navigator);
        if (originalBeacon) {
            navigator.sendBeacon = function (url, data) {
                try {
                    if (typeof url === 'string' && GA4_URL_RE.test(url)) extractBody(data, url, 'Beacon');
                } catch (_) {}
                return originalBeacon(url, data);
            };
            state.restore.push(() => { navigator.sendBeacon = originalBeacon; });
        }

        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url) {
            this.__chimeraUrl = typeof url === 'string' ? url : url?.href;
            return originalOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function (body) {
            try {
                if (this.__chimeraUrl && GA4_URL_RE.test(this.__chimeraUrl)) {
                    extractBody(body, this.__chimeraUrl, 'XHR');
                }
            } catch (_) {}
            return originalSend.apply(this, arguments);
        };
        state.restore.push(() => {
            XMLHttpRequest.prototype.open = originalOpen;
            XMLHttpRequest.prototype.send = originalSend;
        });
    }

    /* ═══════════════ API PÚBLICA ═══════════════ */

    let retryGTM;

    const api = {
        __active: true,
        version: '1.2.1',

        dl() {
            console.log('%c📥 Histórico Atual do dataLayer', badge('dl', true));
            (window.dataLayer || []).forEach((e, i) => dlPushLog(e, i, false));
        },

        gtm() {
            const queues = findGTMQueues();
            if (!queues.length) {
                console.log('%c🏷️ [gtm_tag] Nenhuma tag processada ainda ou GTM ausente.', 'color: #e74c3c; font-weight: bold; font-style: italic;');
                return;
            }
            const totalDisparos = queues.reduce((sum, q) => sum + q.queue.length, 0);
            console.log(`%c🏷️ Histórico Interno de Tags do GTM (${totalDisparos} disparos)`, badge('gtm', true));
            for (const { containerId, queue } of queues) {
                queue.forEach(e => gtmTagLog(e, false, containerId));
            }
        },

        req() {
            const h = state.history.req;
            if (!h.length) {
                console.log('%c📡 [request] Nenhum hit GA4 capturado ainda.', 'color: #e74c3c; font-weight: bold; font-style: italic;');
                return;
            }
            console.log(`%c📡 Hits GA4 capturados nesta sessão (${h.length})`, badge('req', true));
            console.table(h.map(x => ({ hora: x.t, via: x.method, evento: x.event.en || 'page_view/config', tid: x.tid })));
        },

        filter(value) {
            state.filter = value || null;
            console.log(state.filter
                ? `%c[Chimera] Filtro ativo: ${state.filter}`
                : '%c[Chimera] Filtro removido — mostrando tudo.',
                'color: #e67e22; font-weight: bold;');
            return api;
        },

        pause()  { state.paused = true;  console.log('%c[Chimera] ⏸️ Pausada.', 'color: #e74c3c; font-weight: bold;'); return api; },
        resume() { state.paused = false; console.log('%c[Chimera] ▶️ Monitorando.', 'color: #2ecc71; font-weight: bold;'); return api; },

        stats() {
            for (const [module, counts] of Object.entries(state.counts)) {
                const rows = Object.entries(counts).map(([evento, qtd]) => ({ evento, qtd }));
                const total = rows.reduce((s, r) => s + r.qtd, 0);
                console.log(`%c${MODULES[module].icon} ${MODULES[module].label} — ${total} eventos`, badge(module));
                if (rows.length) console.table(rows.sort((a, b) => b.qtd - a.qtd));
            }
        },

        retryGTM() { retryGTM && retryGTM(); return api; },

        off() {
            state.timers.forEach(clearInterval);
            state.restore.forEach(fn => { try { fn(); } catch (_) {} });
            api.__active = false;
            console.log('%c[Chimera] 💀 Desligada. Todos os hooks foram removidos.', 'background: #111; color: #e74c3c; padding: 3px 8px; border-radius: 4px; font-weight: bold;');
        },

        help() {
            console.log('%c🐲 CHIMERA v1.2.1 — Comandos', 'background: #111; color: #fff; padding: 4px 10px; border-radius: 4px; font-weight: bold; font-size: 13px;');
            console.log(`%c
  chimera.dl()               histórico do dataLayer          📥 amarelo
  chimera.gtm()              histórico de tags do GTM        🏷️ azul
  chimera.req()              tabela de hits GA4 capturados   📡 verde
  chimera.filter('nome')     filtra por nome de evento (string ou /regex/)
  chimera.filter(null)       remove o filtro
  chimera.pause()            pausa os logs (hooks continuam)
  chimera.resume()           retoma os logs
  chimera.stats()            contagem de eventos por camada
  chimera.retryGTM()         tenta reconectar ao GTM manualmente
  chimera.off()              remove todos os hooks e desliga`,
            'color: #ecf0f1; font-size: 12px; font-family: monospace;');
        }
    };

    api.kitsune = api.dl;
    api.zapdos  = api.gtm;
    api.huldra  = api.req;

    /* ═══════════════ BOOT ═══════════════ */

    console.log('%c🐲 CHIMERA v1.2.1 ', 'background: #111; color: #fff; padding: 4px 10px; border-radius: 4px; font-weight: bold; font-size: 14px; border-left: 3px solid #e74c3c;');

    hookDataLayer();
    console.log('%c📥 [dl.push()] dataLayer monitorado', badge('dl', true));

    retryGTM = hookGTM();

    hookNetwork();
    console.log('%c📡 [request] Rede GA4 monitorada (Fetch + Beacon + XHR)', badge('req', true));

    console.log('%c🐲 Chimera pronta! Digite chimera.help() para ver os comandos.', 'color: #2ecc71; font-weight: bold;');

    window.chimera = api;
})();
