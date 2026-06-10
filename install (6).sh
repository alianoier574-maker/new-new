#!/bin/bash

# ─── Donkey Race - نصب روی VPS لینوکس ───────────────────────────────────────
set -e

echo ""
echo "🫏  نصب مسابقه خرها..."
echo "─────────────────────────────────────────"

# Check node
if ! command -v node &> /dev/null; then
  echo "⚙️  نصب Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

NODE_VER=$(node -v)
echo "✅  Node.js $NODE_VER یافت شد"

# Create folder
INSTALL_DIR="$HOME/donkey-race"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Copy files (if running from same dir)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/server.js" ]; then
  cp "$SCRIPT_DIR/server.js" .
  cp "$SCRIPT_DIR/index.html" .
  echo "✅  فایل‌ها کپی شدن"
fi

# Get server IP
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
PORT=${PORT:-3000}

echo ""
echo "─────────────────────────────────────────"
echo "✅  آماده‌ست!"
echo ""
echo "   برای اجرا:"
echo "   cd ~/donkey-race && node server.js"
echo ""
echo "   لینک بازی:"
echo "   http://$SERVER_IP:$PORT"
echo ""
echo "   برای اجرای همیشگی با pm2:"
echo "   npm install -g pm2"
echo "   pm2 start server.js --name donkey-race"
echo "   pm2 save && pm2 startup"
echo ""
echo "   برای باز کردن پورت فایروال:"
echo "   sudo ufw allow $PORT"
echo "─────────────────────────────────────────"

# Ask to run now
read -p "الان اجرا بشه؟ [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo ""
  echo "🚀  سرور در حال اجراست روی پورت $PORT..."
  echo "   Ctrl+C برای متوقف کردن"
  echo ""
  PORT=$PORT node server.js
fi
