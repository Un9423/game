from flask import Flask, send_from_directory
from flask_compress import Compress
import os
import mimetypes

# 確保 .onnx 和 .data 檔案有正確的 MIME type
mimetypes.add_type('application/octet-stream', '.onnx')
mimetypes.add_type('application/octet-stream', '.data')

app = Flask(__name__)

# 啟用自動 Gzip 壓縮
Compress(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")

@app.route("/<path:filename>")
def serve_static(filename):
    return send_from_directory(BASE_DIR, filename)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
