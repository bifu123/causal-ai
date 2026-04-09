#!/bin/bash
echo "停止当前服务器..."
pkill -f "python main.py" 2>/dev/null
sleep 2

echo "启动新服务器..."
cd /root/causal_ai
python main.py > server.log 2>&1 &
sleep 3

echo "检查服务器状态..."
if pgrep -f "python main.py" > /dev/null; then
    echo "服务器已启动！"
    echo "查看日志: tail -f server.log"
else
    echo "服务器启动失败，查看日志: cat server.log"
fi
