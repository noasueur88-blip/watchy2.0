import os
import requests
from flask import Flask, render_template, jsonify, redirect, url_for, session, request
from functools import wraps
from datetime import datetime, timezone, timedelta

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "change-me-in-production")

BOT_TOKEN      = os.environ.get("TOKEN", "")
CLIENT_ID      = os.environ.get("CLIENT_ID", "")
CLIENT_SECRET  = os.environ.get("CLIENT_SECRET", "")
REDIRECT_URI   = os.environ.get("REDIRECT_URI", "http://localhost:5000/callback")
OWNER_IDS      = [i.strip() for i in os.environ.get("OWNER_IDS", "").split(",") if i.strip()]
LOG_CHANNEL_ID = os.environ.get("LOG_CHANNEL_ID", "0")
DISCORD_API    = "https://discord.com/api/v10"

USER_SCORES   = {}
ADMIN_ACTIONS = {}
MAINTENANCE   = {"enabled": False}
BAD_WORDS     = ["hack", "nuke", "raid", "ddos", "exploit"]

def bot_headers():
    return {"Authorization": f"Bot {BOT_TOKEN}", "Content-Type": "application/json"}

def discord_request(endpoint, method="GET", token=None, **kwargs):
    headers = {"Authorization": f"Bearer {token}"} if token else bot_headers()
    headers["Content-Type"] = "application/json"
    try:
        r = requests.request(method, f"{DISCORD_API}/{endpoint}", headers=headers, timeout=8, **kwargs)
        if r.status_code == 204:
            return {"success": True}
        r.raise_for_status()
        return r.json()
    except Exception as e:
        return {"error": str(e)}

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user" not in session:
            return redirect(url_for("login_page"))
        return f(*args, **kwargs)
    return decorated

@app.route("/login")
def login_page():
    if "user" in session:
        return redirect(url_for("dashboard"))
    return render_template("login.html")

@app.route("/auth")
def auth():
    return redirect(
        f"https://discord.com/oauth2/authorize"
        f"?client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}"
        f"&response_type=code&scope=identify%20guilds"
    )

@app.route("/callback")
def callback():
    code = request.args.get("code")
    if not code:
        return "Erreur : code manquant.", 400
    r = requests.post(f"{DISCORD_API}/oauth2/token", data={
        "client_id": CLIENT_ID, "client_secret": CLIENT_SECRET,
        "grant_type": "authorization_code", "code": code, "redirect_uri": REDIRECT_URI,
    })
    if r.status_code != 200:
        return f"Erreur OAuth2 : {r.text}", 400
    access_token = r.json().get("access_token")
    user = discord_request("users/@me", token=access_token)
    if "id" not in user:
        return "Impossible de recuperer le profil.", 400
    if OWNER_IDS and user["id"] not in OWNER_IDS:
        return render_template("unauthorized.html"), 403
    session["user"] = user
    session["access_token"] = access_token
    return redirect(url_for("dashboard"))

@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login_page"))

@app.route("/")
@login_required
def dashboard():
    return render_template("dashboard.html", user=session["user"])

@app.route("/api/stats")
@login_required
def api_stats():
    guilds = discord_request("users/@me/guilds", token=session.get("access_token"))
    return jsonify({
        "guilds": len(guilds) if isinstance(guilds, list) else 0,
        "tracked_users": len(USER_SCORES),
        "top_score": max(USER_SCORES.values(), default=0),
        "maintenance": MAINTENANCE["enabled"],
        "log_channel": LOG_CHANNEL_ID,
        "bad_words": len(BAD_WORDS),
    })

@app.route("/api/guilds")
@login_required
def api_guilds():
    guilds = discord_request("users/@me/guilds", token=session.get("access_token"))
    if not isinstance(guilds, list):
        return jsonify([])
    ADMINISTRATOR = 0x8
    admin_guilds = []
    for g in guilds:
        is_owner = g.get("owner", False)
        perms = int(g.get("permissions", 0))
        is_admin = bool(perms & ADMINISTRATOR)
        if is_owner or is_admin:
            admin_guilds.append({
                "id":    g.get("id"),
                "name":  g.get("name"),
                "icon":  g.get("icon"),
                "owner": is_owner,
            })
    return jsonify(admin_guilds)

@app.route("/api/guild/<guild_id>/members")
@login_required
def api_members(guild_id):
    members = discord_request(f"guilds/{guild_id}/members?limit=50")
    if not isinstance(members, list):
        return jsonify([])
    return jsonify([{
        "id": m.get("user", {}).get("id"), "username": m.get("user", {}).get("username"),
        "avatar": m.get("user", {}).get("avatar"), "joined_at": m.get("joined_at"),
        "roles": m.get("roles", []), "nick": m.get("nick"),
        "score": USER_SCORES.get(m.get("user", {}).get("id"), 0),
    } for m in members])

@app.route("/api/guild/<guild_id>/commands")
@login_required
def api_commands(guild_id):
    cmds = discord_request(f"applications/{CLIENT_ID}/guilds/{guild_id}/commands")
    if isinstance(cmds, list):
        return jsonify(cmds)
    return jsonify(discord_request(f"applications/{CLIENT_ID}/commands") or [])

@app.route("/api/guild/<guild_id>/bans")
@login_required
def api_bans(guild_id):
    return jsonify(discord_request(f"guilds/{guild_id}/bans") or [])

@app.route("/api/guild/<guild_id>/ban/<user_id>", methods=["POST"])
@login_required
def api_ban(guild_id, user_id):
    reason = (request.json or {}).get("reason", "Banni via le panel")
    result = discord_request(f"guilds/{guild_id}/bans/{user_id}", method="PUT", json={"delete_message_seconds": 0, "reason": reason})
    return jsonify({"success": "error" not in result})

@app.route("/api/guild/<guild_id>/ban/<user_id>", methods=["DELETE"])
@login_required
def api_unban(guild_id, user_id):
    return jsonify({"success": "error" not in discord_request(f"guilds/{guild_id}/bans/{user_id}", method="DELETE")})

@app.route("/api/guild/<guild_id>/kick/<user_id>", methods=["POST"])
@login_required
def api_kick(guild_id, user_id):
    return jsonify({"success": "error" not in discord_request(f"guilds/{guild_id}/members/{user_id}", method="DELETE")})

@app.route("/api/guild/<guild_id>/timeout/<user_id>", methods=["POST"])
@login_required
def api_timeout(guild_id, user_id):
    minutes = int((request.json or {}).get("minutes", 10))
    until = (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()
    result = discord_request(f"guilds/{guild_id}/members/{user_id}", method="PATCH", json={"communication_disabled_until": until})
    return jsonify({"success": "error" not in result})

@app.route("/api/scores")
@login_required
def api_scores():
    top = sorted(USER_SCORES.items(), key=lambda x: x[1], reverse=True)[:10]
    return jsonify([{"user_id": uid, "score": s} for uid, s in top])

@app.route("/api/scores/<user_id>", methods=["DELETE"])
@login_required
def api_reset_score(user_id):
    USER_SCORES.pop(user_id, None)
    return jsonify({"success": True})

@app.route("/api/maintenance", methods=["POST"])
@login_required
def api_maintenance():
    MAINTENANCE["enabled"] = bool((request.json or {}).get("enabled", False))
    return jsonify({"maintenance": MAINTENANCE["enabled"]})

@app.route("/api/badwords")
@login_required
def api_badwords():
    return jsonify(BAD_WORDS)

@app.route("/api/badwords", methods=["POST"])
@login_required
def api_add_badword():
    word = (request.json or {}).get("word", "").strip().lower()
    if word and word not in BAD_WORDS:
        BAD_WORDS.append(word)
    return jsonify(BAD_WORDS)

@app.route("/api/badwords/<word>", methods=["DELETE"])
@login_required
def api_del_badword(word):
    if word in BAD_WORDS:
        BAD_WORDS.remove(word)
    return jsonify(BAD_WORDS)

@app.route("/health")
def health():
    return jsonify({"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
