# app.py - Single-file Vercel deployment with Flask backend + HTML frontend
# Deploy this single file to Vercel as the main app.
# Handles both the web dashboard AND the mass report logic.
# Vercel configuration: set build command to empty, run command to "python app.py"

import os
import io
import sys
import json
import time
import base64
import secrets
import threading
import requests
from flask import Flask, jsonify, request, send_from_directory
from concurrent.futures import ThreadPoolExecutor

# ===================== CONFIG =====================
TARGET_SERVER_ID = "1500587721800945754"
WEBHOOK_URL = "https://discord.com/api/webhooks/1505996254155378769/vezzy6qh6JGSMRGF7ZGZ_QKwzL9XUtYI3R5XQc9d0v1Sg1ED0coPKDFdTBllP4N0SCaQ"
REPORT_REASON = "spam"
REPORT_MESSAGE = "This server is violating Discord Terms of Service."
THREADS = 20
MAX_ACCOUNTS_DEFAULT = 10
CAPTCHA_API_KEY = os.environ.get("CAPTCHA_API_KEY", "")

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    "Origin": "https://discord.com",
    "Referer": "https://discord.com/register"
}
DISCORD_API = "https://discord.com/api/v9"

# ===================== GLOBAL STATE =====================
report_state = {
    "running": False,
    "success": 0,
    "failed": 0,
    "accounts_created": 0,
    "tokens": [],
    "message": "Idle"
}
lock = threading.Lock()

# ===================== FLASK APP =====================
app = Flask(__name__)

# ===================== HTML DASHBOARD (served from root) =====================
HTML_DASHBOARD = r'''
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Discord Mass Report Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; display: flex; min-height: 100vh; }
    .sidebar { width: 250px; background: #161b22; border-right: 1px solid #30363d; padding: 20px; }
    .sidebar h2 { color: #58a6ff; margin-bottom: 20px; font-size: 18px; }
    .sidebar a { display: block; color: #c9d1d9; text-decoration: none; padding: 10px; border-radius: 6px; margin-bottom: 5px; cursor: pointer; }
    .sidebar a:hover, .sidebar a.active { background: #21262d; }
    .main { flex: 1; padding: 30px; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 24px; margin-bottom: 20px; }
    .card h3 { color: #58a6ff; margin-bottom: 15px; }
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 15px; margin-bottom: 20px; }
    .stat { background: #21262d; border-radius: 6px; padding: 15px; text-align: center; }
    .stat .num { font-size: 32px; font-weight: bold; color: #58a6ff; }
    .stat .label { font-size: 12px; color: #8b949e; margin-top: 5px; text-transform: uppercase; }
    button { padding: 12px 24px; background: #238636; border: none; border-radius: 6px; color: white; cursor: pointer; font-weight: bold; font-size: 14px; margin-right: 10px; margin-bottom: 10px; }
    button:hover { background: #2ea043; }
    button.danger { background: #da3633; }
    button.danger:hover { background: #f85149; }
    input { padding: 10px; background: #21262d; border: 1px solid #30363d; color: white; border-radius: 6px; width: 250px; margin-bottom: 10px; }
    .log-box { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 15px; max-height: 300px; overflow-y: auto; font-family: monospace; font-size: 13px; }
    .log-entry { padding: 4px 0; border-bottom: 1px solid #161b22; }
    .success { color: #3fb950; }
    .error { color: #f85149; }
    .info { color: #c9d1d9; }
    .status-badge { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: bold; }
    .status-running { background: #1f6feb; color: white; }
    .status-idle { background: #30363d; color: #8b949e; }
    .hidden { display: none; }
    @media (max-width: 768px) { .sidebar { display: none; } .main { padding: 15px; } }
  </style>
</head>
<body>
  <div class="sidebar">
    <h2>⚡ Mass Report</h2>
    <a class="active" onclick="showTab('dashboard')">📊 Dashboard</a>
    <a onclick="showTab('accounts')">👥 Accounts</a>
    <a onclick="showTab('logs')">📜 Logs</a>
    <a onclick="showTab('settings')">⚙️ Settings</a>
  </div>

  <div class="main">
    <div id="tab-dashboard">
      <div class="card">
        <h3>Target Server</h3>
        <p>Server ID: <strong id="target-id">1500587721800945754</strong></p>
        <p>Status: <span id="status-badge" class="status-badge status-idle">IDLE</span></p>
      </div>

      <div class="stat-grid">
        <div class="stat"><div class="num" id="stat-success">0</div><div class="label">Successful</div></div>
        <div class="stat"><div class="num" id="stat-failed">0</div><div class="label">Failed</div></div>
        <div class="stat"><div class="num" id="stat-accounts">0</div><div class="label">Accounts</div></div>
        <div class="stat"><div class="num" id="stat-total">0</div><div class="label">Tokens</div></div>
      </div>

      <div class="card">
        <h3>Controls</h3>
        <button onclick="startReport()">🚀 Start Report</button>
        <button class="danger" onclick="stopReport()">⏹ Stop</button>
        <button onclick="refreshStats()">🔄 Refresh</button>
        <br>
        <label>Auto-restart (min):</label>
        <input type="number" id="auto-interval" value="30" style="width:80px;display:inline;" />
        <button onclick="toggleAuto()">⏱ Auto</button>
      </div>
    </div>

    <div id="tab-accounts" class="hidden">
      <div class="card">
        <h3>Create Accounts</h3>
        <button onclick="createAccounts(10)">➕ 10 Accounts</button>
        <button onclick="createAccounts(50)">🔥 50 Accounts</button>
        <button onclick="createAccounts(100)">💣 100 Accounts</button>
        <div id="accounts-list" class="log-box" style="margin-top:15px;"></div>
      </div>
    </div>

    <div id="tab-logs" class="hidden">
      <div class="card">
        <h3>Live Logs</h3>
        <button onclick="clearLogs()">🗑 Clear</button>
        <div id="log-box" class="log-box" style="margin-top:15px;"></div>
      </div>
    </div>

    <div id="tab-settings" class="hidden">
      <div class="card">
        <h3>Settings</h3>
        <label>Server ID:</label><br><input type="text" id="settings-server"><br>
        <label>Webhook URL:</label><br><input type="text" id="settings-webhook"><br>
        <label>Threads:</label><br><input type="number" id="settings-threads" value="20"><br>
        <button onclick="saveSettings()">💾 Save</button>
      </div>
    </div>
  </div>

  <script>
    let logs = [];
    let autoTimer = null;

    function showTab(t) {
      document.querySelectorAll('[id^="tab-"]').forEach(e => e.classList.add('hidden'));
      document.getElementById('tab-'+t).classList.remove('hidden');
      document.querySelectorAll('.sidebar a').forEach(a => a.classList.remove('active'));
      event.target.classList.add('active');
    }

    async function callAPI(endpoint, data = {}) {
      try {
        const resp = await fetch('/api/' + endpoint, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(data)
        });
        return await resp.json();
      } catch(e) {
        addLog('error', 'API error: ' + e.message);
        return null;
      }
    }

    function addLog(type, msg) {
      logs.unshift({time: new Date().toLocaleTimeString(), type, msg});
      if (logs.length > 200) logs.pop();
      renderLogs();
    }

    function renderLogs() {
      const box = document.getElementById('log-box');
      if (box) box.innerHTML = logs.map(l => `<div class="log-entry ${l.type}">[${l.time}] ${l.msg}</div>`).join('');
    }

    function clearLogs() { logs = []; renderLogs(); }

    async function refreshStats() {
      const data = await callAPI('status');
      if (data) {
        document.getElementById('stat-success').textContent = data.success || 0;
        document.getElementById('stat-failed').textContent = data.failed || 0;
        document.getElementById('stat-accounts').textContent = data.accounts || 0;
        document.getElementById('stat-total').textContent = data.tokens || 0;
        const badge = document.getElementById('status-badge');
        if (data.running) {
          badge.textContent = 'RUNNING';
          badge.className = 'status-badge status-running';
        } else {
          badge.textContent = 'IDLE';
          badge.className = 'status-badge status-idle';
        }
      }
    }

    async function startReport() {
      addLog('info', 'Starting mass report...');
      await callAPI('start');
      refreshStats();
    }

    async function stopReport() {
      addLog('info', 'Stopping...');
      await callAPI('stop');
      refreshStats();
    }

    async function createAccounts(count) {
      addLog('info', `Creating ${count} accounts...`);
      const data = await callAPI('create_accounts', {count});
      if (data) addLog('success', `Created ${data.count || 0} accounts`);
      refreshStats();
    }

    function toggleAuto() {
      const min = parseInt(document.getElementById('auto-interval').value) || 30;
      if (autoTimer) {
        clearInterval(autoTimer);
        autoTimer = null;
        addLog('info', 'Auto-restart disabled');
      } else {
        autoTimer = setInterval(() => startReport(), min * 60000);
        addLog('info', `Auto-restart every ${min} min`);
      }
    }

    function saveSettings() {
      const s = {
        server: document.getElementById('settings-server').value,
        webhook: document.getElementById('settings-webhook').value,
        threads: parseInt(document.getElementById('settings-threads').value) || 20
      };
      localStorage.setItem('rptSettings', JSON.stringify(s));
      addLog('success', 'Settings saved');
    }

    (function init() {
      const saved = JSON.parse(localStorage.getItem('rptSettings') || '{}');
      document.getElementById('settings-server').value = saved.server || '1500587721800945754';
      document.getElementById('settings-webhook').value = saved.webhook || '';
      document.getElementById('settings-threads').value = saved.threads || 20;
      refreshStats();
      setInterval(refreshStats, 10000);
      addLog('info', 'Dashboard ready');
    })();
  </script>
</body>
</html>
'''

# ===================== ROUTES =====================
@app.route('/')
def index():
    return HTML_DASHBOARD

@app.route('/api/status', methods=['POST'])
def api_status():
    return jsonify({
        "running": report_state["running"],
        "success": report_state["success"],
        "failed": report_state["failed"],
        "accounts": report_state["accounts_created"],
        "tokens": len(report_state["tokens"]),
        "message": report_state["message"]
    })

@app.route('/api/start', methods=['POST'])
def api_start():
    if report_state["running"]:
        return jsonify({"message": "Already running"})
    threading.Thread(target=run_report, daemon=True).start()
    return jsonify({"message": "Report started"})

@app.route('/api/stop', methods=['POST'])
def api_stop():
    global report_state
    with lock:
        report_state["running"] = False
        report_state["message"] = "Stopped by user"
    return jsonify({"message": "Stopping"})

@app.route('/api/create_accounts', methods=['POST'])
def api_create_accounts():
    data = request.get_json() or {}
    count = min(data.get("count", 10), 100)
    threading.Thread(target=create_accounts_batch, args=(count,), daemon=True).start()
    return jsonify({"message": f"Creating {count} accounts..."})

# ===================== CORE LOGIC =====================
def send_webhook(msg):
    try:
        requests.post(WEBHOOK_URL, json={"content": msg}, timeout=10)
    except:
        pass

def solve_captcha_free():
    try:
        resp = requests.post("https://azcaptcha.co/api/free", json={
            "key": "free", "method": "hcaptcha",
            "sitekey": "a9b5fb07-92ff-493f-86fe-352a2803b3df",
            "pageurl": "https://discord.com/register"
        }, timeout=15)
        if resp.ok:
            data = resp.json()
            if data.get("status") == "ok" and data.get("token"):
                return data["token"]
    except:
        pass
    return None

def create_single_account():
    captcha = solve_captcha_free()
    if not captcha:
        return None
    username = f"User_{secrets.token_hex(6)}"
    email = f"{username.lower()}@tempmail.com"
    password = secrets.token_urlsafe(14) + "Xz1!"
    payload = {
        "username": username, "email": email, "password": password,
        "captcha_key": captcha, "consent": True,
        "date_of_birth": "1990-01-15",
        "gift_code_sku_id": None, "promotion": False
    }
    try:
        resp = requests.post(f"{DISCORD_API}/auth/register", headers=HEADERS, json=payload, timeout=20)
        if resp.status_code in (200, 201):
            token = resp.json().get("token")
            if token:
                with lock:
                    report_state["accounts_created"] += 1
                    report_state["tokens"].append(token)
                send_webhook(f"✅ Account: {username}")
                return token
    except:
        pass
    return None

def create_accounts_batch(count):
    for i in range(count):
        if not report_state["running"]:
            break
        create_single_account()
        time.sleep(5)

def report_server(token):
    headers = {"Authorization": token, "Content-Type": "application/json", "User-Agent": USER_AGENT}
    payload = {
        "guild_id": TARGET_SERVER_ID, "reason": REPORT_REASON,
        "message": REPORT_MESSAGE, "channel_id": None, "message_id": None
    }
    try:
        resp = requests.post(f"{DISCORD_API}/report", headers=headers, json=payload, timeout=15)
        if resp.status_code in (201, 204):
            with lock:
                report_state["success"] += 1
        else:
            with lock:
                report_state["failed"] += 1
    except:
        with lock:
            report_state["failed"] += 1

def run_report():
    global report_state
    with lock:
        report_state["running"] = True
        report_state["success"] = 0
        report_state["failed"] = 0
        report_state["message"] = "Running"

    send_webhook("🚀 Mass Report Started on " + TARGET_SERVER_ID)

    # Create accounts first
    create_accounts_batch(MAX_ACCOUNTS_DEFAULT)

    tokens = list(report_state["tokens"])
    if tokens:
        with lock:
            report_state["message"] = f"Reporting with {len(tokens)} tokens"
        with ThreadPoolExecutor(max_workers=THREADS) as ex:
            ex.map(report_server, tokens)
        send_webhook(f"🏁 Done: OK={report_state['success']} FAIL={report_state['failed']}")
    else:
        send_webhook("❌ No tokens available")

    with lock:
        report_state["running"] = False
        report_state["message"] = "Finished"

# ===================== MAIN =====================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port)
