(function () {
    const runtimeEnv = window.__DEVASTHRA_ENV || {};
    const API_BASE = window.__API_BASE || (
        window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1' ||
            window.location.protocol === 'file:'
            ? 'http://localhost:5000'
            : window.location.origin
    );
    const supportsBrowserNotifications = 'Notification' in window && !runtimeEnv.isFileProtocol;

    const getToken = () => localStorage.getItem('DEVASTHRA_token');
    const getUser = () => {
        try { return JSON.parse(localStorage.getItem('DEVASTHRA_user')); } catch { return null; }
    };
    const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

    const escapeHtml = (v) => String(v || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const formatTime = (v) => {
        try { return new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); }
        catch { return ''; }
    };

    async function parseApiResponse(res) {
        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        const text = await res.text();

        if (!contentType.includes('application/json')) {
            if (/^\s*</.test(text)) {
                throw new Error('Support chat API returned HTML instead of JSON. Check that /support is proxied to the backend.');
            }
            throw new Error('Support chat API returned a non-JSON response.');
        }

        try { return JSON.parse(text); }
        catch { throw new Error('Support chat API returned invalid JSON.'); }
    }

    function showOfflineMessage() {
        const body = document.getElementById('dcBody');
        if (!body) return;
        body.innerHTML = `<div class="dc-error">You are offline. Support chat will reconnect when your network is back.</div>`;
    }

    const injectStyles = () => {
        if (document.getElementById('devasthra-chat-styles')) return;
        const style = document.createElement('style');
        style.id = 'devasthra-chat-styles';
        style.textContent = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600&family=Inter:wght@300;400;500;600&display=swap');
:root{--dc-panel:#fff;--dc-border:rgba(107,15,43,.08);--dc-surface:#f8f2ed;--dc-accent:#700823;--dc-accent-light:#8b1a3a;--dc-accent-muted:rgba(107,15,43,.05);--dc-gold:#c9a96e;--dc-text:#1a1410;--dc-muted:#8a7e74;--dc-soft:#5c534a;--dc-font-d:'Playfair Display',Georgia,serif;--dc-font-b:'Inter',system-ui,sans-serif;}
.dc-widget *{box-sizing:border-box;margin:0;padding:0;}

/* Trigger */
.dc-trigger{position:fixed;bottom:28px;right:28px;z-index:9998;display:flex;align-items:center;gap:11px;padding:14px 22px 14px 16px;background:linear-gradient(135deg,rgba(107,15,43,.96),rgba(139,26,58,.92));border:1px solid rgba(201,169,110,.22);border-radius:999px;cursor:pointer;font-family:var(--dc-font-b);font-size:13.5px;font-weight:600;color:#fff;letter-spacing:.03em;transition:all .35s cubic-bezier(.16,1,.3,1);box-shadow:0 8px 28px rgba(74,10,30,.3),0 2px 8px rgba(0,0,0,.1);outline:none;}
.dc-trigger:hover{box-shadow:0 12px 36px rgba(74,10,30,.4),0 4px 14px rgba(0,0,0,.12);transform:translateY(-3px);}
.dc-trigger:active{transform:translateY(-1px);}
.dc-trigger-icon{width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.16);display:flex;align-items:center;justify-content:center;flex-shrink:0;position:relative;border:1px solid rgba(255,255,255,.1);}
.dc-trigger-icon svg{width:15px;height:15px;fill:#fff;opacity:.9;}
.dc-trigger-dot{width:8px;height:8px;background:#4ade80;border-radius:50%;position:absolute;top:-2px;right:-2px;border:2px solid rgba(107,15,43,.96);animation:dc-pulse 2.5s infinite;}
.dc-notif-badge{position:absolute;top:-8px;right:-8px;min-width:20px;height:20px;padding:0 6px;background:#ef4444;border-radius:10px;border:2.5px solid #fff;font-family:var(--dc-font-b);font-size:11px;font-weight:700;color:#fff;display:flex;align-items:center;justify-content:center;animation:dc-badge-pop .35s cubic-bezier(.16,1,.3,1) both;pointer-events:none;}
@keyframes dc-badge-pop{from{transform:scale(0);opacity:0}to{transform:scale(1);opacity:1}}

/* Toast */
.dc-notif-toast{position:fixed;bottom:100px;right:28px;z-index:9997;max-width:320px;background:#fff;border:1px solid rgba(107,15,43,.1);border-radius:16px;padding:16px 18px;box-shadow:0 20px 50px rgba(74,10,30,.14),0 4px 12px rgba(0,0,0,.05);font-family:var(--dc-font-b);cursor:pointer;animation:dc-toast-in .45s cubic-bezier(.16,1,.3,1) both;display:flex;align-items:flex-start;gap:12px;}
@keyframes dc-toast-in{from{opacity:0;transform:translateY(14px) scale(.95)}to{opacity:1;transform:translateY(0) scale(1)}}
.dc-notif-toast.out{animation:dc-toast-out .3s ease forwards;}
@keyframes dc-toast-out{to{opacity:0;transform:translateY(10px) scale(.95)}}
.dc-notif-toast-avatar{width:38px;height:38px;border-radius:50%;flex-shrink:0;background:linear-gradient(135deg,#700823,#8b1a3a);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(107,15,43,.18);}
.dc-notif-toast-avatar svg{width:16px;height:16px;fill:#fff;}
.dc-notif-toast-body{flex:1;min-width:0;}
.dc-notif-toast-title{font-size:11px;color:var(--dc-accent);font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px;}
.dc-notif-toast-text{font-size:13.5px;color:var(--dc-soft);line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.dc-notif-toast-close{background:none;border:none;color:var(--dc-muted);font-size:18px;cursor:pointer;flex-shrink:0;padding:0;line-height:1;transition:color .2s;}
.dc-notif-toast-close:hover{color:var(--dc-text);}

/* Panel */
.dc-panel{position:fixed;bottom:90px;right:28px;z-index:9999;width:390px;height:580px;max-height:calc(100dvh - 120px);background:var(--dc-panel);border:1px solid rgba(107,15,43,.08);border-radius:24px;box-shadow:0 32px 80px rgba(74,10,30,.12),0 12px 32px rgba(0,0,0,.06);display:flex;flex-direction:column;overflow:hidden;font-family:var(--dc-font-b);opacity:0;transform:translateY(18px) scale(.96);pointer-events:none;transition:opacity .4s cubic-bezier(.16,1,.3,1),transform .4s cubic-bezier(.16,1,.3,1);}
.dc-panel.open{opacity:1;transform:translateY(0) scale(1);pointer-events:all;}

/* Header */
.dc-header{padding:20px 22px 16px;border-bottom:1px solid rgba(107,15,43,.06);display:flex;align-items:flex-start;justify-content:space-between;flex-shrink:0;background:linear-gradient(180deg,rgba(107,15,43,.03) 0%,transparent 100%);position:relative;overflow:hidden;}
.dc-header::before{content:'';position:absolute;top:-50px;right:-50px;width:140px;height:140px;border-radius:50%;background:radial-gradient(circle,rgba(201,169,110,.06),transparent 70%);pointer-events:none;}
.dc-header-left{display:flex;align-items:center;gap:12px;}
.dc-avatar{width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#700823,#8b1a3a);display:flex;align-items:center;justify-content:center;flex-shrink:0;position:relative;box-shadow:0 3px 10px rgba(107,15,43,.18);}
.dc-avatar svg{width:18px;height:18px;fill:#fff;}
.dc-avatar-status{position:absolute;bottom:0;right:0;width:12px;height:12px;background:#4ade80;border-radius:50%;border:2.5px solid var(--dc-panel);}
.dc-brand{font-family:var(--dc-font-d);font-size:15px;font-weight:600;color:var(--dc-accent);letter-spacing:.06em;text-transform:uppercase;}
.dc-tagline{font-size:12px;color:var(--dc-muted);font-weight:400;margin-top:2px;}
.dc-online{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:#16a34a;margin-top:4px;font-weight:500;}
.dc-online span{width:5px;height:5px;background:#16a34a;border-radius:50%;animation:dc-pulse 2.5s infinite;}
.dc-close{width:32px;height:32px;border-radius:50%;background:transparent;border:1px solid rgba(107,15,43,.08);color:var(--dc-muted);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s;flex-shrink:0;margin-top:2px;}
.dc-close:hover{background:rgba(107,15,43,.04);border-color:rgba(107,15,43,.16);color:var(--dc-accent);}

/* Body */
.dc-body{flex:1;overflow-y:auto;padding:18px 16px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth;background:#fdfbf9;}
.dc-body::-webkit-scrollbar{width:4px;}
.dc-body::-webkit-scrollbar-thumb{background:rgba(107,15,43,.1);border-radius:2px;}

/* Messages */
.dc-msg{display:flex;flex-direction:column;max-width:82%;animation:dc-msgIn .35s cubic-bezier(.16,1,.3,1) both;}
.dc-msg.user{align-self:flex-end;align-items:flex-end;}
.dc-msg.support{align-self:flex-start;align-items:flex-start;}
@keyframes dc-msgIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.dc-bubble{padding:12px 16px;border-radius:18px;font-size:14px;line-height:1.6;word-break:break-word;}
.dc-msg.user .dc-bubble{background:linear-gradient(135deg,#700823,#8b1a3a);color:#fff;border-radius:18px 18px 4px 18px;box-shadow:0 2px 8px rgba(107,15,43,.12);}
.dc-msg.support .dc-bubble{background:#fff;color:var(--dc-text);border:1px solid rgba(107,15,43,.07);border-radius:4px 18px 18px 18px;box-shadow:0 1px 4px rgba(0,0,0,.03);}
.dc-msg.support.dc-unread .dc-bubble{border-color:rgba(201,169,110,.3);background:#fffbf3;box-shadow:0 0 0 1px rgba(201,169,110,.1);}
.dc-time{font-size:10.5px;color:var(--dc-muted);margin-top:4px;padding:0 4px;}

/* Intro */
.dc-intro{background:#f9f4ef;border:1px solid rgba(107,15,43,.06);border-radius:16px;padding:18px;margin-bottom:4px;}
.dc-intro-title{font-family:var(--dc-font-d);font-size:17px;font-weight:500;color:var(--dc-accent);margin-bottom:6px;}
.dc-intro-text{font-size:13px;color:var(--dc-soft);line-height:1.6;}
.dc-quick-btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;}
.dc-quick-btn{padding:8px 14px;background:#fff;border:1px solid rgba(107,15,43,.12);border-radius:999px;font-family:var(--dc-font-b);font-size:12px;font-weight:500;color:var(--dc-accent);cursor:pointer;transition:all .25s;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.03);}
.dc-quick-btn:hover{background:rgba(107,15,43,.04);border-color:rgba(107,15,43,.2);transform:translateY(-1px);box-shadow:0 3px 8px rgba(107,15,43,.08);}

/* Divider */
.dc-divider{display:flex;align-items:center;gap:10px;margin:6px 0;}
.dc-divider-line{flex:1;height:1px;background:rgba(107,15,43,.05);}
.dc-divider-text{font-size:10.5px;color:var(--dc-muted);letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;font-weight:500;}

/* Typing */
.dc-typing{display:inline-flex;align-items:center;gap:4px;padding:12px 16px;background:#fff;border:1px solid rgba(107,15,43,.06);border-radius:4px 18px 18px 18px;box-shadow:0 1px 4px rgba(0,0,0,.03);}
.dc-typing-dot{width:5px;height:5px;background:var(--dc-accent);border-radius:50%;opacity:.35;animation:dc-bounce 1.3s infinite ease-in-out;}
.dc-typing-dot:nth-child(2){animation-delay:.2s;}
.dc-typing-dot:nth-child(3){animation-delay:.4s;}
@keyframes dc-bounce{0%,80%,100%{transform:translateY(0);opacity:.3}40%{transform:translateY(-5px);opacity:.85}}

/* Loading & Error */
.dc-loading{display:flex;align-items:center;gap:10px;padding:16px;color:var(--dc-muted);font-size:13px;font-style:italic;}
.dc-spinner{width:16px;height:16px;border:2px solid rgba(107,15,43,.1);border-top-color:var(--dc-accent);border-radius:50%;animation:dc-spin .7s linear infinite;flex-shrink:0;}
@keyframes dc-spin{to{transform:rotate(360deg)}}
.dc-error{padding:11px 14px;background:rgba(220,60,60,.05);border:1px solid rgba(220,60,60,.12);border-radius:12px;font-size:13px;color:#dc2626;}

/* Auth State */
.dc-auth-state{display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;padding:36px 24px;gap:14px;text-align:center;}
.dc-auth-icon{width:60px;height:60px;border-radius:50%;background:rgba(107,15,43,.06);border:1px solid rgba(107,15,43,.1);display:flex;align-items:center;justify-content:center;margin-bottom:4px;}
.dc-auth-icon svg{width:26px;height:26px;fill:var(--dc-accent);}
.dc-auth-title{font-family:var(--dc-font-d);font-size:19px;color:var(--dc-text);font-weight:500;}
.dc-auth-desc{font-size:13px;color:var(--dc-muted);line-height:1.65;max-width:260px;}
.dc-login-btn{margin-top:8px;padding:14px 30px;background:linear-gradient(135deg,#700823,#8b1a3a);border:none;border-radius:999px;font-family:var(--dc-font-b);font-size:14px;font-weight:600;color:#fff;cursor:pointer;letter-spacing:.04em;transition:all .3s cubic-bezier(.16,1,.3,1);box-shadow:0 6px 20px rgba(107,15,43,.22);}
.dc-login-btn:hover{transform:translateY(-2px);box-shadow:0 10px 32px rgba(107,15,43,.3);}

/* Form */
.dc-form{flex-shrink:0;padding:12px 14px;border-top:1px solid rgba(107,15,43,.05);display:flex;align-items:flex-end;gap:10px;background:#fdfbf9;}
.dc-form-input-wrap{flex:1;background:#fff;border:1px solid rgba(107,15,43,.08);border-radius:16px;padding:10px 14px;transition:border-color .25s,box-shadow .25s;}
.dc-form-input-wrap:focus-within{border-color:rgba(107,15,43,.22);box-shadow:0 0 0 3px rgba(107,15,43,.04);}
.dc-textarea{width:100%;background:transparent;border:none;outline:none;resize:none;font-family:var(--dc-font-b);font-size:14px;color:var(--dc-text);line-height:1.5;max-height:100px;}
.dc-textarea::placeholder{color:var(--dc-muted);}
.dc-textarea::-webkit-scrollbar{width:0;}
.dc-send-btn{width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#700823,#8b1a3a);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .25s cubic-bezier(.16,1,.3,1);box-shadow:0 3px 12px rgba(107,15,43,.2);}
.dc-send-btn:hover{transform:scale(1.08);box-shadow:0 6px 20px rgba(107,15,43,.3);}
.dc-send-btn:active{transform:scale(.94);}
.dc-send-btn svg{width:16px;height:16px;fill:#fff;margin-left:2px;}
@keyframes dc-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.8)}}

/* Mobile */
@media(max-width:640px){.dc-notif-toast{right:14px;left:14px;bottom:82px;max-width:none;}.dc-panel{right:12px;left:12px;width:auto;bottom:82px;height:min(520px,70dvh);max-height:min(520px,70dvh);border-radius:20px;}.dc-trigger{right:16px;bottom:16px;padding:12px 18px 12px 14px;font-size:12.5px;gap:9px;}.dc-trigger-icon{width:26px;height:26px;}.dc-trigger-icon svg{width:13px;height:13px;}.dc-header{padding:16px;}.dc-header-left{gap:10px;}.dc-avatar{width:36px;height:36px;}.dc-avatar svg{width:16px;height:16px;}.dc-brand{font-size:13px;}.dc-tagline{font-size:10.5px;}.dc-online{font-size:10px;}.dc-body{padding:14px 12px;}.dc-form{padding:10px 12px;gap:8px;}.dc-textarea{font-size:13px;}.dc-bubble{font-size:13px;padding:10px 13px;}.dc-auth-state{padding:24px 18px;gap:10px;}.dc-auth-desc{font-size:12px;max-width:230px;}.dc-login-btn{padding:12px 22px;font-size:13px;}}
        `;
        document.head.appendChild(style);
    };

    let pollTimer = null;
    let widgetReady = false;
    let isSending = false;
    let lastSeenMsgId = null;
    let lastKnownCount = 0;
    let panelOpen = false;
    let unreadCount = 0;
    let notificationPromptAttempted = false;

    /* ── Notification helpers ── */
    function requestNotifPermission() {
        if (!supportsBrowserNotifications || notificationPromptAttempted || Notification.permission !== 'default') {
            return;
        }
        notificationPromptAttempted = true;
        Notification.requestPermission().catch(() => {});
    }

    function showBrowserNotif(text) {
        if (supportsBrowserNotifications && Notification.permission === 'granted') {
            new Notification('DEVASTHRA Support replied', {
                body: text,
                icon: `${API_BASE}/backend/images/Fashion%20logo.jfif`
            });
        }
    }

    function updateTriggerBadge(count) {
        const trigger = document.getElementById('dcTrigger');
        if (!trigger) return;
        let badge = trigger.querySelector('.dc-notif-badge');
        if (count > 0) {
            if (!badge) { badge = document.createElement('div'); badge.className = 'dc-notif-badge'; trigger.appendChild(badge); }
            badge.textContent = count > 9 ? '9+' : count;
        } else {
            badge?.remove();
        }
    }

    function showToastNotif(messageText) {
        document.querySelector('.dc-notif-toast')?.remove();
        const toast = document.createElement('div');
        toast.className = 'dc-notif-toast';
        toast.innerHTML = `
            <div class="dc-notif-toast-avatar"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
            <div class="dc-notif-toast-body">
                <div class="dc-notif-toast-title">DEVASTHRA Support</div>
                <div class="dc-notif-toast-text">${escapeHtml(messageText)}</div>
            </div>
            <button class="dc-notif-toast-close" aria-label="Dismiss">×</button>
        `;
        document.body.appendChild(toast);
        toast.addEventListener('click', (e) => {
            dismissToast(toast);
            if (!e.target.classList.contains('dc-notif-toast-close')) openPanel();
        });
        setTimeout(() => dismissToast(toast), 6000);
    }

    function dismissToast(toast) {
        if (!toast?.parentNode) return;
        toast.classList.add('out');
        setTimeout(() => toast.remove(), 300);
    }

    /* ── Widget DOM ── */
    function ensureWidget() {
        if (widgetReady) return;
        widgetReady = true;
        injectStyles();

        const wrapper = document.createElement('div');
        wrapper.className = 'dc-widget';
        wrapper.innerHTML = `
            <button class="dc-trigger" id="dcTrigger" type="button" aria-label="Open DEVASTHRA support chat">
                <div class="dc-trigger-icon"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><div class="dc-trigger-dot"></div></div>
                <span>Chat with Us</span>
            </button>
            <div class="dc-panel" id="dcPanel" role="dialog" aria-hidden="true">
                <div class="dc-header">
                    <div class="dc-header-left">
                        <div class="dc-avatar">
                            <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                            <div class="dc-avatar-status"></div>
                        </div>
                        <div>
                            <div class="dc-brand">DEVASTHRA</div>
                            <div class="dc-tagline">Customer Support</div>
                            <div class="dc-online"><span></span>Online &mdash; replies in minutes</div>
                        </div>
                    </div>
                    <button class="dc-close" id="dcClose" type="button" aria-label="Close">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1L11 11M11 1L1 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                    </button>
                </div>
                <div class="dc-body" id="dcBody"></div>
                <div class="dc-form" id="dcForm" style="display:none;">
                    <div class="dc-form-input-wrap">
                        <textarea class="dc-textarea" id="dcInput" rows="1" placeholder="Ask about sizing, orders, styling…" maxlength="1000"></textarea>
                    </div>
                    <button class="dc-send-btn" id="dcSend" type="button" aria-label="Send">
                        <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(wrapper);

        const input = document.getElementById('dcInput');
        input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 100) + 'px'; });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } });
        document.getElementById('dcTrigger').addEventListener('click', () => {
            requestNotifPermission();
            panelOpen ? closePanel() : openPanel();
        });
        document.getElementById('dcClose').addEventListener('click', closePanel);
        document.getElementById('dcSend').addEventListener('click', () => {
            requestNotifPermission();
            handleSend();
        });
        document.addEventListener('click', (e) => {
            const panel = document.getElementById('dcPanel');
            const trigger = document.getElementById('dcTrigger');
            if (panelOpen && !panel.contains(e.target) && !trigger.contains(e.target)) closePanel();
        });

        startBackgroundPolling();
    }

    function openPanel() {
        const panel = document.getElementById('dcPanel');
        if (!panel) return;
        panelOpen = true;
        panel.classList.add('open');
        panel.setAttribute('aria-hidden', 'false');
        unreadCount = 0;
        updateTriggerBadge(0);
        loadConversation();
        setTimeout(() => document.getElementById('dcInput')?.focus(), 350);
    }

    function closePanel() {
        const panel = document.getElementById('dcPanel');
        if (!panel) return;
        panelOpen = false;
        panel.classList.remove('open');
        panel.setAttribute('aria-hidden', 'true');
    }

    function showLoggedOutState() {
        const body = document.getElementById('dcBody');
        const form = document.getElementById('dcForm');
        if (!body || !form) return;
        form.style.display = 'none';
        body.innerHTML = `
            <div class="dc-auth-state">
                <div class="dc-auth-icon"><svg viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg></div>
                <div class="dc-auth-title">Welcome to DEVASTHRA</div>
                <div class="dc-auth-desc">Sign in to chat with our support team about sizing, orders, or product recommendations.</div>
                <button class="dc-login-btn" id="dcLoginBtn" type="button">Login to Continue</button>
            </div>
        `;
        document.getElementById('dcLoginBtn')?.addEventListener('click', () => {
            const ex = document.getElementById('loginBtn') || document.getElementById('mobileLoginBtn');
            if (ex) { ex.click(); return; }
            window.location.href = 'index.html';
        });
    }

    function renderMessages(messages, unreadFromId) {
        const body = document.getElementById('dcBody');
        const form = document.getElementById('dcForm');
        if (!body || !form) return;
        form.style.display = 'flex';
        const user = getUser();
        const firstName = user?.name ? escapeHtml(user.name.split(' ')[0]) : null;
        const quickActions = [];
        let html = `
            <div class="dc-intro">
                <div class="dc-intro-title">${firstName ? `Hello, ${firstName} 👋` : 'Hello there 👋'}</div>
                <div class="dc-intro-text">Our support team is here to help with your order, find the perfect fit, or guide you through our collections.</div>
                <div class="dc-quick-btns">${quickActions.map(a => `<button class="dc-quick-btn" data-msg="${escapeHtml(a.msg)}">${escapeHtml(a.label)}</button>`).join('')}</div>
            </div>
        `;
        if (messages?.length) {
            html += `<div class="dc-divider"><div class="dc-divider-line"></div><div class="dc-divider-text">Conversation history</div><div class="dc-divider-line"></div></div>`;
            html += messages.map((msg, i) => {
                const isUnread = unreadFromId && msg.id >= unreadFromId && msg.sender_type !== 'user';
                return `<div class="dc-msg ${msg.sender_type === 'user' ? 'user' : 'support'}${isUnread ? ' dc-unread' : ''}" style="animation-delay:${i * 0.04}s"><div class="dc-bubble">${escapeHtml(msg.message)}</div><div class="dc-time">${formatTime(msg.created_at)}</div></div>`;
            }).join('');
        }
        body.innerHTML = html;
        body.querySelectorAll('.dc-quick-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const inp = document.getElementById('dcInput');
                if (inp) { inp.value = btn.dataset.msg; inp.dispatchEvent(new Event('input')); inp.focus(); }
            });
        });
        body.scrollTop = body.scrollHeight;
    }

    async function loadConversation() {
        const body = document.getElementById('dcBody');
        if (!body) return;
        if (!getToken()) { showLoggedOutState(); return; }
        if (isOffline()) { showOfflineMessage(); return; }
        body.innerHTML = `<div class="dc-loading"><div class="dc-spinner"></div>Opening your conversation…</div>`;
        try {
            const res = await fetch(`${API_BASE}/support/conversation`, { headers: { Authorization: `Bearer ${getToken()}` } });
            const data = await parseApiResponse(res);
            if (!data.success) {
                if (res.status === 401 || res.status === 403) { localStorage.removeItem('DEVASTHRA_token'); localStorage.removeItem('DEVASTHRA_user'); showLoggedOutState(); return; }
                throw new Error(data.message || 'Unable to load chat');
            }
            const msgs = data.messages || [];
            if (msgs.length) lastSeenMsgId = msgs[msgs.length - 1].id;
            lastKnownCount = msgs.length;
            renderMessages(msgs, null);
        } catch (err) {
            body.innerHTML = `<div class="dc-error">${escapeHtml(err.message || 'Unable to load chat right now.')}</div>`;
        }
    }

    /* Background poll runs always — even when panel is closed */
    function startBackgroundPolling() {
        if (pollTimer) return;
        pollTimer = setInterval(async () => {
            if (!getToken()) return;
            if (isOffline()) return;
            try {
                const res = await fetch(`${API_BASE}/support/conversation`, { headers: { Authorization: `Bearer ${getToken()}` } });
                const data = await parseApiResponse(res);
                if (!data.success) return;
                const msgs = data.messages || [];
                const newSupportMsgs = msgs.filter(m => m.sender_type !== 'user' && (!lastSeenMsgId || m.id > lastSeenMsgId));

                if (newSupportMsgs.length > 0) {
                    if (panelOpen) {
                        renderMessages(msgs, newSupportMsgs[0].id);
                        if (msgs.length) lastSeenMsgId = msgs[msgs.length - 1].id;
                    } else {
                        unreadCount += newSupportMsgs.length;
                        updateTriggerBadge(unreadCount);
                        showToastNotif(newSupportMsgs[newSupportMsgs.length - 1].message);
                        showBrowserNotif(newSupportMsgs[newSupportMsgs.length - 1].message);
                        if (msgs.length) lastSeenMsgId = msgs[msgs.length - 1].id;
                    }
                } else if (panelOpen && msgs.length !== lastKnownCount) {
                    renderMessages(msgs, null);
                }
                lastKnownCount = msgs.length;
            } catch { /* silent */ }
        }, 7000);
    }

    async function handleSend() {
        if (isSending) return;
        const input = document.getElementById('dcInput');
        const message = input?.value?.trim();
        if (!message) return;
        isSending = true;
        input.value = ''; input.style.height = 'auto';
        const body = document.getElementById('dcBody');
        if (body) {
            const div = document.createElement('div');
            div.className = 'dc-msg user';
            div.innerHTML = `<div class="dc-bubble">${escapeHtml(message)}</div><div class="dc-time">${formatTime(new Date())}</div>`;
            body.appendChild(div);
            const typing = document.createElement('div');
            typing.className = 'dc-msg support'; typing.id = 'dcTyping';
            typing.innerHTML = `<div class="dc-typing"><div class="dc-typing-dot"></div><div class="dc-typing-dot"></div><div class="dc-typing-dot"></div></div>`;
            body.appendChild(typing);
            body.scrollTop = body.scrollHeight;
        }
        try {
            if (isOffline()) {
                throw new Error('You are offline. Please reconnect and try again.');
            }
            const res = await fetch(`${API_BASE}/support/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` }, body: JSON.stringify({ message }) });
            const data = await parseApiResponse(res);
            if (!data.success) throw new Error(data.message || 'Failed to send');
            document.getElementById('dcTyping')?.remove();
            await loadConversation();
        } catch (err) {
            document.getElementById('dcTyping')?.remove();
            if (body) {
                const e = document.createElement('div'); e.className = 'dc-error'; e.style.margin = '4px 0';
                e.textContent = err.message || 'Message failed. Try again.';
                body.appendChild(e); body.scrollTop = body.scrollHeight;
            }
        }
        isSending = false;
        input?.focus();
    }

    window.addEventListener('online', () => {
        if (panelOpen) loadConversation();
    });

    window.addEventListener('offline', () => {
        if (panelOpen) showOfflineMessage();
    });

    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', ensureWidget); }
    else { ensureWidget(); }
})();

