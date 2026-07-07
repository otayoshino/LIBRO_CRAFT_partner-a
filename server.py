"""
ContentsBuilder 開発用プレビューサーバー。
ローカルネットワーク上の他PCからも閲覧できるよう、0.0.0.0 でListenする。
"""

import http.server
import socketserver
import socket
import os
import json
from urllib.parse import urlparse, parse_qs

# ===========================
# 設定定数
# ===========================
PORT = 8080
HOST = "0.0.0.0"
# サーバーのルートディレクトリ（このファイルが置かれているフォルダ）
SERVE_DIR = os.path.dirname(os.path.abspath(__file__))


def get_local_ip() -> str:
    """
    ローカルネットワークのIPアドレスを取得する。
    取得できない場合は 'localhost' を返す。
    """
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "localhost"


class CORSRequestHandler(http.server.SimpleHTTPRequestHandler):
    """
    CORS ヘッダーを付与するHTTPリクエストハンドラー。
    開発環境でのクロスオリジンアクセスを許可する。
    """

    def end_headers(self):
        """レスポンスヘッダーにCORS許可ヘッダーを追加して送信する。"""
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        """プリフライトリクエストに対応するためのOPTIONSハンドラー。"""
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Content-Length")
        self.end_headers()

    def do_POST(self):
        """
        ファイルアップロードを処理する POSTハンドラー。
        /upload?filename=xxx にファイルの生バイナリを送信すると
        app/_media/ に保存し、JSON を返す。
        """
        parsed = urlparse(self.path)
        if not parsed.path.rstrip("/") == "/upload":
            self.send_response(404)
            self.end_headers()
            return

        # クエリパラメータからファイル名を取得
        params = parse_qs(parsed.query)
        filename_list = params.get("filename", [])
        if not filename_list or not filename_list[0].strip():
            self._send_json(400, {"error": "filename パラメータが必要です"})
            return

        # ディレクトリトラバーサル防止のためベース名のみ使用
        filename = os.path.basename(filename_list[0].strip())
        # basename(".")/basename("..")はそのまま返るため、親ディレクトリ等を指さないよう拒否する
        if not filename or filename in (".", ".."):
            self._send_json(400, {"error": "無効なファイル名です"})
            return

        # 保存先ディレクトリを作成
        save_dir = os.path.join(SERVE_DIR, "app", "_media")
        os.makedirs(save_dir, exist_ok=True)
        save_path = os.path.join(save_dir, filename)

        # リクエストボディを読み込んで保存
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)
        with open(save_path, "wb") as f:
            f.write(body)

        self.log_message("ファイルアップロード: %s (%d bytes)", filename, len(body))
        self._send_json(200, {"filename": filename, "saved": True})

    def _send_json(self, status_code: int, data: dict):
        """
        JSON レスポンスを送信するユーティリティメソッド。

        Args:
            status_code: HTTPステータスコード
            data: レスポンスとして返す辞書
        """
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        """アクセスログをコンソールに出力する。"""
        print(f"[アクセス] {self.address_string()} - {format % args}")


class ReusableTCPServer(socketserver.TCPServer):
    """
    TIME_WAIT状態のソケットを即座に再利用できるTCPServer。
    socketserver.TCPServerはbind時にallow_reuse_addressを参照するため、
    インスタンス化前にクラス変数として設定しておく必要がある。
    """

    allow_reuse_address = True


def start_server():
    """
    プレビューサーバーを起動する。
    指定ディレクトリをルートとして静的ファイルを配信する。
    """
    os.chdir(SERVE_DIR)

    local_ip = get_local_ip()

    with ReusableTCPServer((HOST, PORT), CORSRequestHandler) as httpd:
        print("=" * 50)
        print("  LIBRO＋CRAFT プレビューサーバー 起動中")
        print("=" * 50)
        print(f"  ローカル:      http://localhost:{PORT}/app/")
        print(f"  ネットワーク:  http://{local_ip}:{PORT}/app/")
        print("=" * 50)
        print("  停止するには Ctrl+C を押してください")
        print("=" * 50)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nサーバーを停止しました。")


if __name__ == "__main__":
    start_server()
