@echo off
setlocal

:: 使用 pushd 解决 UNC 路径不支持 cd 的问题
pushd "\\192.168.66.39\root\root\causal_ai\"

:: 1. 检查并强制清理可能存在的锁文件（防止脚本因锁死而中断）
if exist ".git\index.lock" (
    echo [系统] 发现 Git 进程锁，正在自动清理...
    del /f /q ".git\index.lock"
)

:: 2. 检查 .gitignore 逻辑
:: 注意：这里去掉了 findstr，直接判断文件是否存在或手动维护
if not exist ".gitignore" (
    echo .causal_ai/ > .gitignore
    echo [提示] 已创建 .gitignore 并排除 .causal_ai 目录
)

:: 3. 执行 Git 职责
git add .
git commit -m "debug: fix path and lock issues"
git push origin main

:: 返回原始目录并卸载临时盘符
popd

echo 任务完成！
pause