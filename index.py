from app import app, bootstrap


if __name__ == "__main__":
    bootstrap()
    app.run(host="0.0.0.0", port=5000)
