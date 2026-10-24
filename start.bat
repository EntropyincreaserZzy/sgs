@echo off
cd /d "%~dp0"
set HOST=0.0.0.0
set PORT=3000
echo.
echo  三国杀 · 军争
echo  本机访问:   http://127.0.0.1:3000
echo  同一 Wi-Fi 的同学: http://你的局域网IP:3000
echo  首次运行如被防火墙拦截，请允许 Node.js 访问网络。
echo.
start "" "http://127.0.0.1:3000"
node server.js
pause
