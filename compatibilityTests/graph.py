import threading
import webbrowser

from flask import Flask, request, redirect
import requests

APP_ID = "903921322132837"
APP_SECRET = "757ba675053d544162a1963dc4a07fe0"

REDIRECT_URI = "http://localhost:5000/callback"
#IGAAM2HJVPhWVBZAGJiZAkpqdU9LYUNiQkU5cHUtNjcxSi16UURFS01Tbkg1QXJBaWZArazR3c29ESU5LdU5zUHBSeWczUUh5TzZAJeE4wTi1Ec085ZADhCczNyWTgwcW1veUFSSnNBaDI2eG1pRjNNeWRtX3NWWmg0VVZAsZAXlSalY4NAZDZD
app = Flask(__name__)
result = {}


@app.route("/callback")
def callback():
    code = request.args.get("code")

    r = requests.post(
        "https://api.instagram.com/oauth/access_token",
        data={
            "client_id": APP_ID,
            "client_secret": APP_SECRET,
            "grant_type": "authorization_code",
            "redirect_uri": REDIRECT_URI,
            "code": code,
        },
        timeout=30,
    )

    result["token"] = r.json()

    shutdown = request.environ.get("werkzeug.server.shutdown")
    if shutdown:
        shutdown()

    return "<h1>Success</h1>You may close this window."


def run_server():
    app.run(port=5000)


if __name__ == "__main__":
    threading.Thread(target=run_server).start()

    auth_url = (
        "https://www.instagram.com/oauth/authorize"
        f"?client_id={APP_ID}"
        f"&redirect_uri={REDIRECT_URI}"
        "&response_type=code"
        "&scope=instagram_business_basic"
    )

    print("Opening browser...")
    webbrowser.open(auth_url)

    while "token" not in result:
        pass

    print("\nTOKEN RESPONSE:")
    print(result["token"])