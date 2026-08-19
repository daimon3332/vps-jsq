import './style.css';

// Firefox 检测：为 html 添加标识类，供 CSS 针对性处理原生控件差异
if (typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent)) {
    document.documentElement.classList.add('is-firefox');
}

const API_URL = 'https://open.er-api.com/v6/latest/CNY';
// 汇率本地缓存时长（小时）。免费 API 一般每天更新一次，12h 足够。
const RATE_CACHE_HOURS = 12;
// 用户手动刷新汇率次数上限（每 RATE_CACHE_HOURS 内）。防止误触刷爆免费 API 配额。
const MANUAL_REFRESH_LIMIT = 2;
const SHARE_IMAGE_MIME_TYPE = 'image/webp';
const SHARE_IMAGE_QUALITY = 0.98;
// 导出图片的最低像素比与目标物理宽度。手机端 CSS 宽度通常仅 ~360px，
// 若固定 pixelRatio=2 输出仅 ~720px 会发糊。这里按卡片实际 CSS 宽度动态
// 计算 pixelRatio，保证输出至少 SHARE_IMAGE_MIN_WIDTH 物理像素宽。
const SHARE_IMAGE_MIN_PIXEL_RATIO = 2;
const SHARE_IMAGE_MAX_PIXEL_RATIO = 4;
// 低内存设备（deviceMemory <= 4GB 或窄屏）限制 pixelRatio，避免导出时内存峰值过高造成卡顿
// 股眼几乎看不出 3x 与 4x 的区别
const SHARE_IMAGE_LOW_END_MAX_PIXEL_RATIO = 3;
const SHARE_IMAGE_MIN_WIDTH = 1440;
let htmlToImageModulePromise = null;
let generatedImageUrl = '';

const currencySymbols = {
    'USD': '$', 'EUR': '\u20AC', 'GBP': '\u00A3', 'JPY': '\u00A5',
    'CNY': '\u00A5', 'HKD': 'HK$', 'AUD': 'A$', 'SGD': 'S$',
    'KRW': '\u20A9', 'TWD': 'NT$', 'CAD': 'C$'
};

const converterCurrencies = [
    ['USD', '美元'], ['CNY', '人民币'], ['EUR', '欧元'], ['GBP', '英镑'],
    ['JPY', '日元'], ['SGD', '新加坡元'], ['HKD', '港币'], ['CAD', '加拿大元'],
    ['AUD', '澳大利亚元'], ['KRW', '韩元'], ['TWD', '新台币'], ['VND', '越南盾'],
    ['RUB', '俄罗斯卢布'], ['MMK', '缅甸元'], ['CHF', '瑞士法郎'], ['INR', '印度卢比'],
    ['PKR', '巴基斯坦卢比']
];

const additionalCurrencyCodes = [
    'AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AWG', 'AZN', 'BAM', 'BBD', 'BDT',
    'BGN', 'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BRL', 'BSD', 'BTN', 'BWP', 'BYN', 'BZD',
    'CDF', 'CLP', 'COP', 'CRC', 'CUP', 'CVE', 'CZK', 'DJF', 'DKK', 'DOP', 'DZD', 'EGP',
    'ERN', 'ETB', 'FJD', 'FKP', 'GEL', 'GHS', 'GIP', 'GMD', 'GNF', 'GTQ', 'GYD', 'HNL',
    'HRK', 'HTG', 'HUF', 'IDR', 'ILS', 'IQD', 'IRR', 'ISK', 'JMD', 'JOD', 'KES', 'KGS',
    'KHR', 'KMF', 'KWD', 'KYD', 'KZT', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'LYD', 'MAD',
    'MDL', 'MGA', 'MKD', 'MNT', 'MOP', 'MRU', 'MUR', 'MVR', 'MWK', 'MXN', 'MYR', 'MZN',
    'NAD', 'NGN', 'NIO', 'NOK', 'NPR', 'NZD', 'OMR', 'PAB', 'PEN', 'PGK', 'PHP', 'PLN',
    'PYG', 'QAR', 'RON', 'RSD', 'RWF', 'SAR', 'SBD', 'SCR', 'SDG', 'SEK', 'SHP', 'SLE',
    'SOS', 'SRD', 'SSP', 'STN', 'SYP', 'SZL', 'THB', 'TJS', 'TMT', 'TND', 'TOP', 'TRY',
    'TTD', 'TZS', 'UAH', 'UGX', 'UYU', 'UZS', 'VES', 'VUV', 'WST', 'XAF', 'XCD', 'XOF',
    'XPF', 'YER', 'ZAR', 'ZMW', 'ZWL'
];

const currencyFallbackNames = {
    AED: '阿联酋迪拉姆', AFN: '阿富汗尼', ALL: '阿尔巴尼亚列克', AMD: '亚美尼亚德拉姆',
    ARS: '阿根廷比索', BRL: '巴西雷亚尔', CHF: '瑞士法郎', CLP: '智利比索', COP: '哥伦比亚比索',
    CZK: '捷克克朗', DKK: '丹麦克朗', EGP: '埃及镑', HUF: '匈牙利福林', IDR: '印尼盾',
    ILS: '以色列新谢克尔', INR: '印度卢比', ISK: '冰岛克朗', KES: '肯尼亚先令', KWD: '科威特第纳尔',
    MXN: '墨西哥比索', MYR: '马来西亚林吉特', NOK: '挪威克朗', NZD: '新西兰元', PLN: '波兰兹罗提',
    QAR: '卡塔尔里亚尔', RON: '罗马尼亚列伊', SAR: '沙特里亚尔', SEK: '瑞典克朗', THB: '泰铢',
    TRY: '土耳其里拉', UAH: '乌克兰格里夫纳', ZAR: '南非兰特'
};

const currencyCodes = [...new Set([
    ...converterCurrencies.map(([code]) => code),
    ...additionalCurrencyCodes
])];
const popularCurrencyCodes = converterCurrencies.map(([code]) => code);
const currencyNameFormatter = typeof Intl !== 'undefined' && Intl.DisplayNames
    ? new Intl.DisplayNames(['zh-CN'], { type: 'currency' })
    : null;

function getCurrencyName(code) {
    if (currencyFallbackNames[code]) return currencyFallbackNames[code];
    try {
        return currencyNameFormatter?.of(code) || code;
    } catch (error) {
        return code;
    }
}

const currencyRegionOverrides = {
    ANG: 'CW', EUR: 'EU', XAF: 'CM', XCD: 'AG', XOF: 'SN', XPF: 'PF'
};
const flagAssets = import.meta.glob('../node_modules/flag-icons/flags/1x1/{ae,af,ag,al,am,ao,ar,au,aw,az,ba,bb,bd,bg,bh,bi,bm,bn,bo,br,bs,bt,bw,by,bz,ca,cd,ch,cl,cm,cn,co,cr,cu,cv,cw,cz,dj,dk,do,dz,eg,er,et,eu,fj,fk,gb,ge,gh,gi,gm,gn,gt,gy,hk,hn,hr,ht,hu,id,il,in,iq,ir,is,jm,jo,jp,ke,kg,kh,km,kr,kw,ky,kz,la,lb,lk,lr,ls,ly,ma,md,mg,mk,mm,mn,mo,mr,mu,mv,mw,mx,my,mz,na,ng,ni,no,np,nz,om,pa,pe,pf,pg,ph,pk,pl,py,qa,ro,rs,ru,rw,sa,sb,sc,sd,se,sg,sh,sl,sn,so,sr,ss,st,sy,sz,th,tj,tm,tn,to,tr,tt,tw,tz,ua,ug,us,uy,uz,ve,vn,vu,ws,ye,za,zm,zw}.svg', {
    eager: true,
    query: '?url',
    import: 'default'
});
const currencyFlagAssets = Object.fromEntries(Object.entries(flagAssets).map(([path, url]) => [
    path.match(/([^/]+)\.svg$/)?.[1],
    url
]));

function getCurrencyRegion(code) {
    const region = currencyRegionOverrides[code] || code.slice(0, 2);
    return /^[A-Z]{2}$/.test(region) ? region.toLocaleLowerCase() : '';
}

function getCurrencyFlagUrl(code) {
    return currencyFlagAssets[getCurrencyRegion(code)] || '';
}

const currencyDirectory = currencyCodes.map(code => ({
    code,
    name: getCurrencyName(code),
    popular: popularCurrencyCodes.includes(code)
}));

const els = {
    price: document.getElementById('price'),
    currency: document.getElementById('currency'),
    cycles: document.getElementsByName('cycle'),
    dueDate: document.getElementById('dueDate'),
    tradeDate: document.getElementById('tradeDate'),
    customRate: document.getElementById('customRate'),
    apiRateDisplay: document.getElementById('apiRateDisplay'),
    refreshBtn: document.getElementById('refreshRateBtn'),
    refreshIcon: document.getElementById('refreshIcon'),
    symbolDisplay: document.querySelector('.symbol-display'),
    finalValue: document.getElementById('finalValue'),
    originalCurrencyValue: document.getElementById('originalCurrencyValue'),
    amountCopyTip: document.getElementById('amountCopyTip'),
    premiumInput: document.getElementById('premiumInput'),
    salePriceInput: document.getElementById('salePriceInput'),
    daysRemaining: document.getElementById('daysRemaining'),
    progressBar: document.getElementById('progressBar'),
    progressText: document.getElementById('progressText'),
    priceCNYPreview: document.getElementById('priceCNYPreview'),
    toast: document.getElementById('toast'),
    rateLimitTip: document.getElementById('rateLimitTip'),
    themeToggle: document.getElementById('themeToggle'),
    themeToggleKnob: document.getElementById('themeToggleKnob')
};

const converterEls = {
    from: document.getElementById('converterFrom'),
    amount: document.getElementById('converterAmount'),
    to: document.getElementById('converterTo'),
    rate: document.getElementById('converterRate'),
    swap: document.getElementById('converterSwapBtn'),
    button: document.getElementById('converterBtn'),
    result: document.getElementById('converterResult')
};

let rateLimitTimer = null;
let remainingValueCNY = 0;
let quoteLastEdited = 'premium';

window.addEventListener('DOMContentLoaded', () => {
    try {
        initTheme();
        initCurrencyConverter();
        loadInputsFromCookie();
        initQuoteFields();
        initDates(); 
        syncDateDisplay(els.dueDate);
        syncDateDisplay(els.tradeDate);
        initRates(); 
        setupEventListeners();
        calculate(); 
    } finally {
        hideAppLoader();
    }
});

function hideAppLoader() {
    const loader = document.getElementById('appLoader');
    if (!loader) return;

    requestAnimationFrame(() => {
        loader.classList.add('is-hidden');
        window.setTimeout(() => loader.remove(), 180);
    });
}

function setupEventListeners() {
    const debouncedSave = debounce(saveInputsToCookie, 500);

    [els.price, els.dueDate, els.tradeDate, els.customRate].forEach(el => el.addEventListener('input', () => {
        if (el.type === 'date') syncDateDisplay(el);
        calculate();
        debouncedSave();
    }));

    [els.dueDate, els.tradeDate].forEach(el => el.addEventListener('change', () => {
        syncDateDisplay(el);
        calculate();
        saveInputsToCookie();
    }));
    
    els.cycles.forEach(radio => radio.addEventListener('change', () => {
        calculate();
        saveInputsToCookie();
    }));

    els.currency.addEventListener('change', () => {
        updateCurrencySymbol();
        initRates(); 
        calculate();
        saveInputsToCookie();
    });

    els.refreshBtn.addEventListener('click', manualRefreshRate); 
    converterEls.from.addEventListener('change', updateCurrencyConverter);
    converterEls.to.addEventListener('change', updateCurrencyConverter);
    converterEls.swap.addEventListener('click', swapConverterCurrencies);
    converterEls.amount.addEventListener('input', () => {
        validateNumberInput(converterEls.amount);
        convertCurrency();
    });
    converterEls.button.addEventListener('click', convertCurrency);
    validateNumberInput(converterEls.amount);
    els.themeToggle.addEventListener('click', toggleTheme);
    els.finalValue.addEventListener('click', copyFinalValueAmount);
    els.finalValue.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        copyFinalValueAmount();
    });

    [els.premiumInput, els.salePriceInput].forEach(el => {
        el.addEventListener('input', () => {
            quoteLastEdited = el === els.salePriceInput ? 'sale' : 'premium';
            syncQuoteFields();
            debouncedSave();
        });

        el.addEventListener('blur', () => {
            syncQuoteFields({ formatActive: true });
            saveInputsToCookie();
        });
    });

    // Firefox：date input 改为 visibility:hidden，不接收点击 → 在 wrapper 上绑定点击来触发 showPicker()
    // 非 Firefox：原生透明日历指示器在 webkit 上会自己响应点击，同时下面的 icon handler 作为后备
    if (document.documentElement.classList.contains('is-firefox')) {
        document.querySelectorAll('.date-input-wrapper').forEach((wrapper) => {
            wrapper.addEventListener('click', () => {
                const input = wrapper.querySelector('input[type="date"]');
                if (!input) return;
                try {
                    if (typeof input.showPicker === 'function') {
                        input.showPicker();
                    } else {
                        input.focus();
                    }
                } catch (err) {
                    // ignore
                }
            });
        });
    } else {
        // 非 Firefox：点击右侧自定义日历图标触发 picker
        document.querySelectorAll('.date-input-wrapper .date-input-icon').forEach((icon) => {
            icon.addEventListener('click', (e) => {
                const input = icon.parentElement && icon.parentElement.querySelector('input[type="date"]');
                if (!input) return;
                e.preventDefault();
                try {
                    if (typeof input.showPicker === 'function') {
                        input.showPicker();
                    } else {
                        input.focus();
                    }
                } catch (err) {
                    input.focus();
                }
            });
        });
    }

    // 价格 / 汇率 输入校验：负数或非法时高亮红边
    [els.price, els.customRate].forEach(el => {
        el.addEventListener('input', () => validateNumberInput(el));
        validateNumberInput(el);
    });

    els.salePriceInput.addEventListener('input', () => validateNumberInput(els.salePriceInput));
    validateNumberInput(els.salePriceInput);

    // ESC 关闭模态 / 限流提示
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!modal.el.classList.contains('hidden')) closeImageModal();
        if (els.rateLimitTip.classList.contains('show')) hideRateLimitTip();
    });
}

function validateNumberInput(el) {
    const raw = el.value.trim();
    if (raw === '') {
        el.classList.remove('input-invalid');
        return true;
    }
    const v = parseFloat(raw);
    const ok = Number.isFinite(v) && v >= 0;
    el.classList.toggle('input-invalid', !ok);
    return ok;
}

function initCurrencyConverter() {
    const options = currencyDirectory
        .map(({ code, name }) => `<option value="${code}">${name} (${code})</option>`)
        .join('');

    [els.currency, converterEls.from, converterEls.to].forEach(select => {
        const previousValue = select.value;
        select.innerHTML = options;
        if (currencyCodes.includes(previousValue)) select.value = previousValue;
        if (select === converterEls.from && !previousValue) select.value = 'USD';
        if (select === converterEls.to && !previousValue) select.value = 'CNY';
    });

    createCurrencyPicker(els.currency);
    createCurrencyPicker(converterEls.from);
    createCurrencyPicker(converterEls.to);
    updateCurrencySymbol();
    updateCurrencyConverter();
}

function createCurrencyPicker(select) {
    const parent = select.parentElement;
    if (!parent || parent.querySelector('.currency-picker-trigger')) return;

    parent.classList.add('currency-picker');
    select.classList.add('currency-native-select');
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;
    const oldArrow = select.nextElementSibling;
    if (oldArrow?.querySelector('svg')) oldArrow.remove();

    const pickerId = `${select.id}-picker`;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.id = `${pickerId}-trigger`;
    trigger.className = 'currency-picker-trigger';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', `${pickerId}-menu`);
    trigger.setAttribute('aria-label', select.getAttribute('aria-label') || select.previousElementSibling?.textContent?.trim() || '选择货币');
    document.querySelector(`label[for="${select.id}"]`)?.setAttribute('for', trigger.id);

    const panel = document.createElement('div');
    panel.id = `${pickerId}-menu`;
    panel.className = 'currency-picker-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '搜索货币');
    panel.innerHTML = `
        <div class="currency-picker-search-wrap">
            <svg class="currency-picker-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <circle cx="11" cy="11" r="7" stroke-width="2"></circle>
                <path d="m20 20-4-4" stroke-width="2" stroke-linecap="round"></path>
            </svg>
            <input type="search" class="currency-picker-search" placeholder="搜索货币..." autocomplete="off" aria-label="搜索货币" role="combobox" aria-expanded="true" aria-controls="${pickerId}-list">
        </div>
        <div id="${pickerId}-list" class="currency-picker-list" role="listbox" tabindex="-1"></div>`;

    parent.insertBefore(trigger, select);
    parent.appendChild(panel);
    const search = panel.querySelector('.currency-picker-search');
    const list = panel.querySelector('.currency-picker-list');

    const updateTrigger = () => {
        const currency = currencyDirectory.find(item => item.code === select.value) || currencyDirectory[0];
        trigger.innerHTML = `<span class="currency-picker-flag" aria-hidden="true"></span><span class="currency-picker-code">${currency.code}</span><span class="currency-picker-name">${currency.name}</span><svg class="currency-picker-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="m7 10 5 5 5-5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
        trigger.querySelector('.currency-picker-flag').style.backgroundImage = `url("${getCurrencyFlagUrl(currency.code)}")`;
        trigger.setAttribute('aria-label', `${currency.code} ${currency.name}`);
    };

    const close = (restoreFocus = false) => {
        panel.hidden = true;
        parent.classList.remove('is-open', 'opens-up');
        trigger.setAttribute('aria-expanded', 'false');
        search.value = '';
        if (restoreFocus) trigger.focus();
    };

    const choose = (code) => {
        if (!currencyCodes.includes(code)) return;
        select.value = code;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        updateTrigger();
        close(true);
    };

    const renderList = (query = '') => {
        const normalizedQuery = query.trim().toLocaleLowerCase();
        const matches = currencyDirectory.filter(item => {
            if (!normalizedQuery) return true;
            return `${item.code} ${item.name}`.toLocaleLowerCase().includes(normalizedQuery);
        });
        const popular = matches.filter(item => item.popular);
        const all = matches.filter(item => !item.popular);
        list.innerHTML = '';

        const renderGroup = (label, items) => {
            if (!items.length) return;
            const heading = document.createElement('div');
            heading.className = 'currency-picker-group-label';
            heading.textContent = label;
            list.appendChild(heading);
            items.forEach(item => {
                const option = document.createElement('button');
                option.type = 'button';
                option.className = 'currency-picker-option';
                option.dataset.code = item.code;
                option.setAttribute('role', 'option');
                option.setAttribute('aria-selected', String(item.code === select.value));
                option.innerHTML = `<span class="currency-picker-flag" aria-hidden="true"></span><span class="currency-picker-option-code">${item.code}</span><span class="currency-picker-option-name">${item.name}</span><svg class="currency-picker-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="m5 12 4 4L19 6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
                option.querySelector('.currency-picker-flag').style.backgroundImage = `url("${getCurrencyFlagUrl(item.code)}")`;
                option.addEventListener('click', () => choose(item.code));
                option.addEventListener('keydown', event => {
                    const options = [...list.querySelectorAll('.currency-picker-option')];
                    const index = options.indexOf(option);
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
                    } else if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        choose(item.code);
                    } else if (event.key === 'Escape') {
                        event.preventDefault();
                        close(true);
                    }
                });
                list.appendChild(option);
            });
        };

        if (!matches.length) {
            const empty = document.createElement('div');
            empty.className = 'currency-picker-empty';
            empty.textContent = '未找到匹配货币';
            list.appendChild(empty);
            return;
        }
        if (!normalizedQuery) renderGroup('热门', popular);
        renderGroup(normalizedQuery ? '搜索结果' : '所有货币', normalizedQuery ? matches : all);
    };

    const open = () => {
        document.querySelectorAll('.currency-picker.is-open').forEach(openParent => {
            if (openParent !== parent) openParent.querySelector('.currency-picker-trigger')?.click();
        });
        renderList();
        panel.hidden = false;
        const triggerRect = trigger.getBoundingClientRect();
        const spaceBelow = window.innerHeight - triggerRect.bottom;
        parent.classList.toggle('opens-up', spaceBelow < 320 && triggerRect.top > spaceBelow);
        parent.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
        window.requestAnimationFrame(() => search.focus());
    };

    trigger.addEventListener('click', () => panel.hidden ? open() : close());
    trigger.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
        } else if (event.key === 'Escape') {
            close();
        }
    });
    search.addEventListener('input', () => renderList(search.value));
    search.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            close(true);
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            list.querySelector('.currency-picker-option')?.focus();
        } else if (event.key === 'Enter') {
            const firstOption = list.querySelector('.currency-picker-option');
            if (firstOption && list.querySelectorAll('.currency-picker-option').length === 1) choose(firstOption.dataset.code);
        }
    });
    select.addEventListener('change', updateTrigger);
    document.addEventListener('pointerdown', event => {
        if (!parent.contains(event.target)) close();
    });
    select.currencyPickerRefresh = updateTrigger;
    updateTrigger();
}

function swapConverterCurrencies() {
    const from = converterEls.from.value;
    converterEls.from.value = converterEls.to.value;
    converterEls.to.value = from;
    converterEls.from.currencyPickerRefresh?.();
    converterEls.to.currencyPickerRefresh?.();
    updateCurrencyConverter();
}

async function updateCurrencyConverter() {
    const rate = await getConverterRate(converterEls.from.value, converterEls.to.value);
    if (!Number.isFinite(rate)) {
        converterEls.rate.textContent = '汇率: 获取失败';
        converterEls.result.textContent = '--';
        return;
    }
    converterEls.rate.textContent = `汇率: 1 ${converterEls.from.value} = ${formatRate(rate)} ${converterEls.to.value}`;
    convertCurrency(rate);
}

async function convertCurrency(knownRate) {
    const amount = parseFloat(converterEls.amount.value);
    if (!Number.isFinite(amount) || amount < 0) {
        converterEls.result.textContent = '--';
        return;
    }

    const rate = Number.isFinite(knownRate)
        ? knownRate
        : await getConverterRate(converterEls.from.value, converterEls.to.value);
    if (!Number.isFinite(rate)) {
        converterEls.result.textContent = '--';
        return;
    }

    const result = amount * rate;
    converterEls.result.textContent = `${formatAmount(amount)} ${converterEls.from.value} = ${result.toFixed(2)} ${converterEls.to.value}`;
}

async function getConverterRate(from, to) {
    if (from === to) return 1;
    const rates = await getConverterRates();
    if (!rates || typeof rates[from] !== 'number' || typeof rates[to] !== 'number') return NaN;
    return rates[to] / rates[from];
}

async function getConverterRates() {
    const cacheKey = 'vps_converter_rates';
    const cached = getCookie(cacheKey);
    if (cached) {
        try {
            const rates = JSON.parse(cached);
            rates.CNY = 1;
            return rates;
        } catch (e) {}
    }

    try {
        const response = await fetch(API_URL);
        const data = await response.json();
        if (data.result !== 'success' || !data.rates) throw new Error('API Error');
        data.rates.CNY = 1;
        setCookie(cacheKey, JSON.stringify(data.rates), RATE_CACHE_HOURS);
        return data.rates;
    } catch (error) {
        console.error(error);
        showToast('获取汇率失败');
        return null;
    }
}

function formatRate(value) {
    return value >= 100 ? value.toFixed(2) : Number(value.toFixed(4)).toString();
}

function formatAmount(value) {
    return Number.isInteger(value) ? value.toString() : value.toFixed(2);
}

function initQuoteFields() {
    updateQuotePlaceholders();
    syncQuoteFields();
}

function parseQuoteValue(value) {
    if (typeof value !== 'string' || value.trim() === '') return NaN;
    return parseFloat(value);
}

function formatMoney(value) {
    return Number.isFinite(value) ? value.toFixed(2) : '';
}

function updatePremiumTone(value) {
    els.premiumInput.classList.remove('premium-positive', 'premium-negative', 'premium-neutral');

    if (!Number.isFinite(value) || value === 0) {
        els.premiumInput.classList.add('premium-neutral');
    } else if (value > 0) {
        els.premiumInput.classList.add('premium-positive');
    } else {
        els.premiumInput.classList.add('premium-negative');
    }
}

function updateSaleTone(isNeutral) {
    els.salePriceInput.classList.toggle('sale-neutral', isNeutral);
}

function updateQuotePlaceholders() {
    els.premiumInput.placeholder = '0.00';
    els.salePriceInput.placeholder = formatMoney(remainingValueCNY) || '0.00';
}

function syncQuoteFields(options = {}) {
    const { formatActive = false } = options;
    const premiumRaw = els.premiumInput.value.trim();
    const saleRaw = els.salePriceInput.value.trim();

    updateQuotePlaceholders();

    if (quoteLastEdited === 'sale') {
        const salePrice = parseQuoteValue(saleRaw);

        if (Number.isFinite(salePrice)) {
            const premium = salePrice - remainingValueCNY;
            els.premiumInput.value = formatMoney(premium);
            if (formatActive) els.salePriceInput.value = formatMoney(salePrice);
            updatePremiumTone(premium);
            updateSaleTone(false);
        } else {
            els.premiumInput.value = '';
            updatePremiumTone(NaN);
            updateSaleTone(true);
        }
        return;
    }

    const premium = premiumRaw === '' ? 0 : parseQuoteValue(els.premiumInput.value);

    if (Number.isFinite(premium)) {
        if (premiumRaw === '') {
            els.salePriceInput.value = '';
            updatePremiumTone(0);
            updateSaleTone(true);
            return;
        }

        const salePrice = remainingValueCNY + premium;
        els.salePriceInput.value = formatMoney(salePrice);
        if (formatActive) els.premiumInput.value = formatMoney(premium);
        updatePremiumTone(premium);
        updateSaleTone(premiumRaw === '' || premium === 0);
    } else {
        els.salePriceInput.value = '';
        updatePremiumTone(NaN);
        updateSaleTone(true);
    }
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

function initTheme() {
    if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
        updateToggleUI(true);
    } else {
        document.documentElement.classList.remove('dark');
        updateToggleUI(false);
    }
}

function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.theme = isDark ? 'dark' : 'light';
    updateToggleUI(isDark);
}

function updateToggleUI(isDark) {
    if (isDark) {
        els.themeToggleKnob.classList.add('translate-x-6');
        els.themeToggleKnob.classList.remove('translate-x-1');
    } else {
        els.themeToggleKnob.classList.remove('translate-x-6');
        els.themeToggleKnob.classList.add('translate-x-1');
    }
}

// 注意：函数名沿用历史命名（setCookie / getCookie），实际底层是 localStorage + 过期时间，
// 同时兼容旧版本可能写到 document.cookie 的数据。
function setCookie(name, value, hours) {
    const expiresAt = Date.now() + (hours * 60 * 60 * 1000);
    localStorage.setItem(name, JSON.stringify({ value, expiresAt }));
}

function getCookie(name) {
    const stored = localStorage.getItem(name);
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            if (!parsed.expiresAt || parsed.expiresAt > Date.now()) {
                return parsed.value || "";
            }
            localStorage.removeItem(name);
        } catch (e) {
            localStorage.removeItem(name);
        }
    }

    const cname = name + "=";
    const decodedCookie = decodeURIComponent(document.cookie);
    const ca = decodedCookie.split(';');
    for(let i = 0; i <ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) == ' ') {
            c = c.substring(1);
        }
        if (c.indexOf(cname) == 0) {
            return c.substring(cname.length, c.length);
        }
    }
    return "";
}

async function getHtmlToImage() {
    if (!htmlToImageModulePromise) {
        htmlToImageModulePromise = import('html-to-image');
    }

    return htmlToImageModulePromise;
}

function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) {
                resolve(blob);
            } else {
                reject(new Error(`Canvas export failed: ${type}`));
            }
        }, type, quality);
    });
}

function resetGeneratedImage() {
    if (generatedImageUrl) {
        URL.revokeObjectURL(generatedImageUrl);
    }
    generatedImageUrl = '';
}

function formatDateForDisplay(value) {
    return value ? value.replace(/-/g, '/') : '--/--/--';
}

function syncDateDisplay(input) {
    const wrapper = input && input.parentElement;
    const display = wrapper && wrapper.querySelector('.date-display-value');
    if (!display) return;
    display.textContent = formatDateForDisplay(input.value);
}

function prepareDateInputsForExport(node) {
    const restoreTasks = [];
    const inputs = node.querySelectorAll('input[type="date"]');

    inputs.forEach((input) => {
        const wrapper = input.parentElement;
        if (!wrapper) return;
        const display = wrapper.querySelector('.date-display-value') || document.createElement('span');
        const hadDisplay = wrapper.contains(display);
        if (!hadDisplay) {
            display.className = 'date-display-value text-xs md:text-sm font-medium tabular-nums';
            wrapper.insertBefore(display, input.nextSibling);
        }
        display.classList.add('date-display-export');
        display.textContent = formatDateForDisplay(input.value);
        // visibility:hidden 而非 display:none：保留 input 在文档流中的占位高度，
        // 避免 wrapper 塌陷导致 position:absolute 的 display 层变为 0px 高度。
        input.style.visibility = 'hidden';

        restoreTasks.push(() => {
            input.style.visibility = '';
            display.classList.remove('date-display-export');
            if (!hadDisplay) display.remove();
        });
    });

    return () => {
        restoreTasks.reverse().forEach((restore) => restore());
    };
}

/*
 * html-to-image 序列化时无法可靠保留 -webkit-/-moz-appearance 这类伪元素相关样式，
 * Firefox 截图里 number input 会重新出现上下调节按钮。导出前用 div 替换，导出后还原。
 */
function prepareNumberInputsForExport(node) {
    const restoreTasks = [];
    const inputs = node.querySelectorAll('input[type="number"]');

    inputs.forEach((input) => {
        const display = document.createElement('div');
        display.className = input.className;
        const cs = window.getComputedStyle(input);
        // 保留输入框的对齐方式（部分 number 框是居中显示的）
        display.style.display = 'flex';
        display.style.alignItems = 'center';
        display.style.justifyContent = cs.textAlign === 'center'
            ? 'center'
            : (cs.textAlign === 'right' ? 'flex-end' : 'flex-start');
        // 保留动态计算的左内边距，防止多字符货币符号（如 NT$）在截图时与数值重叠
        display.style.paddingLeft = cs.paddingLeft;
        display.textContent = input.value || input.placeholder || '';
        input.style.display = 'none';
        input.parentElement && input.parentElement.insertBefore(display, input);

        restoreTasks.push(() => {
            input.style.display = '';
            display.remove();
        });
    });

    return () => {
        restoreTasks.reverse().forEach((restore) => restore());
    };
}

function prepareQuoteSectionForExport(mainCard) {
    const premium = parseQuoteValue(els.premiumInput.value);
    const shouldHideQuote = !Number.isFinite(premium) || premium === 0;
    mainCard.classList.toggle('quote-export-empty', shouldHideQuote);

    return () => {
        mainCard.classList.remove('quote-export-empty');
    };
}

function prepareSelectInputsForExport(node) {
    const restoreTasks = [];
    const selects = node.querySelectorAll('select');

    selects.forEach((select) => {
        const selectedValue = select.value;
        const selectedIndex = select.selectedIndex;
        const optionSnapshots = Array.from(select.options).map((option) => ({
            defaultSelected: option.defaultSelected,
            hasSelectedAttr: option.hasAttribute('selected')
        }));

        Array.from(select.options).forEach((option) => {
            const isCurrent = option.value === select.value;
            option.defaultSelected = isCurrent;
            option.toggleAttribute('selected', isCurrent);
        });

        restoreTasks.push(() => {
            Array.from(select.options).forEach((option, index) => {
                const snapshot = optionSnapshots[index];
                option.defaultSelected = snapshot.defaultSelected;
                option.toggleAttribute('selected', snapshot.hasSelectedAttr);
            });
            select.value = selectedValue;
            if (select.value !== selectedValue) select.selectedIndex = selectedIndex;
        });
    });

    return () => {
        restoreTasks.reverse().forEach((restore) => restore());
    };
}

function saveInputsToCookie() {
    const data = {
        price: els.price.value,
        currency: els.currency.value,
        cycle: Array.from(els.cycles).find(r => r.checked)?.value || "365",
        dueDate: els.dueDate.value,
        customRate: els.customRate.value,
        premium: els.premiumInput.value,
        salePrice: els.salePriceInput.value,
        quoteLastEdited
    };
    setCookie("vps_inputs", JSON.stringify(data), 0.5);
}

function loadInputsFromCookie() {
    const saved = getCookie("vps_inputs");
    if (saved) {
        try {
            const data = JSON.parse(saved);
            if(data.price) els.price.value = data.price;
            if(data.currency) els.currency.value = data.currency;
            if(data.dueDate) els.dueDate.value = data.dueDate;
            if(data.customRate) els.customRate.value = data.customRate;
            if(data.quoteLastEdited === 'sale' || data.quoteLastEdited === 'premium') {
                quoteLastEdited = data.quoteLastEdited;
                if (quoteLastEdited === 'sale' && data.salePrice) {
                    els.salePriceInput.value = data.salePrice;
                } else if (quoteLastEdited === 'premium' && data.premium && parseFloat(data.premium) !== 0) {
                    els.premiumInput.value = data.premium;
                }
            }
            if(data.cycle) {
                const radio = document.querySelector(`input[name="cycle"][value="${data.cycle}"]`);
                if(radio) radio.checked = true;
            }
            updateCurrencySymbol();
            els.currency.currencyPickerRefresh?.();
        } catch(e) { console.error("Cookie parse error", e); }
    }
}

async function initRates() {
    const base = els.currency.value;
    if (base === 'CNY') {
        finishRateUpdate(1, "1.0000");
        return;
    }

    const cacheKey = `vps_rate_${base}`;
    const cachedData = getCookie(cacheKey);

    if (cachedData) {
        try {
            const data = JSON.parse(cachedData);
            finishRateUpdate(data.rate, data.rate.toFixed(4));
        } catch (e) {
            manualRefreshRate(false);
        }
    } else {
        manualRefreshRate(false);
    }
}

async function manualRefreshRate(isUserClick = true) {
    const base = els.currency.value;
    if (base === 'CNY') return;

    const limitKey = "vps_refresh_limit";
    const rawLimit = getCookie(limitKey);
    let limitData = { count: 0, resetTime: Date.now() + 12*3600*1000 };

    if (rawLimit) {
        try {
            const parsed = JSON.parse(rawLimit);
            if (parsed.resetTime && Date.now() < parsed.resetTime) {
                limitData = parsed;
            } else {
                limitData = { count: 0, resetTime: Date.now() + RATE_CACHE_HOURS*3600*1000 };
            }
        } catch(e) {}
    }

    if (isUserClick) {
        if (limitData.count >= MANUAL_REFRESH_LIMIT) {
            showRateLimitTip();
            return;
        }
        limitData.count++;
        const hoursLeft = (limitData.resetTime - Date.now()) / (1000*3600);
        setCookie(limitKey, JSON.stringify(limitData), Math.max(0.1, hoursLeft));
    }

    await fetchExchangeRate();
}

async function fetchExchangeRate() {
    const base = els.currency.value;
    els.refreshIcon.classList.add('spin');
    els.apiRateDisplay.textContent = "刷新中";

    try {
        const response = await fetch(API_URL);
        const data = await response.json();
        
        if (data.result === "success") {
            const baseInCNY = data.rates && data.rates[base];
            if (typeof baseInCNY === 'number' && baseInCNY > 0 && Number.isFinite(baseInCNY)) {
                const rate = 1 / baseInCNY;
                finishRateUpdate(rate, rate.toFixed(4));
                
                const cacheData = JSON.stringify({ rate: rate, time: Date.now() });
                setCookie(`vps_rate_${base}`, cacheData, RATE_CACHE_HOURS);
                saveInputsToCookie();
            } else {
                throw new Error("Invalid rate value");
            }
        } else {
            throw new Error("API Error");
        }
    } catch (error) {
        console.error(error);
        els.apiRateDisplay.textContent = "汇率刷新";
        els.refreshIcon.classList.remove('spin');
        showToast("获取汇率失败");
    }
}

function finishRateUpdate(rate, text) {
    els.customRate.value = rate.toFixed(4);
    els.apiRateDisplay.textContent = "汇率刷新";
    els.refreshIcon.classList.remove('spin');
    calculate();
}

function showRateLimitTip() {
    els.rateLimitTip.classList.add('show');
    if (rateLimitTimer) clearTimeout(rateLimitTimer);
    rateLimitTimer = setTimeout(() => {
        hideRateLimitTip();
    }, 2000);
}

function hideRateLimitTip() {
    els.rateLimitTip.classList.remove('show');
    if (rateLimitTimer) {
        clearTimeout(rateLimitTimer);
        rateLimitTimer = null;
    }
}

function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    setTimeout(() => {
        els.toast.classList.remove('show');
    }, 2000);
}

function initDates() {
    const now = new Date();
    els.tradeDate.value = formatDate(now);
    syncDateDisplay(els.tradeDate);
    if (els.dueDate.value) {
        syncDateDisplay(els.dueDate);
        return;
    }
    const currentYear = now.getFullYear();
    const thisYearNov25 = new Date(currentYear, 10, 25); 
    let targetDueDate;
    if (now.getTime() <= thisYearNov25.getTime()) {
        targetDueDate = thisYearNov25;
    } else {
        targetDueDate = new Date(currentYear + 1, 10, 25);
    }
    els.dueDate.value = formatDate(targetDueDate);
    syncDateDisplay(els.dueDate);
}

function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function updateCurrencySymbol() {
    const code = els.currency.value;
    const sym = getCurrencySymbol(code);
    els.symbolDisplay.textContent = sym;
    // Dynamically adjust input left padding to prevent symbol/text overlap
    requestAnimationFrame(() => {
        const symRect = els.symbolDisplay.getBoundingClientRect();
        const inputRect = els.price.getBoundingClientRect();
        const neededPad = symRect.right - inputRect.left + 6;
        els.price.style.paddingLeft = Math.max(neededPad, 32) + 'px';
    });
}

function getCurrencySymbol(code) {
    if (currencySymbols[code]) return currencySymbols[code];
    try {
        const symbol = new Intl.NumberFormat('zh-CN', {
            style: 'currency',
            currency: code,
            currencyDisplay: 'narrowSymbol'
        }).formatToParts(0).find(part => part.type === 'currency')?.value;
        return symbol || code;
    } catch (error) {
        return code;
    }
}

function calculate() {
    const priceRaw = parseFloat(els.price.value);
    const rateRaw = parseFloat(els.customRate.value);
    const price = Number.isFinite(priceRaw) && priceRaw >= 0 ? priceRaw : 0;
    const rate = Number.isFinite(rateRaw) && rateRaw > 0 ? rateRaw : 0;
    const due = new Date(els.dueDate.value);
    const trade = new Date(els.tradeDate.value);

    let cycleDays = 365;
    for (const radio of els.cycles) {
        if (radio.checked) { cycleDays = parseInt(radio.value); break; }
    }

    const totalCNY = price * rate;
    els.priceCNYPreview.textContent = `≈${totalCNY.toFixed(2)}元`;

    // 空 / 非法日期：清空结果区，给出占位提示
    if (isNaN(due.getTime()) || isNaN(trade.getTime())) {
        remainingValueCNY = 0;
        setFinalValueDisplay('0.00');
        els.originalCurrencyValue.textContent = '请填写到期日 / 交易日';
        els.daysRemaining.textContent = '--';
        els.progressBar.style.width = '0%';
        els.progressText.textContent = '--';
        syncQuoteFields();
        return;
    }

    const diffTime = due - trade;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const dailyPrice = cycleDays > 0 ? price / cycleDays : 0;

    let valOrig = 0, valCNY = 0;

    if (diffDays > 0) {
        valOrig = dailyPrice * diffDays;
        valCNY = valOrig * rate;
    }

    // 进度条语义：当前续费周期内的「剩余比例」，文案显示按总剩余天数 / 周期取整。
    let progressPct;
    let displayProgressPct;
    if (diffDays <= 0) {
        progressPct = 0;
        displayProgressPct = 0;
    } else if (diffDays >= cycleDays) {
        progressPct = 100;
        displayProgressPct = Math.round((diffDays / cycleDays) * 100);
    } else {
        displayProgressPct = Math.max(1, Math.round((diffDays / cycleDays) * 100));
        progressPct = displayProgressPct;
    }

    els.progressBar.style.width = `${progressPct}%`;
    remainingValueCNY = valCNY;
    setFinalValueDisplay(valCNY.toFixed(2));
    els.originalCurrencyValue.textContent = `≈ ${valOrig.toFixed(2)} ${els.currency.value}`;
    els.daysRemaining.textContent = diffDays > 0 ? diffDays : '0';
    els.progressText.textContent = `${displayProgressPct}%`;
    syncQuoteFields();
}

function setFinalValueDisplay(value) {
    els.finalValue.textContent = value;
    const numericLength = value.replace(/[^0-9]/g, '').length;
    const isLongValue = numericLength >= 7;
    els.finalValue.classList.toggle('final-value-long', isLongValue);
    els.finalValue.closest('.result-amount-row')?.classList.toggle('final-value-row-long', isLongValue);
}

function copyResult() {
    const price = els.price.value || "0";
    const currency = els.currency.value;
    const rate = els.customRate.value || "0";
    const days = els.daysRemaining.textContent;
    const valCNY = els.finalValue.textContent;
    const valOrig = els.originalCurrencyValue.textContent.replace('≈', '').trim().split(' ')[0];
    const premium = els.premiumInput.value || '0.00';
    const salePrice = els.salePriceInput.value || valCNY;
    const tradeDate = els.tradeDate.value;
    const dueDate = els.dueDate.value;
    
    let cycleText = "年付";
    for (const radio of els.cycles) {
        if (radio.checked) { 
            cycleText = radio.parentElement.innerText.trim();
            break; 
        }
    }

    const cnyPrice = (parseFloat(price) * parseFloat(rate)).toFixed(2);
    const md = `## 🐔 VPS 剩余价值
- 📅 交易日期：${tradeDate}
- 💹 外币汇率：1 ${currency} ≈ ${rate} CNY
- 💰 续费价格：${price} ${currency}/${cycleText}（约 ${cnyPrice} 元）
- ⏳ 剩余天数：${days}天（${dueDate} 到期）
- 💎 剩余价值：${valCNY}元（约 ${valOrig} ${currency}）
- 🧾 溢价 / 售价：${premium}元 / ${salePrice}元`;

    copyTextToClipboard(md, flashCopyButton);
}

function copyTextToClipboard(text, done) {
    const fallbackCopy = () => {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.setAttribute('readonly', '');
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        try { document.execCommand("copy"); } catch (_) {}
        document.body.removeChild(textArea);
    };

    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done).catch(() => { fallbackCopy(); done(); });
    } else {
        fallbackCopy();
        done();
    }
}

function copyFinalValueAmount() {
    const amount = els.finalValue.textContent.trim();
    if (!amount) return;
    copyTextToClipboard(amount, flashAmountCopyTip);
}

function flashAmountCopyTip() {
    if (!els.amountCopyTip) return;
    els.amountCopyTip.classList.add('show');
    clearTimeout(flashAmountCopyTip._t);
    flashAmountCopyTip._t = setTimeout(() => {
        els.amountCopyTip.classList.remove('show');
    }, 1500);
}

function flashCopyButton() {
    const btn = document.getElementById('copyBtn');
    if (!btn) return;
    const label = btn.querySelector('span');
    const originalText = label ? label.textContent : '';
    btn.classList.add('btn-copied');
    if (label) label.textContent = '已复制 ✓';
    clearTimeout(flashCopyButton._t);
    flashCopyButton._t = setTimeout(() => {
        btn.classList.remove('btn-copied');
        if (label) label.textContent = originalText;
    }, 1500);
}

const modal = {
    el: document.getElementById('imageModal'),
    img: document.getElementById('generatedImage'),
    loading: document.getElementById('modalLoading'),
    actions: document.getElementById('modalActions')
};

function closeImageModal() {
    modal.el.classList.remove('opacity-100');
    setTimeout(() => {
        modal.el.classList.add('hidden');
        modal.img.classList.add('hidden');
        modal.actions.classList.add('hidden');
        modal.loading.classList.remove('hidden');
        modal.img.src = '';
        resetGeneratedImage();
    }, 300);
}

// Close modal on background click
modal.el.addEventListener('click', (e) => {
    if (e.target === modal.el) closeImageModal();
});

async function generateImage() {
    console.log('generateImage called');
    
    // Show modal immediately to indicate processing
    modal.el.classList.remove('hidden');
    // Force reflow
    void modal.el.offsetWidth;
    modal.el.classList.add('opacity-100');
    
    // Use setTimeout to allow UI to update before heavy lifting
    setTimeout(async () => {
        const node = document.getElementById('captureRoot');
        const mainCard = document.getElementById('mainCard');
        node.classList.add('exporting');
        mainCard.classList.add('exporting');
        const restoreQuoteSection = prepareQuoteSectionForExport(mainCard);
        const restoreDateInputs = prepareDateInputsForExport(mainCard);
        const restoreNumberInputs = prepareNumberInputsForExport(mainCard);
        const restoreSelectInputs = prepareSelectInputsForExport(mainCard);

        try {
            const htmlToImage = await getHtmlToImage();
            const rect = node.getBoundingClientRect();
            const cssWidth = Math.max(1, Math.ceil(rect.width));
            const widthBasedRatio = SHARE_IMAGE_MIN_WIDTH / cssWidth;
            const isLowEndDevice = (typeof navigator !== 'undefined'
                && typeof navigator.deviceMemory === 'number'
                && navigator.deviceMemory > 0
                && navigator.deviceMemory <= 4)
                || (typeof window !== 'undefined' && window.innerWidth < 400);
            const maxRatio = isLowEndDevice
                ? SHARE_IMAGE_LOW_END_MAX_PIXEL_RATIO
                : SHARE_IMAGE_MAX_PIXEL_RATIO;
            const pixelRatio = Math.min(
                maxRatio,
                Math.max(SHARE_IMAGE_MIN_PIXEL_RATIO, widthBasedRatio)
            );
            const canvas = await htmlToImage.toCanvas(node, {
                width: Math.ceil(rect.width),
                height: Math.ceil(rect.height),
                pixelRatio,
                filter: (element) => {
                    if (!element || !element.id) return true;
                    return !['themeToggle', 'btnContainer', 'footerWrap'].includes(element.id);
                },
                style: {
                    transform: 'scale(1)',
                }
            });
            const blob = await canvasToBlob(canvas, SHARE_IMAGE_MIME_TYPE, SHARE_IMAGE_QUALITY);
            resetGeneratedImage();
            generatedImageUrl = URL.createObjectURL(blob);

            console.log('Image generated successfully');
            modal.loading.classList.add('hidden');
            modal.img.src = generatedImageUrl;
            modal.img.classList.remove('hidden');
            modal.actions.classList.remove('hidden');
        } catch (e) {
            console.error('Synchronous error during image generation:', e);
            closeImageModal();
            showToast('生成出错');
        } finally {
            restoreSelectInputs();
            restoreNumberInputs();
            restoreDateInputs();
            restoreQuoteSection();
            mainCard.classList.remove('exporting');
            node.classList.remove('exporting');
        }
    }, 100);
}

// 用 addEventListener 绑定（替代 inline onclick），保持 HTML 与逻辑解耦
function bindActionButtons() {
    const map = [
        ['copyBtn', copyResult],
        ['imgBtn', generateImage],
        ['closeImageModalBtn', closeImageModal],
    ];
    for (const [id, fn] of map) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
    }

    // 鼠标悬停 / 键盘聚焦时预热 html-to-image，点击瞬间减少等待。仅触发一次。
    const imgBtn = document.getElementById('imgBtn');
    if (imgBtn) {
        const prefetch = () => {
            imgBtn.removeEventListener('pointerenter', prefetch);
            imgBtn.removeEventListener('focus', prefetch);
            try { getHtmlToImage(); } catch (_) {}
        };
        imgBtn.addEventListener('pointerenter', prefetch, { once: true });
        imgBtn.addEventListener('focus', prefetch, { once: true });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindActionButtons);
} else {
    bindActionButtons();
}

