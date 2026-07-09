#!/bin/bash

# 自动获取脚本所在目录
SERVER_DIR=$(cd $(dirname $0); pwd)
VENV_PATH="$SERVER_DIR/.causal_ai/bin/activate"
PYTHON_SCRIPT="gui_client.py"
LOG_FILE="$SERVER_DIR/gui_client.log"

get_pid() {
    # 通过进程名查找 GUI 客户端进程
    pid=$(ps -ef | grep "$PYTHON_SCRIPT" | grep -v grep | awk '{print $2}' | head -n 1)
    echo "$pid"
}

start() {
    pid=$(get_pid)
    if [ -n "$pid" ]; then
        echo "GUI 客户端已在运行，PID: $pid"
    else
        echo "正在从 $SERVER_DIR 启动 GUI 客户端..."
        cd "$SERVER_DIR" || exit
        if [ -f "$VENV_PATH" ]; then
            source "$VENV_PATH"
            # 启动 GUI 客户端
            nohup python "$PYTHON_SCRIPT" >> "$LOG_FILE" 2>&1 &
            
            echo -n "检测 GUI 客户端启动状态..."
            for i in {1..5}; do
                sleep 1
                pid=$(get_pid)
                if [ -n "$pid" ]; then
                    echo -e "\n✅ GUI 客户端已启动，PID: $pid"
                    echo "日志文件: $LOG_FILE"
                    return 0
                fi
                echo -n "."
            done
            echo -e "\n❌ 启动检测超时，请检查 '$LOG_FILE' 获取详细信息。"
        else
            echo "错误: 未找到虚拟环境 $VENV_PATH"
        fi
    fi
}

stop() {
    pid=$(get_pid)
    if [ -z "$pid" ]; then
        echo "未发现正在运行的 GUI 客户端。"
    else
        echo "正在停止 PID 为 $pid 的 GUI 客户端..."
        kill "$pid"
        sleep 2
        # 如果还没关掉，强制关闭
        new_pid=$(get_pid)
        if [ -n "$new_pid" ]; then
            kill -9 "$new_pid"
        fi
        echo "GUI 客户端已停止。"
    fi
}

case "$1" in
    start) start ;;
    stop) stop ;;
    restart) stop; start ;;
    status)
        pid=$(get_pid)
        [ -n "$pid" ] && echo "运行中 PID: $pid" || echo "已停止"
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status}"
        exit 1
esac