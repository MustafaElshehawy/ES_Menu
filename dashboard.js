import { createId, escapeHtml } from './shared.js';

let platform = null;
let currentUser = null;
let currentPage = 'overview';
let editingId = null;
let editorKind = 'product';
let toastTimer;
let saveQueue = Promise.resolve();
let appearanceSaveTimer;
let authMode = 'login';
const $ = selector => document.querySelector(selector);
const currentStore = () => platform.stores.find(store => store.id === platform.activeStoreId) || platform.stores[0];
const bilingual = (ar, en = '') => ({ ar: ar.trim(), en: en.trim() || ar.trim() });
const text = value => escapeHtml(value || '');
const currencyLabel = code => ({ SAR: 'ر.س', EGP: 'ج.م', AED: 'د.إ', USD: '$' }[code] || code);

async function api(path, options = {}) {
    const response = await fetch(path, {
        credentials: 'same-origin',
        ...options,
        headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
    });
    if (response.status === 204) return null;
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(result.error || 'تعذر الاتصال بالخادم.');
        error.status = response.status;
        throw error;
    }
    return result;
}

function persist(message) {
    refresh();
    $('#sync-label').textContent = 'جارٍ حفظ التغييرات...';
    $('#sync-dot').classList.add('syncing');
    $('#sync-dot').classList.remove('sync-error');
    $('#sync-dot').style.background = '#d5a044';
    const activeStoreId = platform.activeStoreId;
    saveQueue = saveQueue.then(async () => {
        const saved = await api('/api/platform', { method: 'PUT', body: JSON.stringify({ stores: platform.stores, activeStoreId }) });
        if (!saved.stores.some(store => store.id === activeStoreId)) throw new Error('تعذر تأكيد المتجر المحفوظ.');
        refresh();
        $('#sync-label').textContent = 'تم الحفظ في قاعدة البيانات';
        $('#sync-dot').classList.remove('syncing');
        $('#sync-dot').style.background = '#86c69c';
        if (message) notify(message);
    }).catch(error => {
        $('#sync-label').textContent = error.message;
        $('#sync-dot').classList.remove('syncing');
        $('#sync-dot').classList.add('sync-error');
        $('#sync-dot').style.background = '#d56d5f';
        notify(error.message);
    });
    return saveQueue;
}

function notify(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2300);
}

function storeUrl(store = currentStore()) {
    const url = new URL('./index.html', window.location.href);
    url.searchParams.set('store', store.slug);
    return url.href;
}

function renderStorePicker() {
    const options = platform.stores.map(store =>
        `<option value="${text(store.id)}" ${store.id === platform.activeStoreId ? 'selected' : ''}>${text(store.profile.name.ar || store.profile.name.en)}</option>`
    ).join('');
    $('#store-select').innerHTML = options;
    $('#mobile-store-select').innerHTML = options;
    $('#preview-link').href = storeUrl();
}

function renderOverview() {
    const store = currentStore();
    const available = store.menu.filter(item => item.available).length;
    $('#welcome-name').textContent = store.profile.name.ar || store.profile.name.en;
    $('#stat-products').textContent = store.menu.length;
    $('#stat-categories').textContent = store.categories.length;
    $('#stat-available').textContent = available;
    $('#store-url').textContent = storeUrl();
    const recent = [...store.menu].slice(-4).reverse();
    $('#recent-products').innerHTML = recent.length ? recent.map(item => `
        <div class="recent-item">
            <img class="recent-thumb" src="${text(item.image)}" alt="" data-hide-on-error>
            <div><strong>${text(item.name.ar || item.name.en)}</strong><small>${text(item.name.en)}</small></div>
            <span class="recent-price">${Number(item.price || 0).toFixed(2)} ${currencyLabel(store.currency)}</span>
        </div>`).join('') : '<p class="form-help">أضف أول منتج عشان يظهر هنا.</p>';
    bindImageFallbacks($('#recent-products'));
}

function categoryName(id) {
    const category = currentStore().categories.find(item => item.id === id);
    return category ? `${category.icon} ${category.name.ar || category.name.en}` : 'بدون قسم';
}

function renderProducts() {
    const store = currentStore();
    const filter = $('#product-filter').value;
    const query = $('#product-search').value.trim().toLowerCase();
    const matches = store.menu.filter(item => {
        const name = `${item.name.ar || ''} ${item.name.en || ''}`.toLowerCase();
        return (filter === 'all' || item.categoryId === filter) && name.includes(query);
    });
    $('#product-filter').innerHTML = `<option value="all">كل الأقسام</option>${store.categories.map(category => `<option value="${text(category.id)}">${text(category.name.ar || category.name.en)}</option>`).join('')}`;
    $('#product-filter').value = filter === 'all' || store.categories.some(category => category.id === filter) ? filter : 'all';
    $('#product-count').textContent = `${matches.length} منتج`;
    $('#product-rows').innerHTML = matches.map(item => `
        <tr>
            <td><div class="product-cell"><img class="product-thumb" src="${text(item.image)}" alt="" data-hide-on-error><div><strong>${text(item.name.ar || item.name.en)}</strong><small>${text(item.name.en)}</small></div></div></td>
            <td>${text(categoryName(item.categoryId))}</td><td>${Number(item.price || 0).toFixed(2)} ${currencyLabel(store.currency)}</td>
            <td><span class="status-pill ${item.available ? '' : 'off'}">${item.available ? '● متاح' : '○ مخفي'}</span></td>
            <td><div class="table-actions"><button data-edit-product="${text(item.id)}">تعديل</button><button data-toggle-product="${text(item.id)}">${item.available ? 'إخفاء' : 'إظهار'}</button><button class="delete" data-delete-product="${text(item.id)}">حذف</button></div></td>
        </tr>`).join('');
    $('#empty-products').classList.toggle('hidden', matches.length > 0);
    $('.table-panel table').classList.toggle('hidden', matches.length === 0);
    bindImageFallbacks($('#product-rows'));
}

function bindImageFallbacks(root) {
    root.querySelectorAll('img[data-hide-on-error]').forEach(image => {
        image.addEventListener('error', () => { image.style.visibility = 'hidden'; }, { once: true });
    });
}

function renderCategories() {
    const store = currentStore();
    $('#category-grid').innerHTML = store.categories.length ? store.categories.map(category => {
        const count = store.menu.filter(item => item.categoryId === category.id).length;
        return `<article class="category-card"><span class="category-emoji">${text(category.icon || '🍽️')}</span><div><strong>${text(category.name.ar || category.name.en)}</strong><small>${count} منتج</small></div><div class="category-actions"><button title="تعديل القسم" aria-label="تعديل القسم" data-edit-category="${text(category.id)}"><i data-lucide="pencil"></i></button><button title="حذف القسم" aria-label="حذف القسم" data-delete-category="${text(category.id)}"><i data-lucide="trash-2"></i></button></div></article>`;
    }).join('') : '<div class="panel empty-state">مفيش أقسام لسه. أنشئ أول قسم للمنيو.</div>';
}

function updateColorCode(input) {
    const code = input.closest('.color-input')?.querySelector('code');
    if (code) code.textContent = input.value.toUpperCase();
}

function renderAppearance() {
    const store = currentStore();
    const form = $('#appearance-form');
    form.elements.siteName.value = store.profile.siteName || store.profile.name.ar || '';
    form.elements.nameAr.value = store.profile.name.ar || '';
    form.elements.nameEn.value = store.profile.name.en || '';
    form.elements.addressAr.value = store.profile.address.ar || '';
    form.elements.currency.value = store.currency || 'SAR';
    form.elements.primary.value = store.theme.primary || '#2563eb';
    form.elements.background.value = store.theme.background || '#f8fafc';
    form.querySelectorAll('input[type="color"]').forEach(updateColorCode);
    const preview = $('#logo-preview');
    preview.src = store.profile.logo || '';
    preview.closest('.logo-preview').classList.toggle('has-image', Boolean(store.profile.logo));
    renderMiniPreview(store);
}

function renderMiniPreview(store = currentStore()) {
    $('#mini-menu').style.background = store.theme.background || '#f8fafc';
    $('#mini-menu').innerHTML = `
        <div class="mini-brand">${store.profile.logo ? `<img src="${text(store.profile.logo)}" alt="">` : '<span class="mini-logo-fallback"></span>'}<div><strong>${text(store.profile.name.ar || store.profile.name.en)}</strong><small>${text(store.profile.address.ar)}</small></div></div>
        <div class="mini-categories">${store.categories.slice(0, 3).map(category => `<span style="background:${text(store.theme.primary)}">${text(category.icon)} ${text(category.name.ar || category.name.en)}</span>`).join('')}</div>
        <div class="mini-food"><span></span><div><strong>${text(store.menu[0]?.name.ar || store.menu[0]?.name.en || 'اسم المنتج')}</strong><small>${Number(store.menu[0]?.price || 0).toFixed(2)} ${currencyLabel(store.currency)}</small></div></div>`;
}

const pageInfo = {
    overview: ['مساحة العمل', 'نظرة عامة'], products: ['كتالوج المتجر', 'المنتجات'],
    categories: ['تنظيم المنيو', 'الأقسام'], appearance: ['شكل متجرك', 'هوية المنيو']
};

function goTo(page) {
    currentPage = page;
    document.querySelectorAll('.page-content').forEach(section => section.classList.toggle('hidden', section.id !== `page-${page}`));
    document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.page === page));
    $('#page-eyebrow').textContent = pageInfo[page][0];
    $('#page-title').textContent = pageInfo[page][1];
    if (page === 'products') renderProducts();
    if (page === 'categories') renderCategories();
    if (page === 'appearance') renderAppearance();
    if (window.lucide) window.lucide.createIcons();
}

function refresh() {
    if (!platform?.stores?.length) return;
    renderStorePicker();
    renderOverview();
    if (currentPage === 'products') renderProducts();
    if (currentPage === 'categories') renderCategories();
    if (currentPage === 'appearance') renderAppearance();
    if (window.lucide) window.lucide.createIcons();
}

function openEditor(kind, id = null) {
    editorKind = kind;
    editingId = id;
    const store = currentStore();
    const item = id ? (kind === 'product' ? store.menu : store.categories).find(entry => entry.id === id) : null;
    const dialog = $('#editor-dialog');
    $('#dialog-title').textContent = kind === 'product' ? (item ? 'تعديل المنتج' : 'منتج جديد') : (item ? 'تعديل القسم' : 'قسم جديد');
    $('#dialog-eyebrow').textContent = kind === 'product' ? 'تفاصيل المنتج' : 'تنظيم المنيو';
    $('#dialog-fields').innerHTML = kind === 'product' ? productFields(item, store) : categoryFields(item);
    dialog.showModal();
}

function field(label, name, value = '', options = {}) {
    const type = options.type || 'text';
    const wide = options.full ? ' full' : '';
    const required = options.required ? 'required' : '';
    if (options.select) {
        return `<label class="${wide}">${label}<select name="${name}" ${required}>${options.select}</select></label>`;
    }
    if (options.textarea) return `<label class="${wide}">${label}<textarea name="${name}" ${required} maxlength="${options.maxlength || 500}">${text(value)}</textarea></label>`;
    return `<label class="${wide}">${label}<input type="${type}" name="${name}" value="${text(value)}" ${required} ${options.min !== undefined ? `min="${options.min}"` : ''} ${options.step ? `step="${options.step}"` : ''} ${options.maxlength ? `maxlength="${options.maxlength}"` : ''}></label>`;
}

function productFields(item, store) {
    const categoryOptions = `<option value="">بدون قسم</option>${store.categories.map(category => `<option value="${text(category.id)}" ${item?.categoryId === category.id ? 'selected' : ''}>${text(category.name.ar || category.name.en)}</option>`).join('')}`;
    return `${field('اسم المنتج بالعربي', 'nameAr', item?.name.ar, { required: true, maxlength: 70 })}
        ${field('اسم المنتج بالإنجليزي', 'nameEn', item?.name.en, { maxlength: 70 })}
        ${field('السعر', 'price', item?.price ?? '', { type: 'number', required: true, min: 0, step: '0.01' })}
        ${field('القسم', 'categoryId', item?.categoryId, { select: categoryOptions })}
        ${field('رابط صورة المنتج', 'image', item?.image, { full: true })}
        ${field('الوصف بالعربي', 'descriptionAr', item?.description.ar, { textarea: true, full: true })}
        ${field('الوصف بالإنجليزي', 'descriptionEn', item?.description.en, { textarea: true, full: true })}
        ${field('المكونات بالعربي', 'ingredientsAr', item?.ingredients.ar, { full: true })}
        ${field('السعرات الحرارية', 'calories', item?.calories ?? 0, { type: 'number', min: 0 })}
        <label class="checkbox-row"><input type="checkbox" name="available" ${item?.available !== false ? 'checked' : ''}> المنتج متاح للطلب</label>`;
}

function categoryFields(item) {
    return `${field('اسم القسم بالعربي', 'nameAr', item?.name.ar, { required: true, maxlength: 45 })}
        ${field('اسم القسم بالإنجليزي', 'nameEn', item?.name.en, { maxlength: 45 })}
        ${field('الأيقونة (إيموجي)', 'icon', item?.icon || '🍽️', { required: true, maxlength: 8 })}`;
}

function saveEditor(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form).entries());
    const store = currentStore();
    if (editorKind === 'product') {
        const next = {
            id: editingId || createId('product'), name: bilingual(data.nameAr, data.nameEn),
            description: bilingual(data.descriptionAr || '', data.descriptionEn || ''),
            ingredients: bilingual(data.ingredientsAr || ''), price: Number(data.price), calories: Number(data.calories || 0),
            categoryId: data.categoryId || null, image: data.image || '', available: form.elements.available.checked
        };
        if (editingId) store.menu = store.menu.map(item => item.id === editingId ? next : item);
        else store.menu.unshift(next);
    } else {
        const next = { id: editingId || createId('category'), name: bilingual(data.nameAr, data.nameEn), icon: data.icon.trim() };
        if (editingId) store.categories = store.categories.map(item => item.id === editingId ? next : item);
        else store.categories.push(next);
    }
    $('#editor-dialog').close();
    persist(editorKind === 'product' ? 'تم حفظ المنتج' : 'تم حفظ القسم');
}

function createStore() {
    $('#store-form').reset();
    $('#store-dialog').showModal();
}

function saveNewStore(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form).entries());
    const arabicName = data.storeNameAr.trim();
    const englishName = data.storeNameEn.trim() || arabicName;
    const store = JSON.parse(JSON.stringify(platform.stores[0]));
    store.id = createId('store');
    const slugBase = englishName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'menu';
    store.slug = `${slugBase}-${Date.now().toString(36)}`;
    store.profile.siteName = englishName;
    store.profile.name = { ar: arabicName, en: englishName };
    store.profile.address = { ar: '', en: '' };
    store.profile.logo = '';
    store.categories = [];
    store.menu = [];
    store.currency = data.storeCurrency;
    platform.stores.push(store);
    platform.activeStoreId = store.id;
    currentPage = 'overview';
    $('#store-dialog').close();
    goTo('overview');
    persist('تم إنشاء مساحة المتجر');
}

function exportStore() {
    const store = currentStore();
    const blob = new Blob([JSON.stringify({ version: 1, store }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${store.slug || 'menu'}-backup.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    notify('تم تنزيل نسخة المتجر');
}

function importStore(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const parsed = JSON.parse(reader.result);
            const imported = parsed.store || parsed;
            if (!imported.profile?.name || !Array.isArray(imported.categories) || !Array.isArray(imported.menu)) throw new Error('invalid');
            imported.id = currentStore().id;
            imported.slug = currentStore().slug;
            imported.theme = imported.theme || { primary: '#245b49', background: '#f6f7f3' };
            imported.currency = imported.currency || 'EGP';
            const categoryIds = new Map(imported.categories.map(category => [category.id, createId('category')]));
            imported.categories = imported.categories.map(category => ({ ...category, id: categoryIds.get(category.id) }));
            imported.menu = imported.menu.map(item => ({
                ...item,
                id: createId('product'),
                categoryId: categoryIds.get(item.categoryId) || null
            }));
            const index = platform.stores.findIndex(store => store.id === platform.activeStoreId);
            platform.stores[index] = imported;
            persist('تم استيراد بيانات المتجر');
        } catch {
            notify('ملف النسخة غير صالح');
        }
        $('#import-data').value = '';
    };
    reader.readAsText(file);
}

function saveAppearance() {
    const form = $('#appearance-form');
    if (!form.reportValidity()) return;
    const store = currentStore();
    store.profile.siteName = form.elements.siteName.value.trim();
    store.profile.name = bilingual(form.elements.nameAr.value, form.elements.nameEn.value);
    store.profile.address = bilingual(form.elements.addressAr.value, store.profile.address.en || '');
    store.currency = form.elements.currency.value;
    store.theme.primary = form.elements.primary.value;
    store.theme.background = form.elements.background.value;
    persist('تم حفظ هوية المنيو');
}

function compressLogo(file) {
    if (!file.type.startsWith('image/')) return Promise.reject(new Error('اختار ملف صورة صالح.'));
    return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
            const scale = Math.min(1, 768 / Math.max(image.naturalWidth, image.naturalHeight));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(objectUrl);
            canvas.toBlob(blob => {
                if (!blob || blob.size > 1024 * 1024) return reject(new Error('حجم الشعار بعد الضغط أكبر من 1 ميجابايت.'));
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('تعذر قراءة الشعار.'));
                reader.readAsDataURL(blob);
            }, 'image/webp', 0.84);
        };
        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('تعذر فتح ملف الصورة.'));
        };
        image.src = objectUrl;
    });
}

function attachEvents() {
    document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => goTo(button.dataset.page)));
    document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => goTo(button.dataset.go)));
    $('#store-select').addEventListener('change', event => {
        platform.activeStoreId = event.target.value;
        persist('تم تغيير المتجر');
    });
    $('#mobile-store-select').addEventListener('change', event => {
        platform.activeStoreId = event.target.value;
        persist('تم تغيير المتجر');
    });
    $('#add-store').addEventListener('click', createStore);
    $('#mobile-add-store').addEventListener('click', createStore);
    $('#new-product').addEventListener('click', () => openEditor('product'));
    $('#new-category').addEventListener('click', () => openEditor('category'));
    $('#editor-form').addEventListener('submit', saveEditor);
    document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $('#editor-dialog').close()));
    $('#store-form').addEventListener('submit', saveNewStore);
    document.querySelectorAll('[data-close-store]').forEach(button => button.addEventListener('click', () => $('#store-dialog').close()));
    $('#product-search').addEventListener('input', renderProducts);
    $('#product-filter').addEventListener('change', renderProducts);
    $('#product-rows').addEventListener('click', event => {
        const target = event.target.closest('button');
        if (!target) return;
        const store = currentStore();
        if (target.dataset.editProduct) openEditor('product', target.dataset.editProduct);
        if (target.dataset.toggleProduct) {
            const item = store.menu.find(product => product.id === target.dataset.toggleProduct);
            item.available = !item.available;
            persist(item.available ? 'المنتج ظاهر في المنيو' : 'تم إخفاء المنتج');
        }
        if (target.dataset.deleteProduct && confirm('تحذف المنتج ده من المنيو؟')) {
            store.menu = store.menu.filter(product => product.id !== target.dataset.deleteProduct);
            persist('تم حذف المنتج');
        }
    });
    $('#category-grid').addEventListener('click', event => {
        const target = event.target.closest('button');
        if (!target) return;
        const store = currentStore();
        if (target.dataset.editCategory) openEditor('category', target.dataset.editCategory);
        if (target.dataset.deleteCategory && confirm('تحذف القسم؟ المنتجات هتفضل موجودة بدون قسم.')) {
            store.categories = store.categories.filter(category => category.id !== target.dataset.deleteCategory);
            store.menu.forEach(item => { if (item.categoryId === target.dataset.deleteCategory) item.categoryId = null; });
            persist('تم حذف القسم');
        }
    });
    $('#appearance-form').addEventListener('input', event => {
        const form = event.currentTarget;
        const store = currentStore();
        store.profile.siteName = form.elements.siteName.value;
        store.profile.name.ar = form.elements.nameAr.value;
        store.profile.name.en = form.elements.nameEn.value || form.elements.nameAr.value;
        store.profile.address.ar = form.elements.addressAr.value;
        store.currency = form.elements.currency.value;
        store.theme.primary = form.elements.primary.value;
        store.theme.background = form.elements.background.value;
        updateColorCode(event.target);
        clearTimeout(appearanceSaveTimer);
        appearanceSaveTimer = setTimeout(() => persist(), 650);
        renderMiniPreview(store);
        renderOverview();
    });
    $('#appearance-form').addEventListener('change', async event => {
        if (event.target.name === 'logoFile' && event.target.files[0]) {
            const file = event.target.files[0];
            try {
                currentStore().profile.logo = await compressLogo(file);
                persist('تم تحديث الشعار');
            } catch (error) {
                notify(error.message);
            } finally {
                event.target.value = '';
            }
        }
    });
    $('#save-appearance').addEventListener('click', saveAppearance);
    $('#remove-logo').addEventListener('click', () => {
        currentStore().profile.logo = '';
        persist('تمت إزالة الشعار');
    });
    $('#copy-link').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(storeUrl()); notify('تم نسخ رابط المنيو'); }
        catch { notify('افتح المنيو من زر المعاينة'); }
    });
    $('#export-data').addEventListener('click', exportStore);
    $('#import-data').addEventListener('change', event => importStore(event.target.files[0]));
    $('#auth-switch').addEventListener('click', () => setAuthMode(authMode === 'login' ? 'register' : 'login'));
    $('#auth-form').addEventListener('submit', authenticate);
    $('#logout-button').addEventListener('click', logout);
}

function setAuthMode(mode) {
    authMode = mode;
    const registering = mode === 'register';
    $('#auth-title').textContent = registering ? 'إنشاء حساب جديد' : 'تسجيل الدخول';
    $('#auth-caption').textContent = registering ? 'أنشئ مساحة خاصة لنشاطك وابدأ تجهيز المنيو.' : 'ادخل لحسابك لإدارة متجرك ومنيوك.';
    $('#auth-submit').textContent = registering ? 'إنشاء الحساب' : 'دخول';
    $('#auth-switch-label').textContent = registering ? 'عندك حساب بالفعل؟' : 'لسه معندكش حساب؟';
    $('#auth-switch').textContent = registering ? 'تسجيل الدخول' : 'إنشاء حساب';
    document.querySelectorAll('.register-field').forEach(field => field.classList.toggle('hidden', !registering));
    $('#auth-form').elements.name.required = registering;
    $('#auth-form').elements.storeName.required = registering;
    $('#auth-form').elements.password.autocomplete = registering ? 'new-password' : 'current-password';
    $('#auth-error').classList.add('hidden');
}

function showAuth(errorMessage = '') {
    platform = null;
    currentUser = null;
    $('.dashboard-shell').classList.add('hidden');
    $('#auth-screen').classList.remove('hidden');
    $('#auth-error').textContent = errorMessage;
    $('#auth-error').classList.toggle('hidden', !errorMessage);
}

function showDashboard(data) {
    currentUser = data.user;
    platform = data.platform;
    platform.stores = platform.stores.map(store => ({ ...store, categories: store.categories || [], menu: store.menu || [], theme: store.theme || {} }));
    if (!platform.stores.length) throw new Error('الحساب لا يحتوي على متجر. تواصل مع الدعم.');
    platform.activeStoreId = platform.stores.some(store => store.id === platform.activeStoreId) ? platform.activeStoreId : platform.stores[0].id;
    $('.dashboard-shell').classList.remove('hidden');
    $('#auth-screen').classList.add('hidden');
    $('#user-avatar').textContent = currentUser.name.slice(0, 1);
    $('#user-avatar').title = currentUser.email;
    refresh();
    goTo(currentPage);
}

async function authenticate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = $('#auth-submit');
    submit.disabled = true;
    $('#auth-error').classList.add('hidden');
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
        const data = await api(`/api/auth/${authMode === 'register' ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify(payload) });
        showDashboard(data);
    } catch (error) {
        $('#auth-error').textContent = error.message;
        $('#auth-error').classList.remove('hidden');
    } finally {
        submit.disabled = false;
    }
}

async function logout() {
    clearTimeout(appearanceSaveTimer);
    await api('/api/auth/logout', { method: 'POST' }).catch(() => { });
    $('#auth-form').reset();
    setAuthMode('login');
    showAuth();
}

async function initialize() {
    try {
        showDashboard(await api('/api/auth/me'));
    } catch (error) {
        showAuth(error.status === 401 ? '' : error.message);
    }
}

attachEvents();
initialize();
