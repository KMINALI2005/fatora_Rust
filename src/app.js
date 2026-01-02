// =========================================================================
// ============== الإعدادات وقاعدة البيانات (محسنة للأداء) =================
// =========================================================================

// إزالة شاشة التحميل عند اكتمال DOM
document.addEventListener('DOMContentLoaded', function() {
    document.body.classList.remove('loading');
});

// تعريف متغيرات Tauri للتعامل مع الملفات
const fs = window.__TAURI__?.fs;
const BaseDirectory = window.__TAURI__?.fs?.BaseDirectory; 

// أسماء ملفات قاعدة البيانات
const INVOICES_FILE = 'invoices_db.json';
const PRODUCTS_FILE = 'products_db.json';

// استبدال حدث Cordova بحدث الويب القياسي
document.addEventListener('DOMContentLoaded', initializeApp);

// --- إعدادات الأداء (الحل الجذري للتعليق) ---
// سنعرض فقط 50 عنصراً في القوائم لتخفيف الحمل على الشاشة، 
// بينما البحث يتم في الذاكرة على كل العناصر (الآلاف).
var MAX_ITEMS_DISPLAY = 50; 

// --- معالج أخطاء عام ---
(function() {
    if (typeof window.Promise === 'undefined') {
        try {
            setTimeout(function() {
                var spinner = document.getElementById('loadingSpinner');
                if (spinner) {
                    spinner.innerHTML = '<p style="color: red; font-weight: bold; text-align: right;">المتصفح قديم جداً!</p>';
                }
            }, 500);
        } catch(e) {}
    }

    window.addEventListener('error', function(event) {
        console.error('Global Error:', event.error);
        var spinner = document.getElementById('loadingSpinner');
        if (spinner) {
            spinner.style.display = 'none'; 
        }
    });
})();

// المتغيرات العامة
var currentInvoice = { items: [], total: 0, payment: 0, previousBalance: 0 };
var currentEditingInvoiceId = null; 
var isEditingItem = false; 
var editingItemIndex = null;

// --- نظام الكاش (الذاكرة المؤقتة) للسرعة الفائقة ---
// بدلاً من طلب البيانات من القرص في كل مرة، نحملها هنا مرة واحدة
var allProductsCache = []; 
var allInvoicesCache = []; 

var listenersInitialized = false;
var currentFilter = 'all';
var currentReportData = {};
var currentRepayCustomer = null; 

if (typeof cordova === 'undefined') { document.addEventListener('DOMContentLoaded', initializeApp); }

// =========================================================================
// ============== الدوال المساعدة والتهيئة =================================
// =========================================================================

function setTodayDate() {
    try {
        var dateInput = document.getElementById('invoiceDate');
        if (!dateInput) return;

        var today = new Date();
        var year = today.getFullYear();
        var month = (today.getMonth() + 1).toString().padStart(2, '0');
        var day = today.getDate().toString().padStart(2, '0');
        
        var formattedDate = year + '-' + month + '-' + day;
        dateInput.value = formattedDate;
    } catch (error) {
        console.error('Error setting date:', error);
    }
}

function toEnglishNumbers(str) { 
    if (str === null || str === undefined) return ''; 
    var arabicNumbers = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']; 
    var englishNumbers = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']; 
    var result = String(str); 
    for (var i = 0; i < 10; i++) { 
        result = result.replace(new RegExp(arabicNumbers[i], 'g'), englishNumbers[i]); 
    } 
    return result; 
}

function formatCurrency(num) { 
    var formatted = (num || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }); 
    return toEnglishNumbers(formatted); 
}

// دالة جديدة ومهمة جداً: تحديث الكاش في الذاكرة
// هذه الدالة تجلب كل البيانات وتضعها في RAM لتكون جاهزة للبحث الفوري
async function refreshGlobalCache() {
    try {
        // التأكد من أننا داخل بيئة Tauri
        if (!window.__TAURI__) return false;

        // 1. قراءة ملف الفواتير
        const invoicesExists = await fs.exists(INVOICES_FILE, { baseDir: BaseDirectory.AppData });
        if (invoicesExists) {
            const content = await fs.readTextFile(INVOICES_FILE, { baseDir: BaseDirectory.AppData });
            allInvoicesCache = JSON.parse(content);
        } else {
            allInvoicesCache = []; // ملف جديد
        }

        // 2. قراءة ملف المنتجات
        const productsExists = await fs.exists(PRODUCTS_FILE, { baseDir: BaseDirectory.AppData });
        if (productsExists) {
            const content = await fs.readTextFile(PRODUCTS_FILE, { baseDir: BaseDirectory.AppData });
            allProductsCache = JSON.parse(content);
        } else {
            allProductsCache = [];
        }
        
        // تحديث العدادات
        document.getElementById('invoicesCounter').textContent = formatCurrency(allInvoicesCache.length); 
        document.getElementById('productsCounter').textContent = formatCurrency(allProductsCache.length);
        
        return true;
    } catch (e) {
        console.error("خطأ في قراءة الملفات:", e);
        // في حال الخطأ ننشئ مصفوفات فارغة لتجنب توقف التطبيق
        allInvoicesCache = [];
        allProductsCache = [];
        return false;
    }
}

// --- دوال مساعدة جديدة لـ Tauri ---

// دالة الحفظ في الملف
async function saveDataToFile(filename, data) {
    try {
        const content = JSON.stringify(data, null, 2);
        await fs.writeTextFile(filename, content, { baseDir: BaseDirectory.AppData });
    } catch (error) {
        console.error(`خطأ في حفظ ${filename}:`, error);
        alert("فشل الحفظ التلقائي! تأكد من الصلاحيات.");
    }
}

// دالة توليد ID (بديل لـ Auto Increment)
function generateId(collection) {
    if (!collection || collection.length === 0) return 1;
    const maxId = collection.reduce((max, item) => (item.id > max ? item.id : max), 0);
    return maxId + 1;
}

async function initializeApp() {
    try {
        if (window.StatusBar) {
            StatusBar.backgroundColorByHexString("#0f766e");
        }
        
        // تحميل البيانات إلى الذاكرة أولاً
        await refreshGlobalCache();
        
        // عرض البيانات الأولية (بحد أقصى 50 لتسريع الإقلاع)
        renderInvoicesList(allInvoicesCache.slice(0, MAX_ITEMS_DISPLAY));
        renderProductsList(allProductsCache.slice(0, MAX_ITEMS_DISPLAY));
        
        setupEventListeners(); 
        setTodayDate();
        setReportDateRange('month');
        
        console.log('App Initialized Optimized');

        var spinner = document.getElementById('loadingSpinner');
        if (spinner) {
            spinner.style.display = 'none';
        }

        setTimeout(function() {
            showSuccess('تم تحميل التطبيق بنجاح (وضع الأداء العالي)');
        }, 500);

    } catch (error) {
        console.error('Fatal Error:', error);
        var spinner = document.getElementById('loadingSpinner');
        if (spinner) spinner.style.display = 'none';
        alert("حدث خطأ أثناء تحميل التطبيق. يرجى إعادة التشغيل.");
    }
}

function setupEventListeners() {
    if (listenersInitialized) return; 
    
    document.getElementById('saveBtn').addEventListener('click', saveOrUpdateInvoice); 
    document.getElementById('addItemBtn').addEventListener('click', handleAddOrUpdateClick); 
    
    // تحسين البحث: استخدام input بدلاً من البحث في DB
    document.getElementById('productName').addEventListener('input', handleProductSearch); 
    document.getElementById('productName').addEventListener('blur', function() { setTimeout(function() { document.getElementById('product-suggestions').style.display = 'none'; }, 200); }); 
    
    document.getElementById('customerName').addEventListener('input', handleCustomerSearch); 
    document.getElementById('customerName').addEventListener('blur', function() { setTimeout(function() { document.getElementById('customer-invoices-suggestions').style.display = 'none'; }, 200); }); 
    
    document.getElementById('viewCustomerInvoicesBtn').addEventListener('click', function() { 
        var customerName = document.getElementById('customerName').value; 
        switchTab('saved', document.querySelector('.tabs .tab:nth-child(2)')); 
        document.getElementById('invoiceSearchInput').value = customerName; 
        handleInvoiceSearch(); 
    }); 
    
    ['quantity', 'price'].forEach(function(id) { document.getElementById(id).addEventListener('input', updateLineTotal); }); 
    ['previousBalance', 'paymentAmount'].forEach(function(id) { document.getElementById(id).addEventListener('input', updateFinalTotals); }); 
    
    var handleEnterKey = function(currentId, nextId, actionFn) {
        document.getElementById(currentId).addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.keyCode === 13) {
                e.preventDefault(); 
                if (nextId) document.getElementById(nextId).focus(); 
                else if (actionFn) actionFn();
            }
        });
    }; 
    
    handleEnterKey('productName', 'quantity'); 
    handleEnterKey('quantity', 'price'); 
    handleEnterKey('price', 'itemNotes'); 
    handleEnterKey('itemNotes', null, handleAddOrUpdateClick); 
    handleEnterKey('newProductName', 'newProductPrice'); 
    handleEnterKey('newProductPrice', null, saveProduct); 
    
    document.getElementById('import-invoices-file').addEventListener('change', handleInvoiceImport); 
    document.getElementById('import-products-file').addEventListener('change', handleProductImport); 
    
    // ربط البحث بالقوائم المحسنة
    document.getElementById('invoiceSearchInput').addEventListener('input', handleInvoiceSearch); 
    document.getElementById('productSearchInput').addEventListener('input', handleProductListSearch); 
    document.getElementById('auditingSearchInput').addEventListener('input', displayAccountAudits); 
    
    listenersInitialized = true;
}

var originalSwitchTab = function(tabId, element) {
    document.querySelectorAll('.tab-content').forEach(function(c) { c.classList.remove('active'); }); 
    document.getElementById(tabId + '-tab').classList.add('active'); 
    document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); }); 
    element.classList.add('active');
}

// =========================================================================
// ============== نظام الإشعارات ===========================================
// =========================================================================
var ToastManager = {
    container: null,
    toasts: [],
    
    init: function() {
        this.container = document.getElementById('toastContainer');
    },
    
    show: function(message, type, duration, title) {
        if (!this.container) this.init();
        
        var toastId = 'toast_' + Date.now();
        var icon = type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️';
        var titleText = title || (type === 'success' ? 'نجح' : type === 'error' ? 'خطأ' : 'تنبيه');
        
        var toast = document.createElement('div');
        toast.className = 'toast ' + type;
        toast.id = toastId;
        
        toast.innerHTML = 
            '<div class="toast-icon">' + icon + '</div>' +
            '<div class="toast-content">' +
                '<div class="toast-title">' + titleText + '</div>' +
                '<div class="toast-message">' + message + '</div>' +
            '</div>' +
            '<button class="toast-close" onclick="ToastManager.hide(\'' + toastId + '\')">×</button>' +
            '<div class="toast-progress"><div class="toast-progress-bar"></div></div>';
        
        this.container.appendChild(toast);
        this.toasts.push({id: toastId, element: toast});
        
        setTimeout(function() {
            var toastElement = document.getElementById(toastId);
            if (toastElement) {
                toastElement.classList.add('show');
            }
        }, 50);
        
        var toastDuration = duration || 4000;
        var progressBar = toast.querySelector('.toast-progress-bar');
        if (progressBar) {
            progressBar.style.animation = 'toastProgress ' + (toastDuration / 1000) + 's linear forwards';
        }
        
        setTimeout(function() {
            ToastManager.hide(toastId);
        }, toastDuration);
        
        return toastId;
    },
    
    hide: function(toastId) {
        var toast = document.getElementById(toastId);
        if (toast) {
            toast.classList.remove('show');
            setTimeout(function() {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 400);
        }
        this.toasts = this.toasts.filter(function(t) { return t.id !== toastId; });
    }
};

function showToast(message, type) { return ToastManager.show(message, type); }
function showSuccess(message) { return ToastManager.show(message, 'success', 3000, 'نجح'); }
function showError(message) { return ToastManager.show(message, 'error', 4000, 'خطأ'); }
function showWarning(message) { return ToastManager.show(message, 'warning', 3000, 'تحذير'); }
function showInfo(message) { return ToastManager.show(message, 'info', 3000, 'معلومة'); }

function getCurrentDate() {
    var today = new Date();
    var year = today.getFullYear();
    var month = (today.getMonth() + 1).toString().padStart(2, '0');
    var day = today.getDate().toString().padStart(2, '0');
    return year + '-' + month + '-' + day;
}

function getCurrentDateTime() {
    var now = new Date();
    var date = now.toISOString().split('T')[0];
    var time = now.toLocaleTimeString('ar-EG', { 
        hour: 'numeric', 
        minute: '2-digit', 
        hour12: true 
    });
    return { date: date, time: time };
}

var switchTab = async function(tabId, element) {
    originalSwitchTab(tabId, element);
    if (tabId === 'reports' && !document.getElementById('reportStartDate').value) { 
        setReportDateRange('month'); 
    }
    else if (tabId === 'auditing') {
        // نمرر true هنا ليظهر الإشعار مرة واحدة عند الفتح
        displayAccountAudits(true);
    }
};

function formatTime(date) { return date.toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit', hour12: true }); }
async function updateCounters() {
    // نستخدم الكاش للسرعة
    document.getElementById('invoicesCounter').textContent = formatCurrency(allInvoicesCache.length); 
    document.getElementById('productsCounter').textContent = formatCurrency(allProductsCache.length);
}

// =========================================================================
// ============== منطق قسم المنتجات (محسن بالكاش) ==========================
// =========================================================================
function handleProductSearch(e) {
    var suggestionsContainer = document.getElementById('product-suggestions'); 
    var query = e.target.value.toLowerCase().trim(); 
    suggestionsContainer.innerHTML = ''; 
    
    if (query.length === 0) { 
        suggestionsContainer.style.display = 'none'; 
        return; 
    } 
    
    // البحث في الذاكرة RAM (سريع جداً حتى مع الآلاف)
    var filteredProducts = allProductsCache.filter(function(p) { 
        return p.name.toLowerCase().includes(query); 
    }).slice(0, 10); // عرض أول 10 نتائج فقط للمقترحات
    
    if (filteredProducts.length > 0) {
        filteredProducts.forEach(function(product) {
            var item = document.createElement('div'); 
            item.className = 'suggestion-item'; 
            item.innerHTML = product.name + ' - <strong style="color:var(--success-color);">' + formatCurrency(product.price) + '</strong>'; 
            item.onclick = function() { selectProduct(product); }; 
            suggestionsContainer.appendChild(item);
        }); 
        suggestionsContainer.style.display = 'block';
    } else { 
        suggestionsContainer.style.display = 'none'; 
    }
}

function selectProduct(product) {
    document.getElementById('productName').value = product.name; 
    document.getElementById('price').value = product.price; 
    document.getElementById('product-suggestions').style.display = 'none'; 
    document.getElementById('quantity').focus(); 
    updateLineTotal();
}

async function saveProduct() {
    var nameInput = document.getElementById('newProductName'); 
    var priceInput = document.getElementById('newProductPrice'); 
    var name = nameInput.value.trim(); 
    var price = parseFloat(priceInput.value) || 0; 
    
    if (!name || price <= 0) return alert('يرجى إدخال اسم وسعر صحيح للمنتج.'); 
    
    try {
        var existingProduct = allProductsCache.find(p => p.name.toLowerCase() === name.toLowerCase());
        
        if (existingProduct) {
            if (confirm('المنتج "' + name + '" موجود بالفعل. هل تريد تحديث سعره إلى ' + formatCurrency(price) + '؟')) {
                // تحديث السعر في الذاكرة
                existingProduct.price = price;
            } else {
                return;
            }
        } else {
            // إضافة منتج جديد
            allProductsCache.push({ 
                id: generateId(allProductsCache), 
                name: name, 
                price: price 
            });
            // إعادة الترتيب
            allProductsCache.sort((a,b) => a.name.localeCompare(b.name));
        } 
        
        // حفظ التغييرات في الملف
        await saveDataToFile(PRODUCTS_FILE, allProductsCache);
        
        // (ملاحظة: حذفنا refreshGlobalCache لأننا حدثنا الذاكرة يدوياً)
        renderProductsList(allProductsCache.slice(0, MAX_ITEMS_DISPLAY));
        
        nameInput.value = ''; 
        priceInput.value = ''; 
        nameInput.focus();
        showSuccess('تم حفظ المنتج بنجاح');
    } catch (error) {
        console.error("Error saving product:", error); 
        alert('حدث خطأ غير متوقع أثناء حفظ المنتج.');
    }
}

async function deleteProduct(id) { 
    if (confirm('هل أنت متأكد من حذف هذا المنتج؟')) { 
        // الحذف من المصفوفة
        allProductsCache = allProductsCache.filter(p => p.id !== id);
        // حفظ الملف الجديد
        await saveDataToFile(PRODUCTS_FILE, allProductsCache);
        
        // تحديث الواجهة
        var currentSearch = document.getElementById('productSearchInput').value;
        handleProductListSearch({target: {value: currentSearch}});
        updateCounters();
    } 
}

function handleProductListSearch(e) {
    var query = e.target.value.toLowerCase().trim();
    
    // الفلترة في الذاكرة
    var filteredProducts = allProductsCache.filter(function(p) {
        return p.name.toLowerCase().includes(query);
    });
    
    // عرض النتائج المحدودة
    renderProductsList(filteredProducts.slice(0, MAX_ITEMS_DISPLAY));
}

function renderProductsList(products) {
    var container = document.getElementById('productsListContainer'); 
    container.innerHTML = ''; 
    
    if (products.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:var(--text-light);">لا توجد منتجات تطابق البحث.</p>'; 
        return;
    } 
    
    // رسالة تنبيه إذا كانت النتائج مقطوعة
    var limitMsg = '';
    if (allProductsCache.length > products.length && document.getElementById('productSearchInput').value === '') {
        limitMsg = '<div style="text-align:center; padding:10px; color:#666; font-size:0.8rem; margin-bottom:10px;">يتم عرض أول ' + products.length + ' منتج. استخدم البحث للوصول للبقية.</div>';
    }

    var table = document.createElement('table'); 
    table.style.width = '100%'; 
    table.style.borderCollapse = 'collapse'; 
    table.innerHTML = '<thead><tr style="background:var(--primary-dark); color:white;"><th style="padding:12px;">المنتج</th><th>السعر</th><th>حذف</th></tr></thead><tbody>' + 
        products.map(function(p) { 
            return '<tr><td style="padding:10px; border-bottom:1px solid #eee;">' + p.name + '</td><td style="padding:10px; border-bottom:1px solid #eee; color:var(--success-color); font-weight:bold;">' + formatCurrency(p.price) + '</td><td style="padding:10px; border-bottom:1px solid #eee; text-align:center;"><button class="btn danger" style="padding:6px 12px;" onclick="deleteProduct(' + p.id + ')">🗑️</button></td></tr>'; 
        }).join('') + 
        '</tbody>'; 
    
    container.innerHTML = limitMsg;
    container.appendChild(table);
}

// =========================================================================
// ============== منطق الفواتير (محسن بالكاش) ==============================
// =========================================================================
function handleCustomerSearch(e) {
    var query = e.target.value.trim().toLowerCase();
    var suggestionsContainer = document.getElementById('customer-invoices-suggestions');
    var viewBtn = document.getElementById('viewCustomerInvoicesBtn');
    suggestionsContainer.innerHTML = '';
    
    if (query.length < 1) {
        suggestionsContainer.style.display = 'none';
        viewBtn.style.display = 'none';
        return;
    }

    // تجميع الزبائن من الكاش بدلاً من التكرار الطويل
    var uniqueCustomers = [...new Set(allInvoicesCache.map(inv => inv.customer))];
    var matchingCustomers = uniqueCustomers.filter(c => c.toLowerCase().includes(query)).slice(0, 10);

    if (matchingCustomers.length > 0) {
        matchingCustomers.forEach(function(customerName) {
            // حساب الدين من الكاش
            var customerInvoices = allInvoicesCache.filter(inv => inv.customer === customerName);
            // المصفوفة مرتبة أصلاً في الكاش (الأحدث أولاً)
            var latestInvoice = customerInvoices[0];
            var totalDebt = latestInvoice ? ((latestInvoice.total || 0) + (latestInvoice.previousBalance || 0) - (latestInvoice.payment || 0)) : 0;
            
            var item = document.createElement('div');
            item.className = 'customer-suggestion-item';
            item.innerHTML = '<strong>' + customerName + '</strong><small style="display: block; margin-top: 6px;">📋 ' + toEnglishNumbers(customerInvoices.length) + ' فواتير | 💰 متبقي: ' + formatCurrency(totalDebt) + ' دينار</small>';
            item.onclick = function() {
                document.getElementById('customerName').value = customerName;
                suggestionsContainer.style.display = 'none';
                viewBtn.style.display = 'block';
                if (!currentEditingInvoiceId) {
                    document.getElementById('previousBalance').value = totalDebt > 0 ? totalDebt : 0;
                    updateFinalTotals();
                }
                document.getElementById('invoiceDate').focus();
            };
            suggestionsContainer.appendChild(item);
        });
        suggestionsContainer.style.display = 'block';
    } else {
        suggestionsContainer.style.display = 'none';
        viewBtn.style.display = 'none';
    }
}

function updateLineTotal() { 
    var q = parseFloat(document.getElementById('quantity').value) || 0;
    var p = parseFloat(document.getElementById('price').value) || 0; 
    document.getElementById('lineTotal').textContent = formatCurrency(q * p); 
}

function handleAddOrUpdateClick() {
    if (isEditingItem) {
        updateItemInInvoice();
    } else {
        addItemFromForm();
    }
}

async function addItemFromForm() {
    var productName = document.getElementById('productName').value.trim(); 
    var quantity = parseFloat(document.getElementById('quantity').value) || 0; 
    var price = parseFloat(document.getElementById('price').value) || 0; 
    var notes = document.getElementById('itemNotes').value.trim(); 
    
    if (!productName || quantity <= 0 || price <= 0) return alert('يرجى إدخال اسم المنتج وكمية وسعر صحيح.'); 
    
    // إضافة المنتج للكاش وال DB إذا جديد
    var productInCache = allProductsCache.find(p => p.name.toLowerCase() === productName.toLowerCase());
    
    if (!productInCache) { 
        var newId = await db.products.add({ name: productName, price: price }); 
        // تحديث الكاش يدوياً لتجنب إعادة التحميل الكامل
        allProductsCache.push({ id: newId, name: productName, price: price });
        // إعادة ترتيب الكاش
        allProductsCache.sort((a,b) => a.name.localeCompare(b.name));
    } else if (productInCache.price !== price) { 
        await db.products.update(productInCache.id, { price: price }); 
        productInCache.price = price; // تحديث الكاش
    } 
    
    currentInvoice.items.push({ product: productName, quantity: quantity, price: price, total: quantity * price, notes: notes }); 
    displayCurrentInvoiceItems(); 
    updateFinalTotals(); 
    ['productName', 'quantity', 'price', 'itemNotes'].forEach(function(id) { document.getElementById(id).value = ''; }); 
    document.getElementById('lineTotal').textContent = '0'; 
    document.getElementById('productName').focus();
    showSuccess('تمت إضافة ' + productName + ' للفاتورة ✅');
}

function editItem(index) {
    var item = currentInvoice.items[index]; 
    if (!item) return; 
    isEditingItem = true; 
    editingItemIndex = index; 
    document.getElementById('productName').value = item.product; 
    document.getElementById('quantity').value = item.quantity; 
    document.getElementById('price').value = item.price; 
    document.getElementById('itemNotes').value = item.notes || ''; 
    updateLineTotal(); 
    document.getElementById('addItemBtn').textContent = '✏️ تحديث المنتج'; 
    window.scrollTo(0, document.getElementById('productName').offsetTop);
}

function updateItemInInvoice() {
    var productName = document.getElementById('productName').value.trim(); 
    var quantity = parseFloat(document.getElementById('quantity').value) || 0; 
    var price = parseFloat(document.getElementById('price').value) || 0; 
    var notes = document.getElementById('itemNotes').value.trim(); 
    if (!productName || quantity <= 0 || price <= 0) return alert('يرجى إدخال اسم المنتج وكمية وسعر صحيح.'); 
    currentInvoice.items[editingItemIndex] = { product: productName, quantity: quantity, price: price, total: quantity * price, notes: notes }; 
    isEditingItem = false; 
    editingItemIndex = null; 
    displayCurrentInvoiceItems(); 
    updateFinalTotals(); 
    ['productName', 'quantity', 'price', 'itemNotes'].forEach(function(id) { document.getElementById(id).value = ''; }); 
    document.getElementById('lineTotal').textContent = '0'; 
    document.getElementById('addItemBtn').textContent = '➕ إضافة المنتج للفاتورة'; 
    document.getElementById('productName').focus();
}

function removeItem(index) { 
    var itemName = currentInvoice.items[index].product;
    if (confirm('هل أنت متأكد من حذف "' + itemName + '" من الفاتورة؟')) {
        currentInvoice.items.splice(index, 1); 
        displayCurrentInvoiceItems(); 
        updateFinalTotals();
        showSuccess('تم حذف المنتج بنجاح');
    }
}

function updateFinalTotals() {
    var currentTotal = currentInvoice.items.reduce(function(s, i) { return s + i.total; }, 0); 
    
    // جمع الكميات
    var totalQuantity = currentInvoice.items.reduce(function(sum, item) { 
        return sum + (parseFloat(item.quantity) || 0); 
    }, 0);

    var prevBal = parseFloat(document.getElementById('previousBalance').value) || 0; 
    var payment = parseFloat(document.getElementById('paymentAmount').value) || 0; 
    var remaining = (currentTotal + prevBal) - payment; 
    
    currentInvoice.total = currentTotal; 
    currentInvoice.previousBalance = prevBal; 
    currentInvoice.payment = payment; 
    
    // التعديل هنا: استخدام toEnglishNumbers فقط لعرض الكسور (مثل 15.25) بدلاً من التقريب
    document.getElementById('itemCount').textContent = toEnglishNumbers(totalQuantity); 
    
    document.getElementById('currentTotalAmount').textContent = formatCurrency(currentTotal) + ' دينار'; 
    document.getElementById('remainingAmount').textContent = formatCurrency(remaining) + ' دينار';
}

function displayCurrentInvoiceItems() {
    document.getElementById('itemsContainerWrapper').style.display = currentInvoice.items.length > 0 ? 'block' : 'none'; 
    var container = document.getElementById('itemsContainer'); 
    container.innerHTML = currentInvoice.items.map(function(item, i) { 
        return '<tr><td style="padding:10px; border-bottom:1px solid #eee;">' + formatCurrency(i + 1) + '</td><td style="text-align:right; padding:10px; border-bottom:1px solid #eee;">' + item.product + '</td><td style="padding:10px; border-bottom:1px solid #eee;">' + toEnglishNumbers(item.quantity) + '</td><td style="padding:10px; border-bottom:1px solid #eee;">' + formatCurrency(item.price) + '</td><td style="padding:10px; border-bottom:1px solid #eee; font-weight:bold;">' + formatCurrency(item.total) + '</td><td style="padding:10px; border-bottom:1px solid #eee;">' + (item.notes || '-') + '</td><td style="padding:10px; border-bottom:1px solid #eee;"><button class="btn success" style="padding:6px 12px;" onclick="editItem(' + i + ')">✏️</button></td><td style="padding:10px; border-bottom:1px solid #eee;"><button class="btn danger" style="padding:6px 12px;" onclick="removeItem(' + i + ')">🗑️</button></td></tr>'; 
    }).join('');
}

async function saveOrUpdateInvoice() {
    var customerName = document.getElementById('customerName').value.trim(); 
    if (!customerName) return alert('يرجى إدخال اسم الزبون.'); 
    if (currentInvoice.items.length === 0) return alert('لا يمكن حفظ فاتورة فارغة.'); 
    
    var invoiceDate = document.getElementById('invoiceDate').value;
    if (!invoiceDate) {
        setTodayDate();
        invoiceDate = document.getElementById('invoiceDate').value;
    }

    updateFinalTotals(); 
    var invoiceType = document.getElementById('invoiceType').value;

    try {
        // تجهيز بيانات الفاتورة
        var newData = { 
            customer: customerName, 
            date: invoiceDate, 
            invoiceType: invoiceType, 
            ...currentInvoice 
        };

        if (currentEditingInvoiceId) { 
            // === حالة التحديث ===
            var index = allInvoicesCache.findIndex(inv => inv.id === currentEditingInvoiceId);
            if (index !== -1) {
                newData.id = currentEditingInvoiceId;
                allInvoicesCache[index] = newData;
                showSuccess('تم تحديث الفاتورة بنجاح!'); 
            }
        } else { 
            // === حالة فاتورة جديدة ===
            newData.id = generateId(allInvoicesCache);
            allInvoicesCache.unshift(newData);
            showSuccess('تم حفظ الفاتورة بنجاح!'); 
        } 
        
        // حفظ كل الفواتير في الملف
        await saveDataToFile(INVOICES_FILE, allInvoicesCache);
        
        // تحديث العرض
        renderInvoicesList(allInvoicesCache.slice(0, MAX_ITEMS_DISPLAY));
        updateCounters();
        
        clearCurrentInvoice(); 

    } catch(e) {
        console.error(e);
        showError('خطأ أثناء الحفظ');
    }
}

function clearCurrentInvoice() {
    document.getElementById('invoiceType').value = '-'; 
    currentInvoice = { items: [], total: 0, payment: 0, previousBalance: 0 }; 
    currentEditingInvoiceId = null; 
    isEditingItem = false; 
    editingItemIndex = null; 
    ['customerName', 'quantity', 'price', 'itemNotes', 'previousBalance', 'paymentAmount'].forEach(function(id) { 
        var element = document.getElementById(id); 
        if (element) element.value = ''; 
    }); 
    document.getElementById('addItemBtn').textContent = '➕ إضافة المنتج للفاتورة'; 
    updateLineTotal(); 
    updateFinalTotals(); 
    displayCurrentInvoiceItems();
    setTodayDate();
}

function confirmClearInvoice() { 
    if (confirm('هل أنت متأكد من مسح هذه الفاتورة؟')) { 
        clearCurrentInvoice(); 
    } 
}

async function editInvoice(invoiceId) { 
    // البحث في الكاش بدلاً من DB
    var invoice = allInvoicesCache.find(i => i.id === invoiceId); 
    if (!invoice) return; 
    
    currentEditingInvoiceId = invoiceId; 
    currentInvoice = { 
        items: invoice.items || [], 
        total: invoice.total || 0, 
        payment: invoice.payment || 0, 
        previousBalance: invoice.previousBalance || 0 
    }; 
    document.getElementById('customerName').value = invoice.customer; 
    document.getElementById('invoiceDate').value = invoice.date; 
    document.getElementById('previousBalance').value = invoice.previousBalance || ''; 
    document.getElementById('paymentAmount').value = invoice.payment || '';
    document.getElementById('invoiceType').value = invoice.invoiceType || '-'; 
    displayCurrentInvoiceItems(); 
    updateFinalTotals(); 
    switchTab('create', document.querySelector('.tabs .tab')); 
    window.scrollTo(0, 0); 
}

async function deleteInvoice(invoiceId) { 
    if (confirm('هل أنت متأكد من حذف هذه الفاتورة؟')) { 
        // حذف الفاتورة من الذاكرة
        allInvoicesCache = allInvoicesCache.filter(inv => inv.id !== invoiceId);
        // حفظ الملف
        await saveDataToFile(INVOICES_FILE, allInvoicesCache);
        
        handleInvoiceSearch();
        updateCounters();
        showSuccess('تم الحذف');
    } 
}

// =========================================================================
// ============== منطق قسم الفواتير المحفوظة (محسن بالكاش) =================
// =========================================================================
function handleInvoiceSearch() {
    var searchQuery = document.getElementById('invoiceSearchInput').value.toLowerCase().trim();
    
    // الفلترة في الذاكرة
    var filteredInvoices = allInvoicesCache.filter(function(inv) {
        var customerMatch = inv.customer.toLowerCase().includes(searchQuery);
        var idMatch = String(inv.id).toLowerCase().includes(searchQuery);
        return customerMatch || idMatch;
    });
    
    filteredInvoices = applyFilterToInvoices(filteredInvoices, currentFilter);
    
    // عرض النتائج (محددة بـ MAX_ITEMS_DISPLAY لتجنب التعليق)
    renderInvoicesList(filteredInvoices.slice(0, MAX_ITEMS_DISPLAY));
}

function applyFilterToInvoices(invoices, filter) {
    return invoices.filter(function(inv) {
        var remaining = (inv.total || 0) + (inv.previousBalance || 0) - (inv.payment || 0);
        switch (filter) {
            case 'paid': return remaining <= 0;
            case 'unpaid': return remaining > 0;
            default: return true;
        }
    });
}

function applyFilter(filter) {
    currentFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(function(btn) { btn.classList.remove('active'); });
    event.target.classList.add('active');
    handleInvoiceSearch();
}

function renderInvoicesList(invoices) {
    var container = document.getElementById('invoicesList');
    var statsContainer = document.getElementById('stats-summary');
    container.innerHTML = '';
    statsContainer.innerHTML = '';

    if (invoices.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:var(--text-light);padding:20px;">لا توجد فواتير تطابق البحث.</p>';
        return;
    }
    
    // ملاحظة: نعرض إحصائيات الكل، وليس فقط ال 50 المعروضة
    // نحسب الإحصائيات من الكاش الكلي بناءً على الفلتر الحالي
    var allFilteredForStats = applyFilterToInvoices(allInvoicesCache, currentFilter);
    if(document.getElementById('invoiceSearchInput').value) {
        // إذا كان هناك بحث، نحسب إحصائيات نتائج البحث فقط
         allFilteredForStats = applyFilterToInvoices(allInvoicesCache.filter(i => 
             i.customer.toLowerCase().includes(document.getElementById('invoiceSearchInput').value.toLowerCase()) || 
             String(i.id).includes(document.getElementById('invoiceSearchInput').value)
         ), currentFilter);
    }

    var totalSales = allFilteredForStats.reduce(function(sum, inv) { return sum + (inv.total || 0); }, 0);
    var totalPaid = allFilteredForStats.reduce(function(sum, inv) { return sum + (inv.payment || 0); }, 0);
    var totalRemaining = allFilteredForStats.reduce(function(sum, inv) {
        var remaining = (inv.total || 0) + (inv.previousBalance || 0) - (inv.payment || 0);
        return sum + remaining;
    }, 0);
    var paidInvoices = allFilteredForStats.filter(function(inv) { return ((inv.total || 0) + (inv.previousBalance || 0) - (inv.payment || 0)) <= 0; }).length;
    var unpaidInvoices = allFilteredForStats.length - paidInvoices;

    statsContainer.innerHTML = 
        '<div class="stat-item"><div class="value">' + formatCurrency(allFilteredForStats.length) + '</div><div class="label">عدد الفواتير (الكلي)</div></div>' +
        '<div class="stat-item"><div class="value">' + formatCurrency(totalSales) + '</div><div class="label">إجمالي المبيعات</div></div>' +
        '<div class="stat-item"><div class="value" style="color: var(--success-color);">' + formatCurrency(totalPaid) + '</div><div class="label">إجمالي المدفوعات</div></div>' +
        '<div class="stat-item"><div class="value" style="color: var(--danger-color);">' + formatCurrency(totalRemaining) + '</div><div class="label">إجمالي المتبقي</div></div>';

    // تنبيه إذا كان العرض محدوداً
    if (allFilteredForStats.length > invoices.length) {
         container.innerHTML = '<div style="text-align:center; padding:10px; color:#666; margin-bottom:10px; background:#fff; border-radius:8px;">يتم عرض أحدث ' + invoices.length + ' فاتورة فقط لتحسين السرعة. استخدم البحث للعثور على فواتير قديمة.</div>';
    }

    var groupedByCustomer = invoices.reduce(function(acc, inv) {
        (acc[inv.customer] = acc[inv.customer] || []).push(inv);
        return acc;
    }, {});

    // ترتيب الزبائن حسب أحدث فاتورة
    var customerNames = Object.keys(groupedByCustomer).sort(function(a, b) {
        var latestInvoiceB = groupedByCustomer[b][0];
        var latestInvoiceA = groupedByCustomer[a][0];
        return (latestInvoiceB.id || 0) - (latestInvoiceA.id || 0);
    });

    for (var i = 0; i < customerNames.length; i++) {
        var customerName = customerNames[i];
        var customerInvoices = groupedByCustomer[customerName]; // هي أصلاً مرتبة لأن invoices مرتبة
        var latestInvoice = customerInvoices[0];
        var finalRemaining = latestInvoice ? ((latestInvoice.total || 0) + (latestInvoice.previousBalance || 0) - (latestInvoice.payment || 0)) : 0;

        var groupHeader = document.createElement('div');
        groupHeader.className = 'customer-group-header';
        
        var groupColor = finalRemaining > 0 ? 'var(--danger-color)' : (finalRemaining < 0 ? 'var(--success-color)' : 'var(--text-light)');
        var groupBorder = finalRemaining > 0 ? 'var(--danger-color)' : (finalRemaining < 0 ? 'var(--success-color)' : 'var(--border-soft)');
        
        groupHeader.innerHTML = 
            '<div class="customer-header-main">' +
                '<div class="customer-name">' + customerName + '</div>' +
                '<div class="toggle-icon">▼</div>' +
            '</div>' +
            '<div class="customer-header-details">' +
                '<div class="detail-item">📋 ' + formatCurrency(customerInvoices.length) + ' فاتورة (معروضة)</div>' +
                '<div class="detail-item" style="font-weight: bold; color: ' + groupColor + '; border-color: ' + groupBorder + ';">متبقي (آخر فاتورة): ' + formatCurrency(finalRemaining) + '</div>' +
            '</div>';
        
        groupHeader.style.border = '2px solid ' + groupBorder;
        groupHeader.onclick = function(header) {
            return function() {
                header.classList.toggle('expanded');
                var invoicesList = header.nextElementSibling;
                if (invoicesList) {
                    invoicesList.style.display = invoicesList.style.display === 'block' ? 'none' : 'block';
                }
            };
        }(groupHeader);
        
        container.appendChild(groupHeader);

        var invoicesList = document.createElement('div');
        invoicesList.className = 'customer-invoices-list';
        invoicesList.style.display = 'none';
        
        for (var j = 0; j < customerInvoices.length; j++) {
            var inv = customerInvoices[j];
            var remaining = ((inv.total || 0) + (inv.previousBalance || 0) - (inv.payment || 0));
            var invoiceColor = remaining > 0 ? 'var(--danger-color)' : (remaining < 0 ? 'var(--success-color)' : 'var(--text-light)');
            
            var subItem = document.createElement('div');
            subItem.className = 'sub-invoice-item';
            subItem.innerHTML = 
                '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 12px; font-size: 0.9rem;">' +
                    '<div><strong>رقم الفاتورة:</strong> ' + formatCurrency(inv.id) + '</div>' +
                    '<div><strong>التاريخ:</strong> ' + toEnglishNumbers(inv.date) + '</div>' +
                    '<div><strong>المجموع:</strong> ' + formatCurrency(inv.total) + '</div>' +
                    '<div><strong>الواصل:</strong> ' + formatCurrency(inv.payment) + '</div>' +
                    '<div style="font-weight: bold; color: ' + invoiceColor + ';"><strong>المتبقي:</strong> ' + formatCurrency(remaining) + '</div>' +
                '</div>' +
                '<div class="invoice-actions">' +
                    '<button class="btn success" style="padding: 8px 12px;" onclick="printInvoice(' + inv.id + ')">🖨️ طباعة</button>' +
                    '<button class="btn accent" style="padding: 8px 12px;" onclick="shareInvoiceText(' + inv.id + ')">📤 مشاركة</button>' +
                    '<button class="btn primary" style="padding: 8px 12px;" onclick="editInvoice(' + inv.id + ')">✏️ تعديل</button>' +
                    '<button class="btn danger" style="padding: 8px 12px;" onclick="deleteInvoice(' + inv.id + ')">🗑️ حذف</button>' +
                '</div>';
            
            invoicesList.appendChild(subItem);
        }
        container.appendChild(invoicesList);
    }
}

// =========================================================================
// ============== قسم مراجعة الحسابات وتسديد الديون (محسن) =================
// =========================================================================
function displayAccountAudits(showToast = false) {
    var list = document.getElementById('auditingList');
    var searchInput = document.getElementById('auditingSearchInput').value.toLowerCase().trim();
    list.innerHTML = '';

    // تجميع كل الفواتير من الكاش
    var groupedByCustomer = allInvoicesCache.reduce(function(acc, inv) {
        if (inv.customer && inv.customer.trim()) {
            (acc[inv.customer] = acc[inv.customer] || []).push(inv);
        }
        return acc;
    }, {});

    var customerNames = Object.keys(groupedByCustomer);
    if (searchInput) {
        customerNames = customerNames.filter(function(name) { 
            return name.toLowerCase().includes(searchInput); 
        });
    }

    document.getElementById('customersCounter').textContent = formatCurrency(customerNames.length);

    // حساب الإحصائيات الكلية
    var totalInvoicesCount = 0;
    var totalSalesAmount = 0;
    var totalRemainingAmount = 0;
    var totalAmountWithPrevious = 0;

    Object.values(groupedByCustomer).forEach(function(invoices) {
        totalInvoicesCount += invoices.length;
        invoices.forEach(function(inv) {
            totalSalesAmount += (inv.total || 0);
            totalAmountWithPrevious += (inv.total || 0) + (inv.previousBalance || 0);
        });
        // حساب المتبقي من آخر فاتورة لكل زبون
        var sortedInvoices = [].concat(invoices).sort(function(a, b) { return (b.id || 0) - (a.id || 0); });
        var latestInvoice = sortedInvoices[0];
        if (latestInvoice) {
            var remaining = ((latestInvoice.total || 0) + (latestInvoice.previousBalance || 0)) - (latestInvoice.payment || 0);
            totalRemainingAmount += remaining;
        }
    });

    // عرض الملخص
    var summaryDiv = document.getElementById('auditingSummary');
    var timestamp = document.getElementById('auditingTimestamp');
    var currentDateTime = getCurrentDateTime();
    
    summaryDiv.style.display = 'block';
    timestamp.textContent = '🕒 آخر تحديث: ' + toEnglishNumbers(currentDateTime.date) + ' - ' + currentDateTime.time;
    
    document.getElementById('auditingTotalInvoices').textContent = formatCurrency(totalInvoicesCount);
    document.getElementById('auditingTotalSales').textContent = formatCurrency(totalSalesAmount) + ' دينار';
    document.getElementById('auditingTotalAmount').textContent = formatCurrency(totalAmountWithPrevious) + ' دينار';
    document.getElementById('auditingTotalRemaining').textContent = formatCurrency(totalRemainingAmount) + ' دينار';

    // إشعار التحديث
    // يظهر الإشعار فقط إذا كانت القيمة true تماماً
    if (showToast === true) {
        showInfo('تم تحديث حسابات الزبائن ✅ | ' + toEnglishNumbers(customerNames.length) + ' زبون');
    }

    // عرض أول 20 فقط لتجنب التعليق
    var displayedCustomers = customerNames.sort().slice(0, 20);

    if (displayedCustomers.length === 0) {
        list.innerHTML = '<div class="section-card" style="text-align:center; padding: 40px;"><h3 style="color: var(--text-light);">لا يوجد نتائج</h3></div>';
        return;
    }
    
    if (customerNames.length > 20 && !searchInput) {
        list.innerHTML += '<div style="background:#fff3cd; color:#856404; padding:10px; border-radius:5px; margin-bottom:15px; text-align:center;">يتم عرض أول 20 زبون فقط. ابحث عن اسم الزبون لعرض كشف حسابه.</div>';
    }

    // باقي الكود كما هو (عرض الزبائن)
    for (var i = 0; i < displayedCustomers.length; i++) {
        var customerName = displayedCustomers[i];
        var invoices = groupedByCustomer[customerName];
        var sortedInvoices = [].concat(invoices).sort(function(a, b) { return (b.id || 0) - (a.id || 0); });
        var latestInvoice = sortedInvoices[0];
        var finalRemaining = latestInvoice ? ((latestInvoice.total || 0) + (latestInvoice.previousBalance || 0) - (latestInvoice.payment || 0)) : 0;
        
        var totalInvoiceAmountForDisplay = latestInvoice ? (latestInvoice.total || 0) : 0;
        var totalPreviousBalanceForDisplay = latestInvoice ? (latestInvoice.previousBalance || 0) : 0;
        var totalPaidAmountForDisplay = latestInvoice ? (latestInvoice.payment || 0) : 0;
        var totalInvoicesForCustomer = invoices.reduce(function(sum, inv) { return sum + (inv.total || 0); }, 0);

        var customerCard = document.createElement('div');
        customerCard.className = 'customer-card-enhanced';
        customerCard.style.marginBottom = '18px';
        
        var cardColor = finalRemaining > 0 ? 'var(--danger-color)' : 'var(--success-color)';
        var cardBorder = finalRemaining > 0 ? 'var(--danger-color)' : 'var(--success-color)';
        if (finalRemaining == 0) {
            cardColor = 'var(--text-light)';
            cardBorder = 'var(--border-soft)';
        }

        customerCard.style.border = '2px solid ' + cardBorder;
        
        var invoicesTableHTML = 
            '<div class="audit-invoices-container" id="audit-details-' + latestInvoice.id + '">' +
                '<div style="background: #f8f9fa; padding: 15px; border-radius: 12px; margin: 15px 0;">' +
                    '<h4 style="color: var(--primary-dark); margin-bottom: 15px; display: flex; align-items: center; gap: 8px;">' +
                        '<span>📋</span> تفاصيل الفواتير (' + toEnglishNumbers(invoices.length) + ' فاتورة)' +
                    '</h4>' +
                '</div>' +
                '<div style="overflow-x:auto;">' +
                    '<table class="audit-invoices-table">' +
                        '<thead>' +
                            '<tr>' +
                                '<th>#</th>' +
                                '<th>التاريخ</th>' +
                                '<th>الإجمالي</th>' +
                                '<th>الواصل</th>' +
                                '<th>المتبقي</th>' +
                            '</tr>' +
                        '</thead>' +
                        '<tbody>' +
                            sortedInvoices.map(function(inv) {
                                var remaining = ((inv.total || 0) + (inv.previousBalance || 0)) - (inv.payment || 0);
                                return '<tr>' +
                                    '<td>' + toEnglishNumbers(inv.id) + '</td>' +
                                    '<td>' + toEnglishNumbers(inv.date) + '</td>' +
                                    '<td>' + formatCurrency(inv.total) + '</td>' +
                                    '<td>' + formatCurrency(inv.payment) + '</td>' +
                                    '<td style="font-weight: bold; color: ' + (remaining > 0 ? 'var(--danger-color)' : 'var(--success-color)') + ';">' + formatCurrency(remaining) + '</td>' +
                                '</tr>';
                            }).join('') +
                        '</tbody>' +
                    '</table>' +
                '</div>' +
            '</div>';

        customerCard.innerHTML = 
            '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">' +
                '<h3 style="color: var(--primary-dark); font-size: 1.6rem; margin: 0;">' + customerName + '</h3>' +
                '<div style="background: ' + (finalRemaining > 0 ? '#ffebee' : finalRemaining < 0 ? '#e8f5e8' : '#f0f4f8') + '; padding: 8px 16px; border-radius: 20px; border: 2px solid ' + cardBorder + ';">' +
                    '<span style="font-weight: 700; color: ' + cardColor + ';">' + (finalRemaining > 0 ? 'مبلغ مستحق' : finalRemaining < 0 ? 'رصيد إيجابي' : 'مستقر') + '</span>' +
                '</div>' +
            '</div>' +
            '<div class="stats-grid-enhanced">' +
                '<div class="stat-item-enhanced">' +
                    '<div class="stat-label-enhanced">إجمالي الفاتورة الأحدث</div>' +
                    '<div class="stat-value-enhanced" style="color: var(--primary-color);">' + formatCurrency(totalInvoiceAmountForDisplay) + '</div>' +
                '</div>' +
                '<div class="stat-item-enhanced">' +
                    '<div class="stat-label-enhanced">إجمالي جميع الفواتير</div>' +
                    '<div class="stat-value-enhanced" style="color: var(--primary-dark);">' + formatCurrency(totalInvoicesForCustomer) + '</div>' +
                '</div>' +
                '<div class="stat-item-enhanced">' +
                    '<div class="stat-label-enhanced">الحساب السابق (للأحدث)</div>' +
                    '<div class="stat-value-enhanced" style="color: var(--text-dark);">' + formatCurrency(totalPreviousBalanceForDisplay) + '</div>' +
                '</div>' +
                '<div class="stat-item-enhanced">' +
                    '<div class="stat-label-enhanced">الواصل (في الأحدث)</div>' +
                    '<div class="stat-value-enhanced" style="color: var(--success-color);">' + formatCurrency(totalPaidAmountForDisplay) + '</div>' +
                '</div>' +
                '<div class="stat-item-enhanced">' +
                    '<div class="stat-label-enhanced">المتبقي النهائي</div>' +
                    '<div class="stat-value-enhanced" style="color: ' + cardColor + ';">' + formatCurrency(finalRemaining) + '</div>' +
                '</div>' +
            '</div>' +
            '<div class="actions-enhanced">' +
                '<button class="btn-enhanced success" onclick="openRepaymentModal(\'' + customerName + '\', ' + finalRemaining + ')">' +
                    '💰 تسديد دين' +
                '</button>' +
                '<button class="btn-enhanced accent" onclick="toggleAuditDetails(\'audit-details-' + latestInvoice.id + '\')">' +
                    '🧾 عرض/إخفاء الفواتير' +
                '</button>' +
                '<button class="btn-enhanced primary" onclick="printCustomerStatement(\'' + customerName + '\')">' +
                    '🖨️ طباعة كشف حساب' +
                '</button>' +
                '<button class="btn-enhanced" style="background: linear-gradient(135deg, #9C27B0 0%, #E91E63 100%);" onclick="shareCustomerStatement(\'' + customerName + '\')">' +
                    '📤 مشاركة كشف الحساب' +
                '</button>' +
            '</div>' +
            invoicesTableHTML;
        list.appendChild(customerCard);
    }
}

function toggleAuditDetails(containerId) {
    var container = document.getElementById(containerId);
    if(container) container.classList.toggle('expanded');
}

// --- دوال تسديد الدين الجديدة ---

function openRepaymentModal(customerName, currentDebt) {
    currentRepayCustomer = customerName;
    document.getElementById('repayCustomerName').textContent = customerName;
    document.getElementById('repayCurrentDebt').textContent = formatCurrency(currentDebt);
    document.getElementById('repayAmountInput').value = '';
    
    var modal = document.getElementById('repaymentModal');
    modal.classList.add('active');
    document.getElementById('repayAmountInput').focus();
}

function closeRepaymentModal() {
    document.getElementById('repaymentModal').classList.remove('active');
    currentRepayCustomer = null;
}

async function submitRepayment() {
    var amountInput = document.getElementById('repayAmountInput');
    var amount = parseFloat(amountInput.value);
    
    if (!amount || amount <= 0) {
        alert('يرجى إدخال مبلغ صحيح.');
        return;
    }
    
    if (!currentRepayCustomer) return;
    
    try {
        var invoices = allInvoicesCache.filter(i => i.customer === currentRepayCustomer).sort(function(a, b) { return (b.id || 0) - (a.id || 0); });
        var latestInvoice = invoices[0];
        var currentTotalDebt = latestInvoice ? ((latestInvoice.total || 0) + (latestInvoice.previousBalance || 0) - (latestInvoice.payment || 0)) : 0;

        var repayInvoice = {
            id: generateId(allInvoicesCache), // توليد ID جديد
            customer: currentRepayCustomer,
            date: getCurrentDate(), 
            invoiceType: 'تسديد',
            items: [{
                product: "تسديد دفعة نقدية",
                quantity: 1,
                price: 0,
                total: 0,
                notes: "تم تسديد مبلغ " + formatCurrency(amount) + " دينار"
            }],
            total: 0,
            previousBalance: currentTotalDebt, 
            payment: amount 
        };
        
        // إضافة الفاتورة وحفظ الملف
        allInvoicesCache.unshift(repayInvoice);
        await saveDataToFile(INVOICES_FILE, allInvoicesCache);
        
        // تحديث الكاش والعرض
        await refreshGlobalCache(); // لضمان التزامن
        displayAccountAudits();
        
        closeRepaymentModal();
        showSuccess('تم تسديد المبلغ بنجاح! الرصيد المتبقي: ' + formatCurrency(currentTotalDebt - amount));
        
    } catch (error) {
        console.error('Error processing repayment:', error);
        showError('حدث خطأ أثناء عملية التسديد.');
    }
}

// =========================================================================
// ============== دوال الاستيراد والتصدير والحذف الشامل =====================
// =========================================================================
async function exportInvoices() { 
    try {
        if (allInvoicesCache.length === 0) return showWarning("لا توجد فواتير لتصديرها.");
        var data = { invoices: allInvoicesCache }; 
        var dataStr = JSON.stringify(data, null, 2); 
        var fileName = "invoices_backup_" + new Date().toISOString().slice(0, 10) + ".json"; 
        await shareOrDownload(dataStr, fileName, 'application/json'); 
        showSuccess('تم تصدير الفواتير بنجاح');
    } catch (error) {
        console.error('Error:', error); showError('فشل التصدير');
    }
}

function importInvoices() { document.getElementById('import-invoices-file').click(); }

function handleInvoiceImport(event) { 
    var file = event.target.files[0]; 
    if (!file) return; 
    if (!file.name.endsWith('.json')) return alert('يرجى اختيار ملف JSON فقط.'); 
    var reader = new FileReader(); 
    reader.onload = function(e) { processInvoiceImport(e.target.result); }; 
    reader.readAsText(file, 'UTF-8'); 
}

async function processInvoiceImport(dataStr) { 
    if (!dataStr || dataStr.trim() === '') return alert('الملف فارغ.'); 
    if (!confirm("سيتم استبدال جميع الفواتير الحالية. هل أنت متأكد؟")) return; 
    try { 
        var importedData = JSON.parse(dataStr); 
        if (!importedData.invoices) throw new Error("ملف غير صالح"); 
        await db.transaction('rw', db.invoices, async function() { 
            await db.invoices.clear(); 
            var cleanedInvoices = importedData.invoices.map(function(inv) { 
                var cleanInv = { ...inv }; delete cleanInv.id; return cleanInv; 
            }); 
            await db.invoices.bulkAdd(cleanedInvoices); 
        }); 
        await refreshGlobalCache();
        renderInvoicesList(allInvoicesCache.slice(0, MAX_ITEMS_DISPLAY));
        alert('تم الاستيراد بنجاح!'); 
    } catch (error) { 
        alert("فشل الاستيراد: " + error.message); 
    } 
}

async function exportProducts() { 
    try {
        if (allProductsCache.length === 0) return showWarning("لا توجد منتجات.");
        var data = { products: allProductsCache }; 
        var dataStr = JSON.stringify(data, null, 2); 
        var fileName = "products_backup_" + new Date().toISOString().slice(0, 10) + ".json"; 
        await shareOrDownload(dataStr, fileName, 'application/json'); 
        showSuccess('تم تصدير المنتجات');
    } catch (error) { showError('فشل التصدير'); }
}

function importProducts() { document.getElementById('import-products-file').click(); }

function handleProductImport(event) { 
    var file = event.target.files[0]; 
    if (!file) return; 
    if (!file.name.endsWith('.json')) return alert('يرجى اختيار ملف JSON فقط.'); 
    var reader = new FileReader(); 
    reader.onload = function(e) { processProductImport(e.target.result); }; 
    reader.readAsText(file, 'UTF-8'); 
}

async function processProductImport(dataStr) { 
    if (!dataStr || dataStr.trim() === '') return alert('الملف فارغ.'); 
    if (!confirm("سيتم استبدال جميع المنتجات الحالية. هل أنت متأكد؟")) return; 
    try { 
        var importedData = JSON.parse(dataStr); 
        if (!importedData.products) throw new Error("ملف غير صالح"); 
        await db.transaction('rw', db.products, async function() { 
            await db.products.clear(); 
            var cleanedProducts = importedData.products.map(function(prod) { 
                var cleanProd = { ...prod }; delete cleanProd.id; return cleanProd; 
            }); 
            await db.products.bulkAdd(cleanedProducts); 
        }); 
        await refreshGlobalCache();
        renderProductsList(allProductsCache.slice(0, MAX_ITEMS_DISPLAY));
        alert('تم الاستيراد بنجاح!'); 
    } catch (error) { 
        alert("فشل الاستيراد: " + error.message); 
    } 
}

async function clearAllProducts() {
    if (confirm('هل أنت متأكد من حذف جميع المنتجات؟')) {
        await db.products.clear(); 
        await refreshGlobalCache();
        renderProductsList([]);
        showSuccess('تم حذف المنتجات');
    }
}

async function clearAllInvoices() { 
    if (confirm('تحذير! هل أنت متأكد من حذف جميع الفواتير؟')) {
        await db.invoices.clear(); 
        await refreshGlobalCache();
        renderInvoicesList([]);
        showSuccess('تم حذف الفواتير');
    }
}

// =========================================================================
// ============== دوال المشاركة والطباعة (Sharing & Printing) ===============
// =========================================================================
async function shareOrDownload(dataStr, fileName, mimeType) { 
    // استخدام واجهة Tauri للمشاركة أو النسخ
    if (window.__TAURI__) {
        // الطريقة الأضمن: النسخ للحافظة
        navigator.clipboard.writeText(dataStr).then(() => {
            alert('تم نسخ البيانات للحافظة! يمكنك الآن لصقها في تيليجرام أو حفظها في ملف.');
        }).catch(err => {
            console.error(err);
            alert('فشل النسخ');
        });
        
        // ملاحظة: إذا كنت قد ثبتت tauri-plugin-share يمكنك استخدام:
        // window.__TAURI__.plugin.share.share({ title: fileName, text: dataStr });
    }
}
async function shareCurrentInvoice() { 
    if (currentInvoice.items.length === 0) return alert('يرجى تعبئة الفاتورة أولاً لمشاركتها.'); 
    updateFinalTotals(); 
    var customerName = document.getElementById('customerName').value.trim() || 'زبون'; 
    var remaining = (currentInvoice.total + currentInvoice.previousBalance) - currentInvoice.payment; 
    var shareText = 'فاتورة: *' + customerName + '*\nالتاريخ: ' + document.getElementById('invoiceDate').value + '\n------------------------------------\n'; 
    currentInvoice.items.forEach(function(item) { 
        var itemText = item.product + ' (' + toEnglishNumbers(item.quantity) + ' x ' + formatCurrency(item.price) + ') = *' + formatCurrency(item.total) + '*'; 
        if (item.notes) { itemText += '\n   - _ملاحظة: ' + item.notes + '_'; } 
        shareText += itemText + '\n'; 
    }); 
    shareText += '------------------------------------\nالمجموع: ' + formatCurrency(currentInvoice.total) + '\nحساب سابق: ' + formatCurrency(currentInvoice.previousBalance) + '\nالواصل: ' + formatCurrency(currentInvoice.payment) + '\n*المتبقي: ' + formatCurrency(remaining) + '*\n'; 
    if (window.plugins && window.plugins.socialsharing) { 
        window.plugins.socialsharing.share(shareText); 
    } else { 
        navigator.clipboard.writeText(shareText).then(function() { alert('تم النسخ'); }); 
    } 
}

async function shareInvoiceText(invoiceId) {
    var invoice = allInvoicesCache.find(i => i.id === invoiceId);
    if (!invoice) return;
    
    var remaining = (invoice.total || 0) + (invoice.previousBalance || 0) - (invoice.payment || 0);
    var shareText = 'فاتورة: *' + invoice.customer + '*\nالتاريخ: ' + invoice.date + '\n------------------------------------\n';
    
    (invoice.items || []).forEach(function(item) {
        var itemText = item.product + ' (' + toEnglishNumbers(item.quantity) + ' x ' + formatCurrency(item.price) + ') = *' + formatCurrency(item.total) + '*';
        if (item.notes) itemText += '\n   - _ملاحظة: ' + item.notes + '_';
        shareText += itemText + '\n';
    });
    
    shareText += '------------------------------------\nالمجموع: ' + formatCurrency(invoice.total) + '\nحساب سابق: ' + formatCurrency(invoice.previousBalance) + '\nالواصل: ' + formatCurrency(invoice.payment) + '\n*المتبقي: ' + formatCurrency(remaining) + '*\n';
    
    if (window.plugins && window.plugins.socialsharing) {
        window.plugins.socialsharing.share(shareText);
    } else {
        navigator.clipboard.writeText(shareText).then(function() { alert('تم النسخ'); });
    }
}

async function shareCustomerStatement(customerName) {
    try {
        var customerInvoices = allInvoicesCache.filter(function(inv) {
            return inv.customer === customerName;
        });

        if (customerInvoices.length === 0) return showError('لا توجد فواتير');
        // ترتيب تصاعدي للتاريخ
        customerInvoices.sort(function(a, b) { return (a.id || 0) - (b.id || 0); });

        var currentDateTime = getCurrentDateTime();
        var finalRemaining = 0;
        var latestInvoice = customerInvoices[customerInvoices.length - 1];
        if (latestInvoice) {
             finalRemaining = ((latestInvoice.total || 0) + (latestInvoice.previousBalance || 0)) - (latestInvoice.payment || 0);
        }

        var shareText = '📊 كشف حساب زبون\n━━━━━━━━━━━━━━━━━━━\n';
        shareText += '👤 الزبون: *' + customerName + '*\n';
        shareText += '📅 عدد الفواتير: ' + toEnglishNumbers(customerInvoices.length) + '\n';
        shareText += '📅 آخر تحديث: ' + toEnglishNumbers(currentDateTime.date) + ' ' + currentDateTime.time + '\n';
        shareText += '━━━━━━━━━━━━━━━━━━━\n\n📋 تفاصيل الفواتير:\n';
        
        customerInvoices.forEach(function(inv, idx) {
            var remaining = ((inv.total || 0) + (inv.previousBalance || 0)) - (inv.payment || 0);
            shareText += toEnglishNumbers(idx + 1) + ') فاتورة رقم ' + toEnglishNumbers(inv.id) + '\n';
            shareText += '   📅 التاريخ: ' + toEnglishNumbers(inv.date) + '\n';
            shareText += '   💰 المجموع: ' + formatCurrency(inv.total || 0) + '\n';
            shareText += '   💵 الواصل: ' + formatCurrency(inv.payment || 0) + '\n';
            shareText += '   ❌ المتبقي: ' + formatCurrency(remaining) + '\n\n';
        });
        
        shareText += '━━━━━━━━━━━━━━━━━━━\n📈 الملخص:\n';
        shareText += '❌ *الرصيد النهائي: ' + formatCurrency(finalRemaining) + '*\n';
        shareText += '━━━━━━━━━━━━━━━━━━━\n\n🏪 محلات ابو جعفر الرديني';

        if (window.plugins && window.plugins.socialsharing) {
            window.plugins.socialsharing.share(shareText);
        } else {
            navigator.clipboard.writeText(shareText).then(function() { showSuccess('تم النسخ'); });
        }
    } catch (error) { showError('خطأ في المشاركة'); }
}

async function printInvoice(invoiceId) {
    var invoice = allInvoicesCache.find(i => i.id === invoiceId);
    if (!invoice) return console.error("فاتورة غير موجودة");
    
    var totalWithPrevious = (invoice.total || 0) + (invoice.previousBalance || 0);
    var remaining = ((invoice.total || 0) + (invoice.previousBalance || 0)) - (invoice.payment || 0);
    
    var totalQuantity = (invoice.items || []).reduce(function(sum, item) { 
        return sum + (parseFloat(item.quantity) || 0); 
    }, 0);

    var currentTime = toEnglishNumbers(formatTime(new Date()));
    var invoiceDate = toEnglishNumbers(invoice.date);

    // بناء كود HTML للفاتورة
    var printHTML = '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>فاتورة - ' + invoice.customer + '</title><style>@import url(\'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap\');' +
    '@page { size: A4; margin: 3mm 7mm; } * { margin: 0; padding: 0; box-sizing: border-box; }' +
    'body { font-family: \'Cairo\', \'Tajawal\', \'Arial\', sans-serif; direction: rtl; font-size: 11.5pt; line-height: 1.25; color: #000; background: white !important; }' +
    '.header { background: #fff !important; border: 2px solid #000; border-radius: 12px; padding: 10px 15px; margin-bottom: 10px; position: relative; }' +
    '.header-top { display: flex; justify-content: space-between; align-items: center; padding-bottom: 10px; border-bottom: 2px solid #ccc; margin-bottom: 10px; }' +
    '.logo-badge { width: 55px; height: 55px; background: #fff !important; border: 3px solid #000; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 22pt; font-weight: 800; color: #000 !important; }' +
    '.store-info h1 { font-size: 22pt; font-weight: 800; color: #000 !important; margin-bottom: 2px; }' +
    '.invoice-id-badge { background: #eee; border: 2px solid #000; border-radius: 8px; padding: 4px 8px; font-weight: 600; font-size: 10pt; }' +
    '.contact-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 5px; margin-bottom: 8px; }' +
    '.contact-item { padding: 6px 10px; display: flex; align-items: center; gap: 8px; background: #fff; border-radius: 8px; border: 2px solid #000; }' +
    '.address-section { padding: 8px 12px; text-align: center; background: #fff; border-radius: 8px; border: 2px solid #000; }' +
    '.invoice-info { display: grid; grid-template-columns: 1.5fr 1fr 1fr 1fr; gap: 8px; padding: 6px 8px; font-size: 11pt; border: 1.5px solid #000; border-radius: 8px; margin-bottom: 8px; background: #f8f9fa; }' +
    '.items-table { width: 100%; border-collapse: collapse; font-size: 9pt; border-radius: 8px; overflow: hidden; }' +
    '.items-table th, .items-table td { border: 1.5px solid #000; padding: 3px; text-align: center; font-weight: 600; }' +
    '.summary-section { margin-top: 10px; padding-top: 5px; border-top: none; }' +
    '.summary-grid { display: flex; justify-content: space-between; align-items: stretch; gap: 5px; flex-wrap: wrap; }' +
    '.summary-item { flex: 1 1 140px; border: 1.5px solid #000; border-radius: 6px; padding: 4px 8px; background: #fff; display: flex; align-items: center; min-height: 32px; }' +
    '</style></head><body>' +
    '<header class="header"><div class="header-top"><div class="logo-section"><div class="logo-badge">JN</div><div class="store-info"><h1>محلات ابو جعفر الرديني</h1><div>لتجارة المواد الغذائية والحلويات</div></div></div><div class="invoice-id-badge">رقم الفاتورة: ' + toEnglishNumbers(invoice.id) + '</div></div>' +
    '<div class="contact-grid"><div class="contact-item"><div>07731103122 : جعفر</div></div><div class="contact-item"><div>07826342265 : حسين</div></div></div>' +
    '<div class="address-section">📍 العنوان : بلدروز - مقابل مطعم - بغداد - داخل القيصرية</div></header>' +
    '<section class="invoice-info">' +
    '<div class="info-item"><span>الزبون:</span> <span>' + invoice.customer + '</span></div>' +
    '<div class="info-item"><span>نوع:</span> <span>' + (invoice.invoiceType || '-') + '</span></div>' +
    '<div class="info-item"><span>التاريخ:</span> <span>' + invoiceDate + '</span></div>' +
    '<div class="info-item"><span>الوقت:</span> <span>' + currentTime + '</span></div>' +
    '</section>' +
    '<main><table class="items-table"><thead><tr><th style="width:5%">#</th><th style="width:40%">المنتج</th><th style="width:10%">الكمية</th><th style="width:15%">السعر</th><th style="width:15%">المبلغ</th><th style="width:15%">ملاحظات</th></tr></thead><tbody>' + 
    invoice.items.map(function(item, idx) { 
        return '<tr><td>' + toEnglishNumbers(idx + 1) + '</td><td>' + item.product + '</td><td>' + toEnglishNumbers(item.quantity) + '</td><td>' + formatCurrency(item.price) + '</td><td>' + formatCurrency(item.total) + '</td><td>' + (item.notes || '-') + '</td></tr>'; 
    }).join('') +
    '</tbody></table>' +
    '<section class="summary-section"><div class="summary-grid">' +
    '<div class="summary-item"><span>العدد:</span> <span>' + toEnglishNumbers(totalQuantity) + '</span></div>' +
    '<div class="summary-item"><span>المجموع:</span> <span>' + formatCurrency(invoice.total || 0) + '</span></div>' +
    '<div class="summary-item"><span>السابق:</span> <span>' + formatCurrency(invoice.previousBalance || 0) + '</span></div>' +
    '<div class="summary-item" style="background:#f0f0f0"><span>الكلي:</span> <span>' + formatCurrency(totalWithPrevious) + '</span></div>' +
    '<div class="summary-item"><span>الواصل:</span> <span>' + formatCurrency(invoice.payment || 0) + '</span></div>' +
    '<div class="summary-item" style="border:2px solid #000"><span>المتبقي:</span> <span>' + formatCurrency(remaining) + '</span></div>' +
    '</div></section></main></body></html>';
    
    // الطباعة باستخدام Iframe المخفي (يعمل على Tauri Android)
    var iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    
    iframe.contentDocument.write(printHTML);
    iframe.contentDocument.close();
    
    iframe.onload = function() {
        iframe.contentWindow.print(); 
        setTimeout(function() { document.body.removeChild(iframe); }, 2000);
    };
}

async function printCustomerStatement(customerName) {
    try {
        var customerInvoices = allInvoicesCache.filter(function(inv) {
            return inv.customer === customerName;
        });

        if (customerInvoices.length === 0) return alert('لا توجد بيانات');
        
        customerInvoices.sort(function(a, b) { return (a.id || 0) - (b.id || 0); });

        var finalRemaining = 0;
        var latestInvoice = customerInvoices[customerInvoices.length - 1];
        if (latestInvoice) {
             finalRemaining = ((latestInvoice.total || 0) + (latestInvoice.previousBalance || 0)) - (latestInvoice.payment || 0);
        }

        var currentTime = toEnglishNumbers(formatTime(new Date()));

        var printHTML = '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>كشف حساب - ' + customerName + '</title>' +
            '<style>@import url("https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap"); @page { size: A4; margin: 10mm; } body { font-family: "Cairo", sans-serif; direction: rtl; }' +
            'h1, h2 { text-align: center; color: #5B8DEF; } h1 { font-size: 20pt; } h2 { font-size: 16pt; margin-bottom: 15px; }' +
            'p { text-align: center; font-size: 12pt; margin-bottom: 20px; }' +
            'table { width: 100%; border-collapse: collapse; font-size: 11pt; margin-top: 15px; }' +
            'th, td { border: 1px solid #ccc; padding: 8px; text-align: center; }' +
            'th { background-color: #F0F4FF; color: #5B8DEF; font-weight: 700; }' +
            '.final-summary { margin-top: 30px; padding-top: 15px; border-top: 2px solid #5B8DEF; text-align: center; font-size: 1.5rem; font-weight: bold; }' +
            '.final-summary .label { color: #2C3E50; }' +
            '.final-summary .value { color: ' + (finalRemaining > 0 ? "#FF6B6B" : "#4ECDC4") + '; }' +
            '@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }' +
            '</style></head><body>' +
            '<h1>محلات ابو جعفر الرديني</h1>' +
            '<h2>كشف حساب زبون</h2>' +
            '<p><strong>الزبون:</strong> ' + customerName + '<br>' +
            '<strong>تاريخ الكشف:</strong> ' + toEnglishNumbers(new Date().toISOString().split('T')[0]) + ' | ' + currentTime + '</p>' +
            '<table>' +
            '<thead><tr><th>#</th><th>التاريخ</th><th>إجمالي الفاتورة</th><th>الحساب السابق</th><th>المبلغ الواصل</th><th>المتبقي</th></tr></thead>' +
            '<tbody>';

        var runningBalance = 0;
        customerInvoices.forEach(function(inv) {
            runningBalance = (inv.total || 0) + (inv.previousBalance || 0) - (inv.payment || 0);
            printHTML += '<tr>' +
                '<td>' + toEnglishNumbers(inv.id) + '</td>' +
                '<td>' + toEnglishNumbers(inv.date) + '</td>' +
                '<td>' + formatCurrency(inv.total || 0) + '</td>' +
                '<td>' + formatCurrency(inv.previousBalance || 0) + '</td>' +
                '<td>' + formatCurrency(inv.payment || 0) + '</td>' +
                '<td style="font-weight: bold; color: ' + (runningBalance > 0 ? '#FF6B6B' : (runningBalance == 0 ? '#7F8C8D' : '#4ECDC4')) + ';">' + formatCurrency(runningBalance) + '</td>' +
                '</tr>';
        });

        printHTML += '</tbody></table>' +
            '<div class="final-summary">' +
            '<span class="label">الرصيد النهائي المتبقي: </span>' +
            '<span class="value">' + formatCurrency(finalRemaining) + ' دينار</span>' +
            '</div>' +
            '</body></html>';

        if (window.cordova && window.cordova.plugins && window.cordova.plugins.printer) {
            window.cordova.plugins.printer.print(printHTML, { name: 'كشف_حساب_' + customerName });
        } else {
            var printWin = window.open('', '_blank');
            if (printWin) {
                printWin.document.open();
                printWin.document.write(printHTML);
                printWin.document.close();
                printWin.onload = function () {
                    printWin.focus();
                    setTimeout(function() { printWin.print(); }, 250);
                };
            }
        }
    } catch (error) {
        console.error('خطأ في طباعة كشف الحساب:', error);
        alert('حدث خطأ أثناء محاولة طباعة كشف الحساب.');
    }
}

function exportCustomerStatementPDF(customerName) {
    alert("للتصدير كملف PDF، يرجى اختيار 'حفظ كـ PDF' أو 'Print to PDF' من خيارات الطباعة.");
    printCustomerStatement(customerName);
}

// =========================================================================
// ============== دوال قسم التقارير (Reports Functions) ===================
// =========================================================================

function setReportDateRange(preset) {
    var today = new Date();
    var startDateInput = document.getElementById('reportStartDate');
    var endDateInput = document.getElementById('reportEndDate');
    
    var startDate = new Date();
    
    switch(preset) {
        case 'today': startDate = new Date(today); break;
        case 'week': startDate = new Date(today); startDate.setDate(today.getDate() - 7); break;
        case 'month': startDate = new Date(today); startDate.setMonth(today.getMonth() - 1); break;
        case 'year': startDate = new Date(today); startDate.setFullYear(today.getFullYear() - 1); break;
    }
    
    try {
        startDateInput.value = startDate.toISOString().split('T')[0];
        endDateInput.value = today.toISOString().split('T')[0];
    } catch (e) {
        console.error("خطأ في ضبط تاريخ التقرير:", e);
    }
}

async function generateReport() {
    var startDate = document.getElementById('reportStartDate').value;
    var endDate = document.getElementById('reportEndDate').value;
    
    if (!startDate || !endDate) return alert('يرجى تحديد تاريخ البداية والنهاية');
    
    // استخدام الكاش للتقارير
    var filteredInvoices = allInvoicesCache.filter(function(inv) {
        return inv.date >= startDate && inv.date <= endDate;
    });
    
    if (filteredInvoices.length === 0) {
        document.getElementById('report-results').style.display = 'none';
        document.getElementById('no-report-data').style.display = 'block';
        return;
    }
    
    document.getElementById('no-report-data').style.display = 'none';
    document.getElementById('report-results').style.display = 'block';
    
    var totalSales = filteredInvoices.reduce(function(sum, inv) { return sum + (inv.total || 0); }, 0);
    var totalPayments = filteredInvoices.reduce(function(sum, inv) { return sum + (inv.payment || 0); }, 0);
    var totalRemaining = filteredInvoices.reduce(function(sum, inv) {
        var remaining = (inv.total || 0) + (inv.previousBalance || 0) - (inv.payment || 0);
        return sum + remaining;
    }, 0);
    
    var avgInvoice = totalSales / filteredInvoices.length;
    
    var statsGrid = document.getElementById('sales-stats-grid');
    statsGrid.innerHTML = 
        '<div class="report-stat-card primary"><div class="value">' + formatCurrency(filteredInvoices.length) + '</div><div class="label">عدد الفواتير</div></div>' +
        '<div class="report-stat-card success"><div class="value">' + formatCurrency(totalSales) + '</div><div class="label">إجمالي المبيعات (دينار)</div></div>' +
        '<div class="report-stat-card accent"><div class="value">' + formatCurrency(totalPayments) + '</div><div class="label">إجمالي المدفوعات (دينار)</div></div>' +
        '<div class="report-stat-card danger"><div class="value">' + formatCurrency(totalRemaining) + '</div><div class="label">إجمالي المتبقي (دينار)</div></div>' +
        '<div class="report-stat-card primary"><div class="value">' + formatCurrency(avgInvoice) + '</div><div class="label">متوسط الفاتورة (دينار)</div></div>';
    
    var productStats = {};
    filteredInvoices.forEach(function(inv) {
        (inv.items || []).forEach(function(item) {
            if (!productStats[item.product]) {
                productStats[item.product] = { quantity: 0, total: 0, invoiceCount: 0 };
            }
            productStats[item.product].quantity += item.quantity || 0;
            productStats[item.product].total += item.total || 0;
            productStats[item.product].invoiceCount++;
        });
    });
    
    var topProducts = Object.entries(productStats)
        .sort(function(a, b) { return b[1].total - a[1].total; })
        .slice(0, 10);
    
    var topProductsBody = document.getElementById('top-products-body');
    topProductsBody.innerHTML = topProducts.map(function(item, idx) {
        return '<tr><td>' + toEnglishNumbers(idx + 1) + '</td><td style="text-align:right;">' + item[0] + '</td><td>' + toEnglishNumbers(item[1].quantity) + '</td><td>' + formatCurrency(item[1].total) + '</td><td>' + toEnglishNumbers(item[1].invoiceCount) + '</td></tr>';
    }).join('');
    
    var customerStats = {};
    filteredInvoices.forEach(function(inv) {
        if (!customerStats[inv.customer]) {
            customerStats[inv.customer] = { 
                total: 0, 
                invoiceCount: 0, 
                payment: 0, 
                previousBalance: 0, 
                latestId: 0 // متغير لنحفظ فيه رقم أحدث فاتورة لهذا الزبون
            };
        }
        
        customerStats[inv.customer].total += inv.total || 0;
        customerStats[inv.customer].payment += inv.payment || 0;
        customerStats[inv.customer].previousBalance += inv.previousBalance || 0;
        customerStats[inv.customer].invoiceCount++;

        // شرط مهم: تحديث رقم الفاتورة إذا كانت هذه الفاتورة أحدث (رقمها أكبر)
        if (inv.id > customerStats[inv.customer].latestId) {
            customerStats[inv.customer].latestId = inv.id;
        }
    });
    
    var topCustomers = Object.entries(customerStats)
    .sort(function(a, b) { 
        return b[1].latestId - a[1].latestId; 
    })
    .slice(0, 50)
    
    var topCustomersBody = document.getElementById('top-customers-body');
    topCustomersBody.innerHTML = topCustomers.map(function(item, idx) {
        var customerName = item[0];

        // جلب أحدث فاتورة لحساب المتبقي الحقيقي
        var customerInvoices = allInvoicesCache.filter(function(inv) { 
            return inv.customer === customerName; 
        }).sort(function(a, b) { return b.id - a.id; });

        var latestInvoice = customerInvoices[0];
        var finalRemaining = 0;

        if (latestInvoice) {
            // المعادلة: (إجمالي الفاتورة + السابق) - الواصل
            finalRemaining = (latestInvoice.total + latestInvoice.previousBalance) - latestInvoice.payment;
        }
        
        var remainingColor = finalRemaining > 0 ? 'var(--danger-color)' : 'var(--success-color)';

        return '<tr>' +
            '<td>' + toEnglishNumbers(idx + 1) + '</td>' +
            '<td style="text-align:right; font-weight:bold;">' + customerName + '</td>' +
            '<td>' + toEnglishNumbers(item[1].invoiceCount) + '</td>' +
            '<td style="color:var(--primary-dark);">' + formatCurrency(item[1].total) + '</td>' +
            '<td style="color:var(--success-color); font-weight:bold;">' + formatCurrency(item[1].payment) + '</td>' +
            '<td style="color:' + remainingColor + '; font-weight:900; background-color:#fff1f2;">' + formatCurrency(finalRemaining) + '</td>' +
            '</tr>';
    }).join('');
    
    var daysDiff = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24));
    var previousStartDate = new Date(startDate);
    previousStartDate.setDate(previousStartDate.getDate() - daysDiff);
    var previousEndDate = new Date(startDate);
    previousEndDate.setDate(previousEndDate.getDate() - 1);
    
    var previousInvoices = allInvoicesCache.filter(function(inv) {
        return inv.date >= previousStartDate.toISOString().split('T')[0] && 
               inv.date <= previousEndDate.toISOString().split('T')[0];
    });
    
    var prevTotal = previousInvoices.reduce(function(sum, inv) { return sum + (inv.total || 0); }, 0);
    var salesChange = prevTotal > 0 ? ((totalSales - prevTotal) / prevTotal * 100) : (totalSales > 0 ? 100 : 0);
    var invoiceChange = previousInvoices.length > 0 ? 
        ((filteredInvoices.length - previousInvoices.length) / previousInvoices.length * 100) : (filteredInvoices.length > 0 ? 100 : 0);
    
    var performanceContent = document.getElementById('performance-analysis-content');
    performanceContent.innerHTML = 
        '<div class="performance-item">' +
            '<div class="trend ' + (salesChange > 0 ? 'up' : salesChange < 0 ? 'down' : 'stable') + '">' +
                (salesChange > 0 ? '↗' : salesChange < 0 ? '↘' : '→') + ' ' + formatCurrency(Math.abs(salesChange)) + '%' +
            '</div>' +
            '<div class="label">تغير المبيعات</div>' +
        '</div>' +
        '<div class="performance-item">' +
            '<div class="trend ' + (invoiceChange > 0 ? 'up' : invoiceChange < 0 ? 'down' : 'stable') + '">' +
                (invoiceChange > 0 ? '↗' : invoiceChange < 0 ? '↘' : '→') + ' ' + formatCurrency(Math.abs(invoiceChange)) + '%' +
            '</div>' +
            '<div class="label">تغير عدد الفواتير</div>' +
        '</div>';
    
    currentReportData = { 
        filteredInvoices: filteredInvoices, 
        startDate: startDate, 
        endDate: endDate, 
        totalSales: totalSales, 
        totalPayments: totalPayments, 
        totalRemaining: totalRemaining 
    };
}

function shareReportText() {
    if (!currentReportData || !currentReportData.filteredInvoices) return alert('يرجى إنشاء تقرير أولاً');
    
    var reportData = currentReportData;
    var reportText = '📊 *تقرير المبيعات*\n📅 الفترة: ' + toEnglishNumbers(reportData.startDate) + ' - ' + toEnglishNumbers(reportData.endDate) + '\n━━━━━━━━━━━━━━━━━━━\n📋 عدد الفواتير: ' + toEnglishNumbers(reportData.filteredInvoices.length) + '\n💰 إجمالي المبيعات: ' + formatCurrency(reportData.totalSales) + ' دينار\n✅ إجمالي المدفوعات: ' + formatCurrency(reportData.totalPayments) + ' دينار\n❌ إجمالي المتبقي: ' + formatCurrency(reportData.totalRemaining) + ' دينار\n━━━━━━━━━━━━━━━━━━━\nمحلات ابو جعفر الرديني';
    
    if (window.plugins && window.plugins.socialsharing) {
        window.plugins.socialsharing.share(reportText);
    } else {
        navigator.clipboard.writeText(reportText).then(function() { showSuccess('تم النسخ'); });
    }
}

function printFullReport() {
    if (!currentReportData || !currentReportData.filteredInvoices) return alert('يرجى إنشاء تقرير أولاً');
    
    var reportHTML = document.getElementById('report-results').innerHTML;
    var printHTML = '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>تقرير المبيعات</title><style>@import url(\'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap\');body{font-family:\'Cairo\',sans-serif;padding:20px;}h2,h3{color:#5B8DEF;}.report-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:15px;margin:20px 0;}.report-stat-card{background:#F0F4FF;padding:15px;border-radius:8px;text-align:center;}.report-stat-card .value{font-size:1.5rem;font-weight:700;}.report-stat-card .label{color:#7F8C8D;}th,td{border:1px solid #E2E8F0;padding:8px;text-align:center;}th{background:#5B8DEF;color:white;}@media print{body{-webkit-print-color-adjust:exact;}}</style></head><body><h1 style="text-align:center;color:#5B8DEF;">تقرير المبيعات</h1><p style="text-align:center;">الفترة: ' + toEnglishNumbers(currentReportData.startDate) + ' - ' + toEnglishNumbers(currentReportData.endDate) + '</p><hr>' + reportHTML + '</body></html>';
    
    if (window.cordova && window.cordova.plugins && window.cordova.plugins.printer) {
        window.cordova.plugins.printer.print(printHTML, { name: 'تقرير_المبيعات', orientation: 'portrait' });
    } else {
        var printWin = window.open('', '_blank');
        printWin.document.open();
        printWin.document.write(printHTML);
        printWin.document.close();
        printWin.onload = function() { printWin.focus(); printWin.print(); };
    }
}

function exportReportAsPDF() {
    alert("للتصدير كـ PDF، يرجى اختيار 'حفظ كـ PDF' أو 'Print to PDF' من خيارات الطباعة.");
    printFullReport();
}
